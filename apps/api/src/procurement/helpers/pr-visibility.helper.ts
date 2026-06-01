import type { PrStatus, PrType } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';
import type { Role } from '../../auth/types/roles';

/**
 * Helper de visibilité (READ-ONLY) pour les Demandes d'Achat.
 *
 * Encode les MÊMES règles que `approval-workflow.service#getMyPendingApprovals`
 * + les rôles "full view" historiques, pour éviter qu'un valideur (PI,
 * CONTROLEUR, DAF, CAISSIER) ne reçoive un 404 sur `findOne` ou
 * `getApprovalHistory` alors qu'il vient justement de cliquer sur cette DA
 * depuis sa file d'attente d'approbation.
 *
 * IMPORTANT : ce helper est PUR (pas d'appel Prisma). Le service appelant
 * doit déjà avoir :
 *   1. chargé la PR avec `project: { select: { piUserId: true } }`,
 *   2. résolu l'`appUserId` (DB `auth.app_user.id`) via `resolveAppUserId`.
 *
 * Pour ne pas révéler l'existence d'une DA (OWASP, cohérent avec
 * `PrNotOwnedException`), le caller DOIT répondre 404 quand ce helper
 * renvoie `false`, jamais 403.
 */

/**
 * Vue minimale de la PR nécessaire à la décision de visibilité. On n'accepte
 * que ce qui est strictement utile pour éviter qu'un futur appelant pense
 * que d'autres champs sont consultés.
 */
export interface PrVisibilityView {
  requestedBy: string;
  status: PrStatus;
  requestType: PrType;
  project?: { piUserId: string | null } | null;
}

/**
 * Rôles qui voient TOUTES les DA quel que soit le statut (équivalent du
 * `FULL_VIEW_ROLES` historique de `purchase-request.service.ts`).
 *
 * SUPER_ADMIN, DAF, CONTROLEUR, COMPTABLE, TRESORIER : déjà autorisés
 * historiquement.
 *
 * NOTE — fix `fix-acheteur-visibility-scope` : ACHETEUR avait été ajouté
 * ici dans `fix-pr-detail-validator-scope` (scope full view trop large).
 * Le rôle est désormais sorti de cette liste et gating par STATUT via
 * `ACHETEUR_VISIBLE_STATUSES` ci-dessous. Motif métier : séparation des
 * tâches — un ACHETEUR n'a pas à voir les brouillons / DA en attente de
 * validation. Seules les DA prêtes à transformer en BC (`approved`) ou
 * déjà processées (`closed`, pour traçabilité) lui sont visibles.
 */
const ALL_ACCESS_ROLES: ReadonlyArray<Role> = [
  'SUPER_ADMIN',
  'DAF',
  'CONTROLEUR',
  'COMPTABLE',
  'TRESORIER',
];

/**
 * Fix `fix-acheteur-visibility-scope` — statuts pour lesquels l'ACHETEUR
 * voit toutes les DA (cross-projet, cross-demandeur), quel que soit
 * l'ownership. Couvre le parcours Procure-to-Account :
 *   - `approved` : DA validée, en attente de transformation en BC.
 *   - `closed`   : cycle terminé, accessible en lecture pour traçabilité.
 *
 * Les statuts intermédiaires (`draft`, `submitted`, `pending_*`,
 * `rejected`, `cancelled`, `settled`) restent invisibles à l'ACHETEUR :
 * pendant ces étapes, c'est au demandeur et aux valideurs de gérer la DA.
 *
 * Note : `po_issued` mentionné dans le brief initial n'existe PAS dans
 * `PrStatus` (Prisma) — la DA reste à `approved` même après création du
 * BC associé (le BC porte son propre statut dans la table `purchase_order`).
 * Si la sémantique évolue (transition automatique approved→closed à la
 * création du BC), réajuster ici + dans `buildWhere` côté service.
 */
export const ACHETEUR_VISIBLE_STATUSES: ReadonlyArray<PrStatus> = ['approved', 'closed'];

/**
 * Renvoie `true` si `actor` doit pouvoir lire la DA `pr`.
 *
 * Règles (alignées sur `getMyPendingApprovals` + accès lecture historique) :
 *   1. SUPER_ADMIN / DAF / CONTROLEUR / COMPTABLE / TRESORIER → true (full view).
 *   2. Owner (`pr.requestedBy === appUserId`) → true (quel que soit le rôle).
 *   3. PI avec rôle 'PI' ET projet rattaché (`pr.project.piUserId === appUserId`) → true,
 *      quel que soit le statut (le PI doit pouvoir relire l'historique
 *      même après son approbation).
 *   4. CAISSIER sur une DA `petty_cash` ou `cash_advance` → true (un caissier peut
 *      avoir besoin de relire l'historique d'une DA cash à n'importe quel stade).
 *   5. ACHETEUR sur une DA `approved` ou `closed` → true (parcours P2P :
 *      transformation en BC + traçabilité). Pas d'accès aux brouillons /
 *      pending_* — séparation des tâches.
 *   6. Sinon → false.
 */
export function canActorViewPr(
  actor: AuthenticatedUser,
  appUserId: string,
  pr: PrVisibilityView,
): boolean {
  // 1. Rôles full-view (alignés sur FULL_VIEW_ROLES historique).
  if (actor.roles.some((r) => ALL_ACCESS_ROLES.includes(r))) {
    return true;
  }

  // 2. Owner.
  if (pr.requestedBy === appUserId) {
    return true;
  }

  // 3. PI rattaché au projet de la DA — quel que soit le statut.
  if (
    actor.roles.includes('PI') &&
    pr.project?.piUserId != null &&
    pr.project.piUserId === appUserId
  ) {
    return true;
  }

  // 4. CAISSIER sur une DA cash (petty_cash ou cash_advance).
  if (
    actor.roles.includes('CAISSIER') &&
    (pr.requestType === 'petty_cash' || pr.requestType === 'cash_advance')
  ) {
    return true;
  }

  // 5. ACHETEUR sur une DA en `approved` ou `closed`.
  if (
    actor.roles.includes('ACHETEUR') &&
    ACHETEUR_VISIBLE_STATUSES.includes(pr.status)
  ) {
    return true;
  }

  return false;
}

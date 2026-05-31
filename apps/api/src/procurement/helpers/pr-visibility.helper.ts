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
 * Rôles qui voient TOUTES les DA (équivalent du `FULL_VIEW_ROLES` historique
 * de `purchase-request.service.ts`). On y ajoute les rôles qui interviennent
 * dans le workflow d'approbation et qui doivent pouvoir relire une DA à
 * n'importe quel stade de son cycle de vie.
 *
 * - SUPER_ADMIN, DAF, CONTROLEUR, COMPTABLE, TRESORIER : déjà autorisés
 *   historiquement.
 * - ACHETEUR : @Roles list sur le contrôleur — on garde l'accès lecture.
 */
const ALL_ACCESS_ROLES: ReadonlyArray<Role> = [
  'SUPER_ADMIN',
  'DAF',
  'CONTROLEUR',
  'COMPTABLE',
  'TRESORIER',
  'ACHETEUR',
];

/**
 * Renvoie `true` si `actor` doit pouvoir lire la DA `pr`.
 *
 * Règles (alignées sur `getMyPendingApprovals` + accès lecture historique) :
 *   1. SUPER_ADMIN / DAF / CONTROLEUR / COMPTABLE / TRESORIER / ACHETEUR → true (full view).
 *   2. Owner (`pr.requestedBy === appUserId`) → true.
 *   3. PI avec rôle 'PI' ET projet rattaché (`pr.project.piUserId === appUserId`) → true,
 *      quel que soit le statut (le PI doit pouvoir relire l'historique
 *      même après son approbation).
 *   4. CAISSIER sur une DA `petty_cash` ou `cash_advance` → true (un caissier peut
 *      avoir besoin de relire l'historique d'une DA cash à n'importe quel stade).
 *   5. Sinon → false.
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

  return false;
}

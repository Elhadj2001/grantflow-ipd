import { Injectable } from '@nestjs/common';
import { AuditLogService } from '../services/audit-log.service';
import { SegregationOfDutiesException } from '../exceptions/business.exception';

/**
 * Longueur minimale d'un motif de break-glass SUPER_ADMIN. Aligné sur la SoD
 * Note Technique (US-053) — un seul mécanisme, pas de seuil divergent.
 */
export const SOD_BYPASS_MIN_REASON_LENGTH = 20;

/** Rôle d'administration habilité au break-glass (ADR-009). */
const SUPER_ADMIN_ROLE = 'SUPER_ADMIN';

export interface SodEnforceInput {
  /** Type d'entité auditée (ex. 'purchase_request', 'payment_run', 'invoice'). */
  entityType: string;
  /** Identifiant de l'entité validée/exécutée. */
  entityId: string;
  /** Libellé de l'opération (ex. 'approve_pr', 'approve_payment_run', 'post_invoice'). */
  operation: string;
  /** AppUser.id du SAISISSEUR de l'opération (null si inconnu → pas de conflit). */
  creatorAppUserId: string | null;
  /** AppUser.id de l'ACTEUR qui valide/exécute. */
  actorAppUserId: string;
  /** Acteur (rôles pour le break-glass + identité journalisée). */
  actor: { id?: string | null; email?: string | null; roles: readonly string[] };
  /** Dérogation conventionnelle (`grant_agreement.single_actor_authorized`). */
  singleActorAuthorized?: boolean;
  /** Motif break-glass SUPER_ADMIN (header `X-Bypass-SoD-Reason`). */
  bypassReason?: string | null;
  /** Contexte additionnel journalisé (ex. `{ grantId }`). */
  context?: Record<string, unknown>;
}

/**
 * Garde transverse de séparation des tâches (G1/F3, ADR-009, règle d'or n°6).
 *
 * Stratégie : strict + dérogation encadrée. Si l'acteur EST le saisisseur :
 *  1. convention `single_actor_authorized = true` → autorisé + audit
 *     `sod_derogation_convention` ;
 *  2. break-glass SUPER_ADMIN avec motif (≥ 20 car.) → autorisé + audit
 *     `sod_break_glass` (motif + acteur journalisés) ;
 *  3. sinon → `SegregationOfDutiesException` (403).
 *
 * Mécanisme unique réutilisé par DA (approbation), paiement (approbation) et
 * écriture (comptabilisation) — cohérent avec la SoD Note Technique (US-053).
 * Ne crée AUCUN app_user (l'acteur est déjà résolu et tracé par l'appelant) :
 * pas d'auto-provisioning silencieux dans le chemin SoD.
 */
@Injectable()
export class SegregationOfDutiesService {
  constructor(private readonly audit: AuditLogService) {}

  enforce(input: SodEnforceInput): void {
    const { creatorAppUserId, actorAppUserId } = input;

    // Pas de conflit : saisisseur inconnu ou différent de l'acteur.
    if (!creatorAppUserId || creatorAppUserId !== actorAppUserId) return;

    const baseEvent = {
      entityType: input.entityType,
      entityId: input.entityId,
      actorId: input.actor.id ?? actorAppUserId,
      actorEmail: input.actor.email ?? null,
    };
    const basePayload = {
      operation: input.operation,
      creatorAppUserId,
      actorAppUserId,
      ...input.context,
    };

    // Dérogation 1 — convention « acteur unique » (validée DAF).
    if (input.singleActorAuthorized) {
      this.audit.recordDomainEvent({
        ...baseEvent,
        action: 'sod_derogation_convention',
        payload: basePayload,
      });
      return;
    }

    // Dérogation 2 — break-glass SUPER_ADMIN avec motif suffisant.
    const isSuperAdmin = input.actor.roles.includes(SUPER_ADMIN_ROLE);
    const reason = input.bypassReason?.trim();
    if (isSuperAdmin && reason && reason.length >= SOD_BYPASS_MIN_REASON_LENGTH) {
      this.audit.recordDomainEvent({
        ...baseEvent,
        action: 'sod_break_glass',
        payload: { ...basePayload, bypassReason: reason },
      });
      return;
    }

    throw new SegregationOfDutiesException(
      input.operation,
      input.actor.id ?? actorAppUserId,
      creatorAppUserId,
      isSuperAdmin,
    );
  }
}

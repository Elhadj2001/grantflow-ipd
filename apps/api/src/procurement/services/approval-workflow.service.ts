import { Injectable, Logger } from '@nestjs/common';
import { PrStatus } from '@prisma/client';
import type { ApprovalStep, PurchaseRequest } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';
import type { Role } from '../../auth/types/roles';
import {
  CashWorkflowNotYetImplementedException,
  EntityNotFoundException,
  PiNotOwnerOfProjectException,
  PrAlreadyDecidedException,
  PrNotAwaitingYouException,
  PrNotInApprovalException,
  RejectionReasonRequiredException,
} from '../../common/exceptions/business.exception';

const ENTITY_NAME = 'PurchaseRequest';
const APPROVAL_ENTITY_TYPE = 'purchase_request';

/**
 * Seuils d'approbation (XOF).
 *   - < 500 000        : PI seul (1 étape)
 *   - 500 000..5 000 000: PI puis CG (2 étapes)
 *   - ≥ 5 000 000      : PI puis CG puis DAF (3 étapes)
 *
 * Stockés ici plutôt que dans `app.config` : ce sont des règles métier
 * stables (politique de délégation IPD), pas des paramètres d'environnement.
 */
export const APPROVAL_THRESHOLD_CG = 500_000;
export const APPROVAL_THRESHOLD_DAF = 5_000_000;

/** Statuts d'approbation possibles sur `approval_step.status`. */
const STEP_PENDING = 'pending';
const STEP_APPROVED = 'approved';
const STEP_REJECTED = 'rejected';
const STEP_RETURNED = 'returned';

/** Statuts de DA considérés "en cours de validation". */
const IN_APPROVAL_STATUSES: PrStatus[] = [
  PrStatus.pending_pi,
  PrStatus.pending_cg,
  PrStatus.pending_daf,
];

/** Statuts considérés "active" pour la détection de fractionnement. */
const ACTIVE_FOR_SPLITTING: PrStatus[] = [
  PrStatus.pending_pi,
  PrStatus.pending_cg,
  PrStatus.pending_daf,
  PrStatus.approved,
];

/** Fenêtre d'observation pour le fractionnement (jours). */
const SPLITTING_WINDOW_DAYS = 30;
/** Seuil au-delà duquel on émet un warning. */
const SPLITTING_THRESHOLD = 3;

/** Marge temporelle pour considérer une DA "urgente" (jours). */
const URGENT_WINDOW_DAYS = 7;

export interface ApprovalResult {
  pr: PurchaseRequest;
  /** Rôle de l'étape suivante (null si workflow terminé). */
  nextStepRole: Role | null;
  /** Warning non bloquant si fractionnement détecté. */
  splittingWarning: { recentCount: number; projectId: string } | null;
}

export interface PendingApprovalRow extends PurchaseRequest {
  isUrgent: boolean;
  currentStepRole: string | null;
}

@Injectable()
export class ApprovalWorkflowService {
  private readonly logger = new Logger(ApprovalWorkflowService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ------------------------------------------------------------------
  // Approve / Reject / Return
  // ------------------------------------------------------------------

  async approveCurrentStep(
    actor: AuthenticatedUser,
    prId: string,
    comment?: string,
  ): Promise<ApprovalResult> {
    const pr = await this.loadPrForDecision(prId);
    this.assertStandardWorkflow(pr);

    const pendingStep = await this.findPendingStep(prId);
    this.assertRoleMatches(actor, pendingStep.approverRole, pr.id);
    if (pendingStep.approverRole === 'PI') {
      await this.assertPiOwnsProject(actor, pr.projectId);
    }

    const appUserId = await this.resolveAppUserId(actor);
    const nextRole = this.computeNextStepRole(pendingStep.approverRole, Number(pr.totalAmount));

    const splittingWarning = await this.detectSplitting(pr);

    const updatedPr = await this.prisma.$transaction(async (tx) => {
      await tx.approvalStep.update({
        where: { id: pendingStep.id },
        data: {
          status: STEP_APPROVED,
          approverId: appUserId,
          decidedAt: new Date(),
          decisionNotes: comment ?? null,
        },
      });

      if (nextRole) {
        await tx.approvalStep.create({
          data: {
            entityType: APPROVAL_ENTITY_TYPE,
            entityId: pr.id,
            stepOrder: pendingStep.stepOrder + 1,
            approverRole: nextRole,
            status: STEP_PENDING,
          },
        });
        return tx.purchaseRequest.update({
          where: { id: pr.id },
          data: { status: this.statusForRole(nextRole), updatedAt: new Date() },
        });
      }

      return tx.purchaseRequest.update({
        where: { id: pr.id },
        data: { status: PrStatus.approved, updatedAt: new Date() },
      });
    });

    if (splittingWarning) {
      this.logger.warn(
        { prId: pr.id, ...splittingWarning },
        'splitting pattern detected — non-blocking warning',
      );
    }

    return { pr: updatedPr, nextStepRole: nextRole, splittingWarning };
  }

  async rejectCurrentStep(
    actor: AuthenticatedUser,
    prId: string,
    reason: string,
  ): Promise<PurchaseRequest> {
    if (!reason || reason.trim().length < 5) {
      throw new RejectionReasonRequiredException();
    }
    const pr = await this.loadPrForDecision(prId);
    this.assertStandardWorkflow(pr);

    const pendingStep = await this.findPendingStep(prId);
    this.assertRoleMatches(actor, pendingStep.approverRole, pr.id);

    const appUserId = await this.resolveAppUserId(actor);
    return this.prisma.$transaction(async (tx) => {
      await tx.approvalStep.update({
        where: { id: pendingStep.id },
        data: {
          status: STEP_REJECTED,
          approverId: appUserId,
          decidedAt: new Date(),
          decisionNotes: reason,
        },
      });
      return tx.purchaseRequest.update({
        where: { id: pr.id },
        data: {
          status: PrStatus.rejected,
          rejectionReason: reason,
          updatedAt: new Date(),
        },
      });
    });
  }

  async returnForChanges(
    actor: AuthenticatedUser,
    prId: string,
    comment: string,
  ): Promise<PurchaseRequest> {
    if (!comment || comment.trim().length < 5) {
      // Réutilise le même code que reject : un retour pour modif est aussi une décision motivée.
      throw new RejectionReasonRequiredException();
    }
    const pr = await this.loadPrForDecision(prId);
    this.assertStandardWorkflow(pr);

    const pendingStep = await this.findPendingStep(prId);
    this.assertRoleMatches(actor, pendingStep.approverRole, pr.id);

    const appUserId = await this.resolveAppUserId(actor);
    return this.prisma.$transaction(async (tx) => {
      await tx.approvalStep.update({
        where: { id: pendingStep.id },
        data: {
          status: STEP_RETURNED,
          approverId: appUserId,
          decidedAt: new Date(),
          decisionNotes: comment,
        },
      });
      return tx.purchaseRequest.update({
        where: { id: pr.id },
        data: { status: PrStatus.draft, updatedAt: new Date() },
      });
    });
  }

  // ------------------------------------------------------------------
  // Reads
  // ------------------------------------------------------------------

  async getMyPendingApprovals(
    actor: AuthenticatedUser,
    filters: {
      projectId?: string;
      fromDate?: string;
      toDate?: string;
      urgent?: boolean;
      page: number;
      pageSize: number;
    },
  ): Promise<{ data: PendingApprovalRow[]; total: number; page: number; pageSize: number }> {
    // Pour les PI : on limite aux projets dont ils sont owner.
    const isPI = actor.roles.includes('PI');
    const isCG = actor.roles.includes('CONTROLEUR');
    const isDAF = actor.roles.includes('DAF');
    const isSA = actor.roles.includes('SUPER_ADMIN');

    const statusFilters: PrStatus[] = [];
    if (isSA) statusFilters.push(...IN_APPROVAL_STATUSES);
    if (isPI) statusFilters.push(PrStatus.pending_pi);
    if (isCG) statusFilters.push(PrStatus.pending_cg);
    if (isDAF) statusFilters.push(PrStatus.pending_daf);

    if (statusFilters.length === 0) {
      return { data: [], total: 0, page: filters.page, pageSize: filters.pageSize };
    }

    const projectIdFilter: { in: string[] } | string | undefined = (() => {
      if (filters.projectId) return filters.projectId;
      if (isPI && !isSA) {
        // restreint aux projets dont le PI est owner
        return undefined; // appliqué via projet.piUserId ci-dessous
      }
      return undefined;
    })();

    const appUserId = await this.resolveAppUserId(actor);
    const isUrgentCutoff = new Date();
    isUrgentCutoff.setUTCDate(isUrgentCutoff.getUTCDate() + URGENT_WINDOW_DAYS);

    const baseWhere = {
      status: { in: Array.from(new Set(statusFilters)) },
      requestType: 'standard' as const,
      ...(projectIdFilter ? { projectId: projectIdFilter } : {}),
      ...(filters.fromDate ? { requestedAt: { gte: new Date(filters.fromDate) } } : {}),
      ...(filters.toDate ? { requestedAt: { lte: new Date(filters.toDate) } } : {}),
      ...(filters.urgent === true
        ? { neededBy: { lte: isUrgentCutoff, not: null } }
        : {}),
      ...(isPI && !isSA && !isCG && !isDAF
        ? { project: { piUserId: appUserId } }
        : {}),
    };

    const skip = (filters.page - 1) * filters.pageSize;

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.purchaseRequest.findMany({
        where: baseWhere,
        orderBy: [{ neededBy: 'asc' }, { requestedAt: 'asc' }],
        skip,
        take: filters.pageSize,
      }),
      this.prisma.purchaseRequest.count({ where: baseWhere }),
    ]);

    // On enrichit chaque ligne avec `currentStepRole` et `isUrgent` pour le front.
    const stepsByPr = await this.prisma.approvalStep.findMany({
      where: {
        entityType: APPROVAL_ENTITY_TYPE,
        entityId: { in: rows.map((r) => r.id) },
        status: STEP_PENDING,
      },
      select: { entityId: true, approverRole: true },
    });
    const roleByPr = new Map(stepsByPr.map((s) => [s.entityId, s.approverRole]));

    return {
      data: rows.map((r) => ({
        ...r,
        currentStepRole: roleByPr.get(r.id) ?? null,
        isUrgent: r.neededBy != null && r.neededBy <= isUrgentCutoff,
      })),
      total,
      page: filters.page,
      pageSize: filters.pageSize,
    };
  }

  async getApprovalHistory(prId: string): Promise<ApprovalStep[]> {
    // L'autorisation lecture est déjà gérée au-dessus (controller doit
    // appeler `pr.findOne` d'abord pour le 404 ownership). On retourne
    // juste l'historique brut.
    return this.prisma.approvalStep.findMany({
      where: { entityType: APPROVAL_ENTITY_TYPE, entityId: prId },
      orderBy: { stepOrder: 'asc' },
    });
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  private async loadPrForDecision(prId: string): Promise<PurchaseRequest> {
    const pr = await this.prisma.purchaseRequest.findUnique({ where: { id: prId } });
    if (!pr) throw new EntityNotFoundException(ENTITY_NAME, { id: prId });
    if (!IN_APPROVAL_STATUSES.includes(pr.status)) {
      throw new PrNotInApprovalException(prId, pr.status);
    }
    return pr;
  }

  private assertStandardWorkflow(pr: PurchaseRequest): void {
    if (pr.requestType !== 'standard') {
      throw new CashWorkflowNotYetImplementedException(pr.id, pr.requestType);
    }
  }

  private async findPendingStep(prId: string): Promise<ApprovalStep> {
    // Plusieurs steps peuvent être 'pending' sur des entités différentes —
    // ici on scope par entité + status.
    const step = await this.prisma.approvalStep.findFirst({
      where: { entityType: APPROVAL_ENTITY_TYPE, entityId: prId, status: STEP_PENDING },
      orderBy: { stepOrder: 'desc' },
    });
    if (!step) {
      // PR en pending_* sans approval_step pending : incohérence (déjà décidée).
      throw new PrAlreadyDecidedException(prId, 'no-pending-step');
    }
    return step;
  }

  private assertRoleMatches(
    actor: AuthenticatedUser,
    expectedRole: string | null,
    prId: string,
  ): void {
    if (!expectedRole) {
      throw new PrAlreadyDecidedException(prId, 'no-role-on-step');
    }
    // SUPER_ADMIN bypass.
    if (actor.roles.includes('SUPER_ADMIN')) return;
    if (!actor.roles.includes(expectedRole as Role)) {
      throw new PrNotAwaitingYouException(prId, expectedRole, actor.roles);
    }
  }

  private async assertPiOwnsProject(actor: AuthenticatedUser, projectId: string): Promise<void> {
    if (actor.roles.includes('SUPER_ADMIN')) return;
    const appUserId = await this.resolveAppUserId(actor);
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { piUserId: true },
    });
    if (!project || project.piUserId !== appUserId) {
      throw new PiNotOwnerOfProjectException(appUserId, projectId);
    }
  }

  /**
   * Routage par seuil. À partir du rôle de l'étape qu'on vient d'approuver,
   * détermine le rôle de la suivante (ou `null` si on a fini).
   */
  private computeNextStepRole(currentRole: string | null, totalAmount: number): Role | null {
    if (currentRole === 'PI') {
      if (totalAmount < APPROVAL_THRESHOLD_CG) return null;
      return 'CONTROLEUR';
    }
    if (currentRole === 'CONTROLEUR') {
      if (totalAmount < APPROVAL_THRESHOLD_DAF) return null;
      return 'DAF';
    }
    if (currentRole === 'DAF') return null;
    // Rôle inconnu : on ferme prudemment.
    return null;
  }

  private statusForRole(role: Role): PrStatus {
    switch (role) {
      case 'CONTROLEUR': return PrStatus.pending_cg;
      case 'DAF':        return PrStatus.pending_daf;
      case 'PI':         return PrStatus.pending_pi;
      default:           return PrStatus.pending_pi;
    }
  }

  /**
   * Détection de fractionnement (anti-splitting). Si le demandeur a déjà
   * > SPLITTING_THRESHOLD DA actives sur le même projet sur la fenêtre
   * de 30 jours, on émet un warning (non bloquant — la décision reste).
   */
  private async detectSplitting(pr: PurchaseRequest): Promise<{ recentCount: number; projectId: string } | null> {
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - SPLITTING_WINDOW_DAYS);
    const count = await this.prisma.purchaseRequest.count({
      where: {
        requestedBy: pr.requestedBy,
        projectId: pr.projectId,
        status: { in: ACTIVE_FOR_SPLITTING },
        requestedAt: { gte: since },
        id: { not: pr.id },
      },
    });
    if (count > SPLITTING_THRESHOLD) {
      return { recentCount: count + 1, projectId: pr.projectId };
    }
    return null;
  }

  /**
   * Bridge Keycloak.sub → auth.app_user.id par email (cf. sprint 2.1).
   * Idéalement déplacé dans JwtStrategy dans un sprint dédié.
   */
  private async resolveAppUserId(actor: AuthenticatedUser): Promise<string> {
    const existing = await this.prisma.appUser.findUnique({
      where: { email: actor.email },
      select: { id: true },
    });
    if (existing) return existing.id;
    const created = await this.prisma.appUser.create({
      data: { email: actor.email, fullName: actor.fullName || actor.email },
      select: { id: true },
    });
    return created.id;
  }
}

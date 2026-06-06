import { Injectable, Logger } from '@nestjs/common';
import { PrStatus } from '@prisma/client';
import type { ApprovalStep, CashSettlement, PurchaseRequest } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ExchangeRateService } from '../../referential/exchange-rate/exchange-rate.service';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';
import type { Role } from '../../auth/types/roles';
import {
  CashBoxInsufficientFundsException,
  EntityNotFoundException,
  PiNotOwnerOfProjectException,
  PrAlreadyDecidedException,
  PrAlreadySettledException,
  PrNotApprovedForSettleException,
  PrNotAwaitingYouException,
  PrNotInApprovalException,
  PrTypeMismatchException,
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

/** Statuts de DA considérés "en cours de validation" (standard + cash). */
const IN_APPROVAL_STATUSES: PrStatus[] = [
  PrStatus.pending_pi,
  PrStatus.pending_cg,
  PrStatus.pending_daf,
  PrStatus.pending_caissier,
];

/** Statuts considérés "active" pour la détection de fractionnement. */
const ACTIVE_FOR_SPLITTING: PrStatus[] = [
  PrStatus.pending_pi,
  PrStatus.pending_cg,
  PrStatus.pending_daf,
  PrStatus.pending_caissier,
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly fx: ExchangeRateService,
  ) {}

  // ------------------------------------------------------------------
  // Approve / Reject / Return
  // ------------------------------------------------------------------

  async approveCurrentStep(
    actor: AuthenticatedUser,
    prId: string,
    comment?: string,
  ): Promise<ApprovalResult> {
    const pr = await this.loadPrForDecision(prId);

    const pendingStep = await this.findPendingStep(prId);
    this.assertRoleMatches(actor, pendingStep.approverRole, pr.id);
    if (pendingStep.approverRole === 'PI') {
      await this.assertPiOwnsProject(actor, pr.projectId);
    }

    const appUserId = await this.resolveAppUserId(actor);

    // Fix `fix-approval-workflow-currency-conversion` : les seuils
    // APPROVAL_THRESHOLD_CG / DAF sont exprimés en XOF. Sans conversion,
    // une DA de 100 000 EUR (= ~65 595 700 XOF) passe en `approved` après
    // l'étape PI car 100 000 < 500 000 (comparaison naïve cross-currency).
    // On convertit donc le montant en XOF avant le routage par seuil
    // (uniquement pour `standard` — les workflows cash n'utilisent pas les
    // seuils). Le résultat est loggué pour audit traçable.
    const rawAmount = Number(pr.totalAmount);
    let amountForRouting = rawAmount;
    if (pr.requestType === 'standard' && pr.currency !== 'XOF') {
      const conv = await this.fx.convertToXof(rawAmount, pr.currency);
      amountForRouting = conv.xofAmount;
      this.logger.log(
        {
          prId: pr.id,
          currency: pr.currency,
          rawAmount,
          xofAmount: conv.xofAmount,
          fxRate: conv.fxRate,
          fxRateDate: conv.fxRateDate,
          isIndicativeFallback: conv.isIndicativeFallback,
          currentRole: pendingStep.approverRole,
        },
        'fx conversion applied for approval threshold routing',
      );
    }

    const nextRole = this.computeNextStepRole(
      pendingStep.approverRole,
      amountForRouting,
      pr.requestType,
    );

    const splittingWarning = await this.detectSplitting(pr);
    const closing = nextRole === null;
    const decrementCashBox = closing && pr.cashBoxId !== null && pr.requestType !== 'standard';

    // Pré-check du solde caisse — on lève AVANT d'engager la transaction
    // pour produire le bon code d'erreur. Le décrément atomique se fait
    // dans la transaction.
    if (decrementCashBox && pr.cashBoxId) {
      const cb = await this.prisma.cashBox.findUnique({
        where: { id: pr.cashBoxId },
        select: { id: true, currentBalance: true },
      });
      if (cb && Number(cb.currentBalance) < Number(pr.totalAmount)) {
        throw new CashBoxInsufficientFundsException(
          cb.id,
          Number(cb.currentBalance),
          Number(pr.totalAmount),
        );
      }
    }

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

      // Dernière étape : décrément immédiat du solde caisse pour les
      // DA cash. La sortie physique des espèces matérialise l'engagement.
      // Pour cash_advance, le settle régularise plus tard.
      if (decrementCashBox && pr.cashBoxId) {
        await tx.cashBox.update({
          where: { id: pr.cashBoxId },
          data: { currentBalance: { decrement: Number(pr.totalAmount) } },
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
    // return-for-changes n'a pas de sens pour petty_cash (workflow urgent).
    // On force le caissier à approuver ou refuser.
    if (pr.requestType === 'petty_cash') {
      throw new PrTypeMismatchException(pr.id, 'standard|cash_advance', pr.requestType);
    }

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
    const isCaissier = actor.roles.includes('CAISSIER');
    const isSA = actor.roles.includes('SUPER_ADMIN');

    const statusFilters: PrStatus[] = [];
    if (isSA) statusFilters.push(...IN_APPROVAL_STATUSES);
    if (isPI) statusFilters.push(PrStatus.pending_pi);
    if (isCG) statusFilters.push(PrStatus.pending_cg);
    if (isDAF) statusFilters.push(PrStatus.pending_daf);
    if (isCaissier) statusFilters.push(PrStatus.pending_caissier);

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
      ...(projectIdFilter ? { projectId: projectIdFilter } : {}),
      ...(filters.fromDate ? { requestedAt: { gte: new Date(filters.fromDate) } } : {}),
      ...(filters.toDate ? { requestedAt: { lte: new Date(filters.toDate) } } : {}),
      ...(filters.urgent === true
        ? { neededBy: { lte: isUrgentCutoff, not: null } }
        : {}),
      ...(isPI && !isSA && !isCG && !isDAF && !isCaissier
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
   * Routage par seuil + type de DA.
   *
   *   standard      : PI → (≥500k) CG → (≥5M) DAF
   *   petty_cash    : CAISSIER → fin (workflow simplifié, 1 étape)
   *   cash_advance  : PI → CAISSIER → fin
   */
  private computeNextStepRole(
    currentRole: string | null,
    totalAmount: number,
    requestType: PurchaseRequest['requestType'],
  ): Role | null {
    if (requestType === 'petty_cash') {
      // Une seule étape : après le caissier, on a terminé.
      return null;
    }
    if (requestType === 'cash_advance') {
      if (currentRole === 'PI') return 'CAISSIER';
      // Après le caissier, on est en `approved`, le settle viendra plus tard.
      return null;
    }
    // Workflow standard
    if (currentRole === 'PI') {
      if (totalAmount < APPROVAL_THRESHOLD_CG) return null;
      return 'CONTROLEUR';
    }
    if (currentRole === 'CONTROLEUR') {
      if (totalAmount < APPROVAL_THRESHOLD_DAF) return null;
      return 'DAF';
    }
    if (currentRole === 'DAF') return null;
    return null;
  }

  private statusForRole(role: Role): PrStatus {
    switch (role) {
      case 'CONTROLEUR': return PrStatus.pending_cg;
      case 'DAF':        return PrStatus.pending_daf;
      case 'CAISSIER':   return PrStatus.pending_caissier;
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

  // ------------------------------------------------------------------
  // Cash settlement (cash_advance régularisation)
  // ------------------------------------------------------------------

  /**
   * Régularisation d'une avance de mission. Calcule la variance
   * `actualSpent - totalEngagé` :
   *   - variance > 0 : le demandeur a dépensé plus que prévu, à rembourser
   *     (par paiement séparé ou prochaine paie — hors scope ici, on note)
   *   - variance < 0 : reliquat à rendre, la caisse est créditée du delta
   *   - variance = 0 : pile poil
   *
   * Préconditions :
   *   - DA en statut `approved`
   *   - request_type = 'cash_advance'
   *   - pas de settle existant pour cette DA (UNIQUE en DB)
   *
   * À la fin : DA `settled` (statut final).
   */
  async settleCashAdvance(
    actor: AuthenticatedUser,
    prId: string,
    args: { actualSpent: number; justifications?: string },
  ): Promise<{ pr: PurchaseRequest; settlement: CashSettlement }> {
    const pr = await this.prisma.purchaseRequest.findUnique({ where: { id: prId } });
    if (!pr) throw new EntityNotFoundException(ENTITY_NAME, { id: prId });

    if (pr.requestType !== 'cash_advance') {
      throw new PrTypeMismatchException(pr.id, 'cash_advance', pr.requestType);
    }
    if (pr.status !== PrStatus.approved) {
      throw new PrNotApprovedForSettleException(pr.id, pr.status);
    }
    const existing = await this.prisma.cashSettlement.findUnique({
      where: { purchaseRequestId: prId },
    });
    if (existing) throw new PrAlreadySettledException(prId);

    const engaged = Number(pr.totalAmount);
    const variance = args.actualSpent - engaged;
    const appUserId = await this.resolveAppUserId(actor);

    return this.prisma.$transaction(async (tx) => {
      const settlement = await tx.cashSettlement.create({
        data: {
          purchaseRequestId: prId,
          actualSpent: args.actualSpent,
          variance,
          justifications: args.justifications ?? null,
          settledBy: appUserId,
        },
      });

      // Si dépense effective < engagement : le reliquat retourne en caisse.
      if (variance < 0 && pr.cashBoxId) {
        await tx.cashBox.update({
          where: { id: pr.cashBoxId },
          data: { currentBalance: { increment: -variance } },
        });
      }
      // Si variance > 0 : la caisse a déjà sorti `engaged`. Le delta doit
      // être réglé hors flux caisse (paie / remboursement séparé). On ne
      // re-décrémente PAS la caisse — ce serait incohérent.

      const updatedPr = await tx.purchaseRequest.update({
        where: { id: prId },
        data: { status: PrStatus.settled, updatedAt: new Date() },
      });

      return { pr: updatedPr, settlement };
    });
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

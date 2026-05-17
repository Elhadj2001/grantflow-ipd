import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { FiscalPeriod } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  PeriodAlreadyClosedException,
  PeriodAlreadyOpenException,
  PeriodCloseBlockedException,
  PeriodCloseReasonRequiredException,
  PeriodNotFoundException,
  PeriodReopenReasonRequiredException,
} from '../../common/exceptions/business.exception';

export const CHECK_SEVERITY_BLOCKING = 'BLOCKING';
export const CHECK_SEVERITY_WARNING = 'WARNING';

export const CLOSE_EVENT_PRECHECK = 'precheck';
export const CLOSE_EVENT_CLOSE = 'close';
export const CLOSE_EVENT_REOPEN = 'reopen';
export const CLOSE_EVENT_DEDICATED_FUNDS = 'dedicated_funds';

export interface PrecheckFinding {
  code: string;
  severity: 'BLOCKING' | 'WARNING';
  message: string;
  payload: Record<string, unknown>;
}

export interface PrecheckResult {
  periodId: string;
  periodCode: string;
  findings: PrecheckFinding[];
  blockingCount: number;
  warningCount: number;
  canClose: boolean;
}

export interface CloseInput {
  acknowledgeWarnings?: boolean;
  reason?: string;
}

export interface ReopenInput {
  reason: string;
}

export interface CloseActor {
  id: string;
  email: string;
  fullName?: string;
}

/**
 * Workflow de clôture d'une période fiscale (mensuelle / trimestrielle /
 * annuelle). Toutes les opérations sont journalisées dans
 * gl.period_close_event pour audit bailleur.
 *
 * Checks BLOCKING (empêchent close sauf override DAF + reason) :
 *  - C001 DA en attente d'approbation dans la période
 *  - C002 BC actifs non finalisés dont la date impacte la période
 *  - C003 Factures matchées non comptabilisées
 *  - C004 Écritures déséquilibrées (devrait être impossible vu trigger DB)
 *  - C005 Fonds dédiés non dotés sur grants actifs (sera levé après le run
 *         de DedicatedFundsService)
 *  - C006 Réceptions complètes non comptabilisées (FNP manquante)
 *
 * Checks WARNING (signalés, n'empêchent pas le close) :
 *  - W001 Variance budgétaire > 10% sur au moins une ligne
 *  - W002 IBAN fournisseur changé < 30j (relié à des paiements de la période)
 *  - W003 Période N-1 (même type) non encore close
 */
@Injectable()
export class PeriodCloseService {
  private readonly logger = new Logger(PeriodCloseService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ------------------------------------------------------------------
  // Listing / lecture
  // ------------------------------------------------------------------

  async listPeriods() {
    return this.prisma.fiscalPeriod.findMany({
      orderBy: [{ startDate: 'asc' }, { periodType: 'asc' }],
    });
  }

  async listEvents(periodId: string) {
    const period = await this.prisma.fiscalPeriod.findUnique({ where: { id: periodId } });
    if (!period) throw new PeriodNotFoundException(periodId);
    return this.prisma.periodCloseEvent.findMany({
      where: { periodId },
      include: { user: { select: { email: true, fullName: true } } },
      orderBy: { occurredAt: 'desc' },
      take: 200,
    });
  }

  async listChecks(periodId: string) {
    const period = await this.prisma.fiscalPeriod.findUnique({ where: { id: periodId } });
    if (!period) throw new PeriodNotFoundException(periodId);
    return this.prisma.periodCloseCheck.findMany({
      where: { periodId },
      orderBy: [{ severity: 'asc' }, { checkCode: 'asc' }],
    });
  }

  // ------------------------------------------------------------------
  // Precheck
  // ------------------------------------------------------------------

  /**
   * Lance tous les checks et persiste les findings dans
   * gl.period_close_check (réécriture complète : on supprime les findings
   * précédents puis on insère). Renvoie le détail au caller.
   */
  async precheck(actor: CloseActor, periodId: string): Promise<PrecheckResult> {
    const period = await this.prisma.fiscalPeriod.findUnique({ where: { id: periodId } });
    if (!period) throw new PeriodNotFoundException(periodId);

    const findings = await this.runAllChecks(period);

    await this.prisma.$transaction([
      this.prisma.periodCloseCheck.deleteMany({ where: { periodId } }),
      this.prisma.periodCloseCheck.createMany({
        data: findings.map((f) => ({
          periodId,
          checkCode: f.code,
          severity: f.severity,
          message: f.message,
          payload: f.payload as Prisma.InputJsonValue,
        })),
      }),
      this.prisma.periodCloseEvent.create({
        data: {
          periodId,
          action: CLOSE_EVENT_PRECHECK,
          userId: actor.id,
          payload: { findings: findings.length } as Prisma.InputJsonValue,
        },
      }),
    ]);

    const blockingCount = findings.filter((f) => f.severity === CHECK_SEVERITY_BLOCKING).length;
    const warningCount = findings.filter((f) => f.severity === CHECK_SEVERITY_WARNING).length;
    this.logger.log(
      { periodCode: period.code, blockingCount, warningCount, actor: actor.email },
      'period precheck completed',
    );
    return {
      periodId,
      periodCode: period.code,
      findings,
      blockingCount,
      warningCount,
      canClose: blockingCount === 0,
    };
  }

  /**
   * Exécute tous les checks et renvoie la liste agrégée. Public pour
   * permettre aux tests unitaires de l'invoquer sans persistance.
   */
  async runAllChecks(period: FiscalPeriod): Promise<PrecheckFinding[]> {
    const [c1, c2, c3, c4, c5, c6, w1, w2, w3] = await Promise.all([
      this.checkPendingPurchaseRequests(period),
      this.checkActivePurchaseOrders(period),
      this.checkMatchedInvoicesNotPosted(period),
      this.checkUnbalancedEntries(period),
      this.checkDedicatedFundsNotAllocated(period),
      this.checkReceiptsNotPosted(period),
      this.checkBudgetVarianceWarning(period),
      this.checkRecentIbanChangesWarning(period),
      this.checkPreviousPeriodNotClosedWarning(period),
    ]);
    return [c1, c2, c3, c4, c5, c6, w1, w2, w3].filter((f): f is PrecheckFinding => f !== null);
  }

  // ------------------------------------------------------------------
  // Close / reopen
  // ------------------------------------------------------------------

  /**
   * Clôture la période. Si des findings BLOCKING existent et que
   * `acknowledgeWarnings ≠ true`, lève PERIOD_CLOSE_BLOCKED.
   * `acknowledgeWarnings = true` est l'override DAF — `reason`
   * devient alors obligatoire (capturé dans period_close_event).
   */
  async close(
    actor: CloseActor,
    periodId: string,
    input: CloseInput,
  ): Promise<FiscalPeriod> {
    const period = await this.prisma.fiscalPeriod.findUnique({ where: { id: periodId } });
    if (!period) throw new PeriodNotFoundException(periodId);
    if (period.isClosed) throw new PeriodAlreadyClosedException(period.id, period.code);

    const findings = await this.runAllChecks(period);
    const blocking = findings.filter((f) => f.severity === CHECK_SEVERITY_BLOCKING);
    if (blocking.length > 0 && !input.acknowledgeWarnings) {
      throw new PeriodCloseBlockedException(
        period.id,
        blocking.map((b) => ({
          code: b.code,
          message: b.message,
          payload: b.payload,
        })),
      );
    }
    if (blocking.length > 0 && (!input.reason || input.reason.trim().length < 5)) {
      throw new PeriodCloseReasonRequiredException();
    }

    return this.prisma.$transaction(async (tx) => {
      const closed = await tx.fiscalPeriod.update({
        where: { id: periodId },
        data: {
          isClosed: true,
          closedAt: new Date(),
          closedBy: actor.id,
        },
      });
      await tx.periodCloseEvent.create({
        data: {
          periodId,
          action: CLOSE_EVENT_CLOSE,
          userId: actor.id,
          reason: input.reason ?? null,
          payload: {
            blockingOverridden: blocking.length,
            warningCount: findings.length - blocking.length,
          } as Prisma.InputJsonValue,
        },
      });
      this.logger.warn(
        {
          periodCode: period.code,
          actor: actor.email,
          override: blocking.length > 0,
          warnings: findings.length - blocking.length,
        },
        'period CLOSED',
      );
      return closed;
    });
  }

  /**
   * Ré-ouvre une période close. Réservé DAF — `reason` obligatoire et
   * journalisé. L'opération est rare et tracée dans
   * gl.period_close_event.
   */
  async reopen(
    actor: CloseActor,
    periodId: string,
    input: ReopenInput,
  ): Promise<FiscalPeriod> {
    if (!input.reason || input.reason.trim().length < 5) {
      throw new PeriodReopenReasonRequiredException();
    }
    const period = await this.prisma.fiscalPeriod.findUnique({ where: { id: periodId } });
    if (!period) throw new PeriodNotFoundException(periodId);
    if (!period.isClosed) throw new PeriodAlreadyOpenException(period.id, period.code);

    return this.prisma.$transaction(async (tx) => {
      const reopened = await tx.fiscalPeriod.update({
        where: { id: periodId },
        data: {
          isClosed: false,
          reopenedAt: new Date(),
          reopenedBy: actor.id,
          reopenReason: input.reason,
        },
      });
      await tx.periodCloseEvent.create({
        data: {
          periodId,
          action: CLOSE_EVENT_REOPEN,
          userId: actor.id,
          reason: input.reason,
          payload: {
            previouslyClosedAt: period.closedAt?.toISOString() ?? null,
            previouslyClosedBy: period.closedBy ?? null,
          } as Prisma.InputJsonValue,
        },
      });
      this.logger.warn(
        { periodCode: period.code, actor: actor.email, reason: input.reason },
        'period REOPENED',
      );
      return reopened;
    });
  }

  // ------------------------------------------------------------------
  // Checks individuels (publics pour test unitaire fin si besoin)
  // ------------------------------------------------------------------

  async checkPendingPurchaseRequests(period: FiscalPeriod): Promise<PrecheckFinding | null> {
    const count = await this.prisma.purchaseRequest.count({
      where: {
        status: {
          in: ['submitted', 'pending_pi', 'pending_cg', 'pending_daf', 'pending_caissier'],
        },
        requestedAt: { gte: period.startDate, lte: period.endDate },
      },
    });
    if (count === 0) return null;
    return {
      code: 'C001',
      severity: CHECK_SEVERITY_BLOCKING,
      message: `${count} purchase request(s) still pending approval in this period`,
      payload: { count },
    };
  }

  async checkActivePurchaseOrders(period: FiscalPeriod): Promise<PrecheckFinding | null> {
    const count = await this.prisma.purchaseOrder.count({
      where: {
        status: { in: ['draft', 'sent', 'acknowledged'] },
        orderDate: { gte: period.startDate, lte: period.endDate },
      },
    });
    if (count === 0) return null;
    return {
      code: 'C002',
      severity: CHECK_SEVERITY_BLOCKING,
      message: `${count} active purchase order(s) not yet received/invoiced for this period`,
      payload: { count },
    };
  }

  async checkMatchedInvoicesNotPosted(period: FiscalPeriod): Promise<PrecheckFinding | null> {
    const count = await this.prisma.invoice.count({
      where: {
        status: 'matched',
        invoiceDate: { gte: period.startDate, lte: period.endDate },
      },
    });
    if (count === 0) return null;
    return {
      code: 'C003',
      severity: CHECK_SEVERITY_BLOCKING,
      message: `${count} matched invoice(s) not yet posted in GL`,
      payload: { count },
    };
  }

  async checkUnbalancedEntries(period: FiscalPeriod): Promise<PrecheckFinding | null> {
    // Devrait être impossible vu le trigger gl.check_entry_balance — mais
    // on garde un check défensif. On somme par entry et on compare.
    const rows = await this.prisma.$queryRaw<Array<{ entry_id: string; diff: number }>>`
      SELECT
        e.id AS entry_id,
        COALESCE(SUM(l.debit), 0) - COALESCE(SUM(l.credit), 0) AS diff
      FROM gl.journal_entry e
      JOIN gl.journal_line l ON l.entry_id = e.id
      WHERE e.status = 'posted'
        AND e.period_id = ${period.id}::uuid
      GROUP BY e.id
      HAVING ABS(COALESCE(SUM(l.debit), 0) - COALESCE(SUM(l.credit), 0)) > 0.005
    `;
    if (rows.length === 0) return null;
    return {
      code: 'C004',
      severity: CHECK_SEVERITY_BLOCKING,
      message: `${rows.length} unbalanced posted entry/entries detected (CRITICAL)`,
      payload: { entries: rows.map((r) => ({ entryId: r.entry_id, diff: Number(r.diff) })) },
    };
  }

  async checkDedicatedFundsNotAllocated(period: FiscalPeriod): Promise<PrecheckFinding | null> {
    // Pour chaque grant actif qui a reçu des ressources sur la période
    // (compte 75x crédit), on vérifie qu'il existe un mouvement
    // dedicated_fund_movement sur la même période. Sinon flag.
    const rows = await this.prisma.$queryRaw<
      Array<{ grant_id: string; resources_received: number }>
    >`
      SELECT
        l.grant_id AS grant_id,
        SUM(l.credit - l.debit) AS resources_received
      FROM gl.journal_line l
      JOIN gl.journal_entry e ON e.id = l.entry_id
      WHERE e.status = 'posted'
        AND e.period_id = ${period.id}::uuid
        AND l.account_code LIKE '75%'
        AND l.grant_id IS NOT NULL
      GROUP BY l.grant_id
      HAVING SUM(l.credit - l.debit) > 0
    `;
    if (rows.length === 0) return null;
    const grantIds = rows.map((r) => r.grant_id);
    const allocated = await this.prisma.dedicatedFundMovement.findMany({
      where: { grantId: { in: grantIds }, periodId: period.id },
      select: { grantId: true },
    });
    const allocatedSet = new Set(allocated.map((a) => a.grantId));
    const missing = rows.filter((r) => !allocatedSet.has(r.grant_id));
    if (missing.length === 0) return null;
    return {
      code: 'C005',
      severity: CHECK_SEVERITY_BLOCKING,
      message: `${missing.length} grant(s) received resources without dedicated funds allocation`,
      payload: {
        grants: missing.map((m) => ({
          grantId: m.grant_id,
          resourcesReceived: Number(m.resources_received),
        })),
      },
    };
  }

  async checkReceiptsNotPosted(period: FiscalPeriod): Promise<PrecheckFinding | null> {
    // FNP attendue : GR `complete` sur la période sans facture postée
    // sur le PO. On utilise un raw SQL pour la jointure inverse (Prisma
    // n'expose pas le relation `none` sur PurchaseOrder.invoices ici).
    const rows = await this.prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count
      FROM procurement.goods_receipt gr
      WHERE gr.status = 'complete'
        AND gr.receipt_date >= ${period.startDate}::date
        AND gr.receipt_date <= ${period.endDate}::date
        AND NOT EXISTS (
          SELECT 1 FROM ap.invoice inv
          WHERE inv.po_id = gr.po_id
            AND inv.status IN ('posted','partially_paid','paid')
        )
    `;
    const count = Number(rows[0]?.count ?? 0);
    if (count === 0) return null;
    return {
      code: 'C006',
      severity: CHECK_SEVERITY_BLOCKING,
      message: `${count} complete goods receipt(s) without an FNP posting`,
      payload: { count },
    };
  }

  async checkBudgetVarianceWarning(period: FiscalPeriod): Promise<PrecheckFinding | null> {
    // Variance budgétaire > 10% sur au moins une budget_line. Source :
    // suivi consommation ((SUM debit - SUM credit) sur les comptes 6
    // imputés à la budget_line) vs budgeted_amount, restreint à la
    // période. Renvoie nb_lines en dépassement.
    const rows = await this.prisma.$queryRaw<
      Array<{ budget_line_id: string; consumed: number; budgeted: number }>
    >`
      SELECT
        bl.id AS budget_line_id,
        COALESCE(SUM(l.debit - l.credit), 0) AS consumed,
        bl.budgeted_amount AS budgeted
      FROM ref.budget_line bl
      LEFT JOIN gl.journal_line l ON l.budget_line_id = bl.id
      LEFT JOIN gl.journal_entry e ON e.id = l.entry_id
        AND e.status = 'posted'
        AND e.period_id = ${period.id}::uuid
      GROUP BY bl.id, bl.budgeted_amount
      HAVING bl.budgeted_amount > 0
        AND ABS(COALESCE(SUM(l.debit - l.credit), 0) - bl.budgeted_amount) / bl.budgeted_amount > 0.10
        AND COALESCE(SUM(l.debit - l.credit), 0) > 0
    `;
    if (rows.length === 0) return null;
    return {
      code: 'W001',
      severity: CHECK_SEVERITY_WARNING,
      message: `${rows.length} budget line(s) with variance > 10%`,
      payload: { lines: rows.length },
    };
  }

  async checkRecentIbanChangesWarning(period: FiscalPeriod): Promise<PrecheckFinding | null> {
    // Cherche tout fournisseur qui a un changement IBAN dans les
    // 30 jours précédant `period.endDate`. Sprint 5.2 a introduit
    // supplier_iban_history — si la table n'existe pas encore (revert),
    // on retourne null silencieusement.
    try {
      const cutoff = new Date(period.endDate);
      cutoff.setDate(cutoff.getDate() - 30);
      const rows = await this.prisma.$queryRaw<Array<{ count: number }>>`
        SELECT COUNT(DISTINCT supplier_id)::int AS count
        FROM ref.supplier_iban_history
        WHERE changed_at >= ${cutoff} AND changed_at <= ${period.endDate}
      `;
      const c = Number(rows[0]?.count ?? 0);
      if (c === 0) return null;
      return {
        code: 'W002',
        severity: CHECK_SEVERITY_WARNING,
        message: `${c} supplier IBAN change(s) within 30 days before period end`,
        payload: { count: c },
      };
    } catch {
      // Table absente (sprint 5.2 reverté) — non bloquant
      return null;
    }
  }

  async checkPreviousPeriodNotClosedWarning(period: FiscalPeriod): Promise<PrecheckFinding | null> {
    const previous = await this.prisma.fiscalPeriod.findFirst({
      where: {
        periodType: period.periodType,
        endDate: { lt: period.startDate },
      },
      orderBy: { endDate: 'desc' },
    });
    if (!previous) return null;
    if (previous.isClosed) return null;
    return {
      code: 'W003',
      severity: CHECK_SEVERITY_WARNING,
      message: `Previous period "${previous.code}" is not closed yet`,
      payload: { previousPeriodCode: previous.code, previousPeriodId: previous.id },
    };
  }
}

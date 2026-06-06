import { Injectable, Logger } from '@nestjs/common';
import { EntryStatus, JournalType, Prisma } from '@prisma/client';
import type { FiscalPeriod, JournalEntry } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  PeriodAlreadyClosedException,
  PeriodNotFoundException,
} from '../../common/exceptions/business.exception';

/**
 * Compte SYSCEBNL — Fournisseurs / Factures non parvenues (FNP).
 * Crédit à la clôture pour constater l'obligation d'achat avant
 * réception de la facture définitive. Renversé à l'ouverture suivante.
 */
export const ACCOUNT_FNP = '408';
/**
 * Compte de charge fallback si la budget_line de la PO line n'a pas
 * de `default_account` (devrait être rare — les conventions exigent
 * un mapping à la création).
 */
export const ACCOUNT_FALLBACK_EXPENSE = '605';

/**
 * source_type utilisés pour la traçabilité et l'idempotence. La FNP
 * d'abonnement est identifiée par (sourceType, sourceId=gr.id) ; son
 * extourne sur la période suivante par (sourceTypeReversal, gr.id).
 */
export const SOURCE_TYPE_ACCRUAL_FNP = 'accrual_fnp';
export const SOURCE_TYPE_ACCRUAL_FNP_REVERSAL = 'accrual_fnp_reversal';

export interface AccrualActor {
  id: string;
  email: string;
  fullName?: string;
}

export interface AccrualLineResult {
  grId: string;
  grNumber: string;
  poNumber: string;
  amount: number;
  currency: string;
  accrualEntryId: string;
  reversalEntryId: string | null;
  skippedReason?: 'already_accrued' | 'no_remaining';
}

export interface AccrualsRunResult {
  periodId: string;
  periodCode: string;
  processed: number;
  skipped: number;
  totalAccrued: number;
  currency: string;
  lines: AccrualLineResult[];
  reversalsPeriodId: string | null;
}

/**
 * Génère les abonnements de Factures Non Parvenues (FNP) à la clôture
 * d'une période fiscale.
 *
 * Patron comptable SYSCEBNL :
 *   - À la clôture : Débit <compte charge>, Crédit 408 (FNP)
 *     (constate la charge à payer dont la facture n'est pas arrivée)
 *   - À l'ouverture de la période suivante : extourne (Débit 408, Crédit charge)
 *     L'écriture de facture définitive viendra ensuite annuler proprement.
 *
 * Identification d'une FNP à constater :
 *   - GR status='complete' avec receipt_date dans la période
 *   - Aucune facture posted/partially_paid/paid sur le PO de la GR
 *   - Montant = somme(gr_line.quantity × po_line.unit_price)
 *
 * Idempotence : une JournalEntry sourceType='accrual_fnp' sourceId=gr.id
 * existante coupe le re-run (sans erreur).
 *
 * Imputation analytique conservée :
 *   - budgetLineId : po_line.budget_line_id (présent par contrainte DDL)
 *   - grantId      : budget_line.grant_id
 *   - projectId    : grant.project_id
 *
 * Aucun trigger / CHECK / GENERATED du DDL n'est touché — toutes les
 * écritures sont équilibrées en TypeScript avant insert.
 */
@Injectable()
export class AccrualService {
  private readonly logger = new Logger(AccrualService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Run principal — itère sur les GR éligibles, constate la FNP +
   * crée l'extourne sur la période suivante. Retourne le détail
   * pour audit / UI.
   */
  async runFnpAccruals(actor: AccrualActor, periodId: string): Promise<AccrualsRunResult> {
    const period = await this.prisma.fiscalPeriod.findUnique({ where: { id: periodId } });
    if (!period) throw new PeriodNotFoundException(periodId);
    if (period.isClosed) throw new PeriodAlreadyClosedException(period.id, period.code);

    const eligibleGrs = await this.findEligibleReceipts(period);
    const nextPeriod = await this.findNextPeriod(period);
    if (!nextPeriod) {
      // Cas extrême : on accepte de générer la FNP sans extourne future.
      // Le DAF devra créer la période N+1 puis générer l'extourne via
      // un nouveau run sur la période courante. On log à WARN.
      this.logger.warn(
        { periodCode: period.code, eligible: eligibleGrs.length },
        'no next fiscal period found — FNP will be created WITHOUT auto-reversal',
      );
    }

    const lines: AccrualLineResult[] = [];
    // Cumul exact (Decimal) des montants accruisés (cf. F10).
    let totalAccruedDec = new Prisma.Decimal(0);

    for (const gr of eligibleGrs) {
      const line = await this.processOneReceipt(actor, period, nextPeriod, gr);
      lines.push(line);
      if (!line.skippedReason) totalAccruedDec = totalAccruedDec.plus(line.amount);
    }

    const processed = lines.filter((l) => !l.skippedReason).length;
    const skipped = lines.length - processed;
    // Frontières (JSON payload, log, DTO) : un number arrondi 2 décimales.
    const totalAccrued = this.round2(totalAccruedDec);

    // Trace dans period_close_event (audit bailleur)
    await this.prisma.periodCloseEvent.create({
      data: {
        periodId,
        action: 'fnp_accruals',
        userId: actor.id,
        payload: {
          processed,
          skipped,
          totalAccrued,
          nextPeriodId: nextPeriod?.id ?? null,
        } as Prisma.InputJsonValue,
      },
    });

    this.logger.log(
      {
        periodCode: period.code,
        processed,
        skipped,
        totalAccrued,
        actor: actor.email,
      },
      'FNP accruals run completed',
    );

    return {
      periodId,
      periodCode: period.code,
      processed,
      skipped,
      totalAccrued,
      currency: 'XOF',
      lines,
      reversalsPeriodId: nextPeriod?.id ?? null,
    };
  }

  // ------------------------------------------------------------------
  // Détection : mêmes critères que period-close C006 mais on charge le
  // détail (GR + lignes + PO + budget_lines) pour pouvoir comptabiliser.
  // ------------------------------------------------------------------

  private async findEligibleReceipts(period: FiscalPeriod) {
    // 1) On récupère les GR `complete` sur la période sans facture posted.
    //    On évite le LIKE Prisma via $queryRaw — l'index `idx_gr_status`
    //    sert la première clause.
    const candidates = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT gr.id
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
    if (candidates.length === 0) return [];

    return this.prisma.goodsReceipt.findMany({
      where: { id: { in: candidates.map((c) => c.id) } },
      include: {
        po: {
          select: {
            id: true,
            poNumber: true,
            currency: true,
            supplierId: true,
            prLinks: { select: { prId: true } },
          },
        },
        lines: {
          include: {
            poLine: {
              select: {
                id: true,
                unitPrice: true,
                budgetLineId: true,
                budgetLine: {
                  select: {
                    id: true,
                    code: true,
                    label: true,
                    defaultAccount: true,
                    grantId: true,
                    grant: { select: { projectId: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
  }

  private async findNextPeriod(current: FiscalPeriod): Promise<FiscalPeriod | null> {
    // Même type de période, démarrant après la fin de la courante,
    // ordre chronologique croissant — on prend la plus proche.
    return this.prisma.fiscalPeriod.findFirst({
      where: {
        periodType: current.periodType,
        startDate: { gt: current.endDate },
      },
      orderBy: { startDate: 'asc' },
    });
  }

  // ------------------------------------------------------------------
  // Per-GR processing : 1 entry FNP + 1 entry reversal (optionnel)
  // ------------------------------------------------------------------

  private async processOneReceipt(
    actor: AccrualActor,
    period: FiscalPeriod,
    nextPeriod: FiscalPeriod | null,
    gr: Awaited<ReturnType<typeof this.findEligibleReceipts>>[number],
  ): Promise<AccrualLineResult> {
    // Idempotence : on a déjà accruisé ce GR sur cette période → skip
    const existing = await this.prisma.journalEntry.findFirst({
      where: {
        sourceType: SOURCE_TYPE_ACCRUAL_FNP,
        sourceId: gr.id,
        periodId: period.id,
        status: { not: EntryStatus.reversed },
      },
      include: { reversals: { select: { id: true } } },
    });
    if (existing) {
      return {
        grId: gr.id,
        grNumber: gr.grNumber,
        poNumber: gr.po.poNumber,
        amount: 0,
        currency: gr.po.currency,
        accrualEntryId: existing.id,
        reversalEntryId: existing.reversals[0]?.id ?? null,
        skippedReason: 'already_accrued',
      };
    }

    // Construction des lignes de débit (1 par GR line) avec imputation.
    // Montants conservés en Decimal exact (prix unitaire × quantité) — la
    // conversion en number ne se fait qu'aux frontières DTO (cf. F10).
    interface DebitLineSpec {
      lineNumber: number;
      accountCode: string;
      label: string;
      amount: Prisma.Decimal;
      grantId: string | null;
      budgetLineId: string | null;
      projectId: string | null;
    }
    const debitLines: DebitLineSpec[] = [];
    let lineNumber = 1;
    let total = new Prisma.Decimal(0);
    for (const grLine of gr.lines) {
      const unitPrice = new Prisma.Decimal(grLine.poLine.unitPrice);
      const qty = new Prisma.Decimal(grLine.quantity);
      // Arrondi à 2 décimales en Decimal exact (ROUND_HALF_UP, cohérent
      // avec Math.round positif de round2).
      const amount = unitPrice.times(qty).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      if (amount.lte(0)) continue;
      const account =
        grLine.poLine.budgetLine.defaultAccount ?? ACCOUNT_FALLBACK_EXPENSE;
      debitLines.push({
        lineNumber: lineNumber++,
        accountCode: account,
        label: `FNP ${gr.grNumber} — ${grLine.poLine.budgetLine.code} ${grLine.poLine.budgetLine.label}`.slice(0, 256),
        amount,
        grantId: grLine.poLine.budgetLine.grantId,
        budgetLineId: grLine.poLine.budgetLineId,
        projectId: grLine.poLine.budgetLine.grant.projectId,
      });
      total = total.plus(amount);
    }
    total = total.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    if (total.lte(0)) {
      return {
        grId: gr.id,
        grNumber: gr.grNumber,
        poNumber: gr.po.poNumber,
        amount: 0,
        currency: gr.po.currency,
        accrualEntryId: '',
        reversalEntryId: null,
        skippedReason: 'no_remaining',
      };
    }

    // Crée l'écriture FNP + l'extourne dans une seule transaction.
    const result = await this.prisma.$transaction(async (tx) => {
      // 1) FNP : Débit charge / Crédit 408
      const fnpNumber = await this.generateEntryNumber(tx, JournalType.OD);
      const fnp = await tx.journalEntry.create({
        data: {
          entryNumber: fnpNumber,
          journal: JournalType.OD,
          entryDate: period.endDate,
          periodId: period.id,
          label: `FNP ${gr.grNumber} (BC ${gr.po.poNumber}) - abonnement clôture`,
          sourceType: SOURCE_TYPE_ACCRUAL_FNP,
          sourceId: gr.id,
          status: EntryStatus.draft,
        },
      });

      const debitData: Prisma.JournalLineCreateManyInput[] = debitLines.map((dl) => ({
        entryId: fnp.id,
        lineNumber: dl.lineNumber,
        accountCode: dl.accountCode,
        label: dl.label,
        debit: dl.amount,
        credit: new Prisma.Decimal(0),
        currency: gr.po.currency,
        grantId: dl.grantId,
        budgetLineId: dl.budgetLineId,
        projectId: dl.projectId,
      }));
      const creditEntry: Prisma.JournalLineCreateManyInput = {
        entryId: fnp.id,
        lineNumber: debitLines.length + 1,
        accountCode: ACCOUNT_FNP,
        label: `FNP ${gr.grNumber} - contrepartie 408`,
        debit: new Prisma.Decimal(0),
        credit: total,
        currency: gr.po.currency,
        // On garde l'imputation analytique sur le 408 aussi pour les rapports
        // par grant (CLAUDE.md §2 règle 1).
        grantId: debitLines[0]?.grantId ?? null,
        budgetLineId: null,
        projectId: debitLines[0]?.projectId ?? null,
      };
      await tx.journalLine.createMany({ data: [...debitData, creditEntry] });

      // 2) Promotion en posted (trigger gl.check_entry_balance s'exécute)
      await tx.journalEntry.update({
        where: { id: fnp.id },
        data: { status: EntryStatus.posted, postedAt: new Date(), postedBy: actor.id },
      });

      // 3) Extourne sur la période suivante — seulement si elle existe
      //    et n'est pas close.
      let reversalId: string | null = null;
      if (nextPeriod && !nextPeriod.isClosed) {
        const revNumber = await this.generateEntryNumber(tx, JournalType.OD);
        const reversal = await tx.journalEntry.create({
          data: {
            entryNumber: revNumber,
            journal: JournalType.OD,
            entryDate: nextPeriod.startDate,
            periodId: nextPeriod.id,
            label: `Extourne FNP ${gr.grNumber} (BC ${gr.po.poNumber})`,
            sourceType: SOURCE_TYPE_ACCRUAL_FNP_REVERSAL,
            sourceId: gr.id,
            status: EntryStatus.draft,
          },
        });
        // Lignes inversées (debit ↔ credit)
        const revDebit: Prisma.JournalLineCreateManyInput = {
          entryId: reversal.id,
          lineNumber: 1,
          accountCode: ACCOUNT_FNP,
          label: `Extourne FNP 408 ${gr.grNumber}`,
          debit: total,
          credit: new Prisma.Decimal(0),
          currency: gr.po.currency,
          grantId: debitLines[0]?.grantId ?? null,
          projectId: debitLines[0]?.projectId ?? null,
        };
        const revCredits: Prisma.JournalLineCreateManyInput[] = debitLines.map((dl) => ({
          entryId: reversal.id,
          lineNumber: dl.lineNumber + 1,
          accountCode: dl.accountCode,
          label: `Extourne ${dl.label}`.slice(0, 256),
          debit: new Prisma.Decimal(0),
          credit: dl.amount,
          currency: gr.po.currency,
          grantId: dl.grantId,
          budgetLineId: dl.budgetLineId,
          projectId: dl.projectId,
        }));
        await tx.journalLine.createMany({ data: [revDebit, ...revCredits] });
        await tx.journalEntry.update({
          where: { id: reversal.id },
          data: {
            status: EntryStatus.posted,
            postedAt: new Date(),
            postedBy: actor.id,
          },
        });
        // Chaînage : la FNP référence l'extourne via reversedById
        await tx.journalEntry.update({
          where: { id: fnp.id },
          data: { reversedById: reversal.id },
        });
        reversalId = reversal.id;
      }

      return { fnpId: fnp.id, reversalId };
    });

    return {
      grId: gr.id,
      grNumber: gr.grNumber,
      poNumber: gr.po.poNumber,
      // Frontière DTO (AccrualLineResult.amount: number).
      amount: total.toNumber(),
      currency: gr.po.currency,
      accrualEntryId: result.fnpId,
      reversalEntryId: result.reversalId,
    };
  }

  // ------------------------------------------------------------------
  // Numérotation des écritures — même patron que PostingService
  // (advisory lock par (journal, année), MAX entryNumber séquentiel).
  // ------------------------------------------------------------------

  private async generateEntryNumber(
    tx: Prisma.TransactionClient,
    journal: JournalType,
  ): Promise<string> {
    const year = new Date().getFullYear();
    const lockKey = this.hashToBigInt(`je_${journal}_${year}`);
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${lockKey})`);
    const last = await tx.journalEntry.findFirst({
      where: { journal, entryNumber: { startsWith: `${journal}-${year}-` } },
      orderBy: { entryNumber: 'desc' },
      select: { entryNumber: true },
    });
    const lastSeq = last ? parseInt(last.entryNumber.split('-')[2] ?? '0', 10) : 0;
    const next = Number.isFinite(lastSeq) ? lastSeq + 1 : 1;
    return `${journal}-${year}-${String(next).padStart(4, '0')}`;
  }

  private hashToBigInt(s: string): bigint {
    let h = 0n;
    for (let i = 0; i < s.length; i += 1) {
      h = (h * 31n + BigInt(s.charCodeAt(i))) & 0x7fffffffffffffffn;
    }
    return h;
  }

  private round2(v: Prisma.Decimal | number): number {
    const n = v instanceof Prisma.Decimal ? v.toNumber() : v;
    return Math.round(n * 100) / 100;
  }
}

/** Type exporté pour les tests/UI quand on veut lire un JournalEntry FNP. */
export type AccrualEntry = JournalEntry;

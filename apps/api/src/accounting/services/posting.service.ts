import { Injectable, Logger } from '@nestjs/common';
import { JournalType, EntryStatus } from '@prisma/client';
import type { JournalEntry, JournalLine, Prisma, PurchaseOrder } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  EntityNotFoundException,
  NoOpenFiscalPeriodException,
} from '../../common/exceptions/business.exception';

/** Comptes utilisés pour l'engagement classe 8. */
export const ACCOUNT_ENGAGEMENT_DONNE = '801';
export const ACCOUNT_CONTRE_ENGAGEMENT = '802';

/** Type d'écriture émis par ce service — utilisé en `source_type`. */
export const SOURCE_TYPE_PO = 'purchase_order';

export interface PostingActor {
  id: string;
  email: string;
  fullName?: string;
}

/**
 * Service de comptabilisation.
 *
 * Pour le sprint 3, on ne traite que l'engagement classe 8 lié à un BC.
 * Le service est conçu pour accueillir les autres flux (facturation,
 * paiement, overhead, fonds dédiés) dans les sprints suivants.
 *
 * Invariants enforced ici :
 *  - Une écriture posted est équilibrée (∑debit = ∑credit) — calculé en
 *    application avant de promouvoir l'entry à `posted`, le trigger DB
 *    rejette toute modification ultérieure qui casserait l'équilibre.
 *  - Période fiscale ouverte couvrant la date — sinon le trigger DB
 *    refuse l'INSERT. On pré-cherche la période côté app pour donner un
 *    code d'erreur métier propre (NO_OPEN_FISCAL_PERIOD) au lieu d'un
 *    cryptique 500 PostgreSQL.
 *  - Imputation analytique (project_id / grant_id / budget_line_id /
 *    cost_center_id / activity_id) recopiée de la PR liée pour traçabilité.
 */
@Injectable()
export class PostingService {
  private readonly logger = new Logger(PostingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Crée l'écriture d'engagement comptable classe 8 pour un BC envoyé.
   *
   * 2 lignes :
   *   - 801 (Engagements donnés)         debit  = po.totalHt
   *   - 802 (Contre-engagement)          credit = po.totalHt
   *
   * Imputation analytique : recopiée de la 1ʳᵉ DA liée (project, grant,
   * budget line, cost center, activity).
   *
   * @returns la JournalEntry créée (status = posted, lines incluses)
   */
  async createCommitmentEntry(
    po: PurchaseOrder & { prLinks?: Array<{ prId: string }> },
    actor: PostingActor,
  ): Promise<JournalEntry & { lines: JournalLine[] }> {
    const period = await this.findOpenPeriodForDate(po.orderDate);
    const imputation = await this.resolveImputation(po);
    const total = Number(po.totalHt);
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: po.supplierId },
      select: { name: true },
    });
    const supplierName = supplier?.name ?? 'fournisseur inconnu';

    return this.prisma.$transaction(async (tx) => {
      const entryNumber = await this.generateEntryNumber(tx, JournalType.OD);

      // 1) Création en draft (le trigger balance ne se déclenche que sur posted).
      const entry = await tx.journalEntry.create({
        data: {
          entryNumber,
          journal: JournalType.OD,
          entryDate: po.orderDate,
          periodId: period.id,
          label: `Engagement BC ${po.poNumber} - ${supplierName}`,
          sourceType: SOURCE_TYPE_PO,
          sourceId: po.id,
          status: EntryStatus.draft,
        },
      });

      const baseImputation = {
        projectId: imputation.projectId,
        grantId: imputation.grantId,
        budgetLineId: imputation.budgetLineId,
        costCenterId: imputation.costCenterId,
        activityId: imputation.activityId,
      };

      await tx.journalLine.createMany({
        data: [
          {
            entryId: entry.id,
            lineNumber: 1,
            accountCode: ACCOUNT_ENGAGEMENT_DONNE,
            label: `Engagement ${po.poNumber}`,
            debit: total,
            credit: 0,
            currency: po.currency,
            ...baseImputation,
          },
          {
            entryId: entry.id,
            lineNumber: 2,
            accountCode: ACCOUNT_CONTRE_ENGAGEMENT,
            label: `Contre-engagement ${po.poNumber}`,
            debit: 0,
            credit: total,
            currency: po.currency,
            ...baseImputation,
          },
        ],
      });

      // 2) Promotion en posted + posted_by/at.
      const posted = await tx.journalEntry.update({
        where: { id: entry.id },
        data: {
          status: EntryStatus.posted,
          postedAt: new Date(),
          postedBy: actor.id,
        },
        include: { lines: { orderBy: { lineNumber: 'asc' } } },
      });

      this.logger.log(
        { entryNumber, poId: po.id, total, currency: po.currency },
        'commitment entry posted',
      );
      return posted;
    });
  }

  /**
   * Extourne l'écriture d'engagement classe 8 d'un BC annulé.
   *
   * Stratégie : on génère une nouvelle entry avec les lignes inversées
   * (801 credit / 802 debit, mêmes montants), on chaîne via `reversedById`
   * sur l'entry d'origine.
   *
   * @returns la nouvelle entry (status = posted)
   */
  async reverseCommitmentEntry(
    po: PurchaseOrder,
    actor: PostingActor,
    reason: string,
  ): Promise<JournalEntry & { lines: JournalLine[] }> {
    const original = await this.prisma.journalEntry.findFirst({
      where: {
        sourceType: SOURCE_TYPE_PO,
        sourceId: po.id,
        status: EntryStatus.posted,
        reversedById: null,
      },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });
    if (!original) {
      throw new EntityNotFoundException('JournalEntry', { sourceType: SOURCE_TYPE_PO, sourceId: po.id });
    }

    const today = new Date();
    const period = await this.findOpenPeriodForDate(today);

    return this.prisma.$transaction(async (tx) => {
      const entryNumber = await this.generateEntryNumber(tx, JournalType.OD);

      const reverse = await tx.journalEntry.create({
        data: {
          entryNumber,
          journal: JournalType.OD,
          entryDate: today,
          periodId: period.id,
          label: `Extourne engagement BC ${po.poNumber} - ${reason}`,
          sourceType: SOURCE_TYPE_PO,
          sourceId: po.id,
          status: EntryStatus.draft,
        },
      });

      // Lignes inversées : debit ↔ credit, mêmes comptes, même imputation.
      await tx.journalLine.createMany({
        data: original.lines.map((l) => ({
          entryId: reverse.id,
          lineNumber: l.lineNumber,
          accountCode: l.accountCode,
          label: `Extourne ${l.label ?? ''}`.trim(),
          debit: Number(l.credit),
          credit: Number(l.debit),
          currency: l.currency,
          projectId: l.projectId,
          grantId: l.grantId,
          budgetLineId: l.budgetLineId,
          costCenterId: l.costCenterId,
          activityId: l.activityId,
        })),
      });

      const posted = await tx.journalEntry.update({
        where: { id: reverse.id },
        data: {
          status: EntryStatus.posted,
          postedAt: new Date(),
          postedBy: actor.id,
        },
        include: { lines: { orderBy: { lineNumber: 'asc' } } },
      });

      // Marquer l'écriture d'origine comme reversed.
      await tx.journalEntry.update({
        where: { id: original.id },
        data: { reversedById: posted.id, status: EntryStatus.reversed },
      });

      this.logger.log(
        { entryNumber, poId: po.id, originalEntry: original.entryNumber, reason },
        'commitment entry reversed',
      );
      return posted;
    });
  }

  /**
   * Liste les écritures comptables liées à un PO (source_type / source_id),
   * lignes incluses.
   */
  async listEntriesForPo(poId: string): Promise<Array<JournalEntry & { lines: JournalLine[] }>> {
    return this.prisma.journalEntry.findMany({
      where: { sourceType: SOURCE_TYPE_PO, sourceId: poId },
      orderBy: { createdAt: 'asc' },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  /**
   * Cherche la période fiscale ouverte qui couvre la `date` donnée. On
   * privilégie le type "month" (granularité minimale du mécanisme de
   * fermeture mensuelle, cf. seed sprint 0). À défaut, "quarter" puis
   * "year". Si aucune n'est ouverte → 409.
   */
  private async findOpenPeriodForDate(date: Date) {
    const periods = await this.prisma.fiscalPeriod.findMany({
      where: {
        isClosed: false,
        startDate: { lte: date },
        endDate: { gte: date },
      },
      orderBy: [{ periodType: 'asc' }],
    });
    // Préférer "month" puis "quarter" puis "year" (granularité fine).
    const preferred =
      periods.find((p) => p.periodType === 'month') ??
      periods.find((p) => p.periodType === 'quarter') ??
      periods.find((p) => p.periodType === 'year');
    if (!preferred) {
      throw new NoOpenFiscalPeriodException(date.toISOString().slice(0, 10));
    }
    return preferred;
  }

  /**
   * Imputation analytique : on remonte à la 1ʳᵉ PR liée pour récupérer
   * projectId / grantId / costCenterId / activityId, et à la 1ʳᵉ PR-line
   * pour récupérer budgetLineId. Suffisant pour le sprint 3 — quand on
   * voudra ventiler par ligne du PO, on créera plusieurs lignes 801/802
   * (1 paire par budget line). Hors scope ici.
   */
  private async resolveImputation(
    po: PurchaseOrder & { prLinks?: Array<{ prId: string }> },
  ): Promise<{
    projectId: string | null;
    grantId: string | null;
    budgetLineId: string | null;
    costCenterId: string | null;
    activityId: string | null;
  }> {
    const prId = po.prId ?? po.prLinks?.[0]?.prId ?? null;
    if (!prId) {
      // PO orphelin (pas de PR liée) : pas d'imputation. Cas pathologique
      // — le service createFromPr s'assure qu'il y a toujours ≥ 1 PR.
      return { projectId: null, grantId: null, budgetLineId: null, costCenterId: null, activityId: null };
    }
    const pr = await this.prisma.purchaseRequest.findUnique({
      where: { id: prId },
      select: {
        projectId: true,
        grantId: true,
        costCenterId: true,
        activityId: true,
        lines: { select: { budgetLineId: true }, take: 1 },
      },
    });
    return {
      projectId: pr?.projectId ?? null,
      grantId: pr?.grantId ?? null,
      budgetLineId: pr?.lines?.[0]?.budgetLineId ?? null,
      costCenterId: pr?.costCenterId ?? null,
      activityId: pr?.activityId ?? null,
    };
  }

  /**
   * Numéro de pièce comptable — `<JOURNAL>-YYYY-NNNN` séquentiel par
   * (journal, année). Verrou advisory pour éviter les collisions sous
   * concurrence (même approche que generatePrNumber dans
   * PurchaseRequestService).
   */
  private async generateEntryNumber(
    tx: Prisma.TransactionClient,
    journal: JournalType,
  ): Promise<string> {
    const year = new Date().getFullYear();
    const lockKey = this.hashToBigInt(`je_${journal}_${year}`);
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${lockKey})`);
    const count = await tx.journalEntry.count({
      where: { journal, entryNumber: { startsWith: `${journal}-${year}-` } },
    });
    return `${journal}-${year}-${String(count + 1).padStart(4, '0')}`;
  }

  private hashToBigInt(s: string): bigint {
    let h = 0n;
    for (let i = 0; i < s.length; i += 1) {
      h = (h * 31n + BigInt(s.charCodeAt(i))) & 0x7fffffffffffffffn;
    }
    return h;
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { EntryStatus, JournalType, Prisma } from '@prisma/client';
import type { FiscalPeriod } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  EntityNotFoundException,
  InvalidClassPrefixException,
  PeriodAlreadyClosedException,
  PeriodNotFoundException,
} from '../../common/exceptions/business.exception';
import type { PrepaymentEntryInput } from '../dto/prepayment.dto';

/** Compte SYSCEBNL — Charges constatées d'avance (CCA). */
export const ACCOUNT_PREPAID_EXPENSE = '476';
/** Compte SYSCEBNL — Produits constatés d'avance (PCA). */
export const ACCOUNT_DEFERRED_INCOME = '477';

export const SOURCE_TYPE_PREPAYMENT_CCA = 'prepayment_cca';
export const SOURCE_TYPE_PREPAYMENT_PCA = 'prepayment_pca';
export const SOURCE_TYPE_PREPAYMENT_CCA_REVERSAL = 'prepayment_cca_reversal';
export const SOURCE_TYPE_PREPAYMENT_PCA_REVERSAL = 'prepayment_pca_reversal';

export interface PrepaymentActor {
  id: string;
  email: string;
  fullName?: string;
}

export interface PrepaymentLineResult {
  direction: 'CCA' | 'PCA';
  label: string;
  amount: number;
  prepaymentEntryId: string;
  reversalEntryId: string | null;
}

export interface PrepaymentsRunResult {
  periodId: string;
  periodCode: string;
  processed: number;
  totalCca: number;
  totalPca: number;
  lines: PrepaymentLineResult[];
  reversalsPeriodId: string | null;
}

/**
 * Constatation des régularisations CCA / PCA à la clôture (sprint F5b-a Lot 3).
 *
 * Patron comptable SYSCEBNL — symétrique du Lot 2 (FNP) :
 *
 *   CCA (Charge Constatée d'Avance) :
 *     - Clôture N    : Débit 476, Crédit <compte charge>  → neutralise la
 *                       partie de la charge qui concerne N+1.
 *     - Ouverture N+1 : Débit <compte charge>, Crédit 476  (extourne).
 *
 *   PCA (Produit Constaté d'Avance) :
 *     - Clôture N    : Débit <compte produit>, Crédit 477  → reporte le
 *                       produit dont la prestation reste à fournir.
 *     - Ouverture N+1 : Débit 477, Crédit <compte produit> (extourne).
 *
 * Contrairement aux FNP (Lot 2) qui se détectent automatiquement, les
 * régularisations exigent la saisie explicite par le comptable/CG via
 * le DTO RunPrepaymentsDto — chaque entrée est validée :
 *   - accountCode existe au plan (sinon GlAccountNotFoundException)
 *   - classe cohérente avec direction (CCA → 6x, PCA → 7x)
 *
 * Aucun trigger / CHECK / GENERATED du DDL n'est touché. Toutes les
 * écritures sont équilibrées en TypeScript avant insert.
 */
@Injectable()
export class PrepaymentService {
  private readonly logger = new Logger(PrepaymentService.name);

  constructor(private readonly prisma: PrismaService) {}

  async runPrepayments(
    actor: PrepaymentActor,
    periodId: string,
    entries: PrepaymentEntryInput[],
  ): Promise<PrepaymentsRunResult> {
    const period = await this.prisma.fiscalPeriod.findUnique({ where: { id: periodId } });
    if (!period) throw new PeriodNotFoundException(periodId);
    if (period.isClosed) throw new PeriodAlreadyClosedException(period.id, period.code);

    // Pré-charge tous les comptes utilisés (charges/produits + 476/477) pour
    // valider l'existence + la classe en un seul query.
    const accountCodes = Array.from(
      new Set([
        ACCOUNT_PREPAID_EXPENSE,
        ACCOUNT_DEFERRED_INCOME,
        ...entries.map((e) => e.accountCode),
      ]),
    );
    const accounts = await this.prisma.glAccount.findMany({
      where: { code: { in: accountCodes } },
      select: { code: true, class: true, label: true },
    });
    const accountByCode = new Map(accounts.map((a) => [a.code, a]));

    // Vérification existence des 2 comptes pivot (476/477) — devrait être
    // garanti par le seed/DDL après Lot 3, mais on défend en runtime.
    if (!accountByCode.has(ACCOUNT_PREPAID_EXPENSE)) {
      throw new EntityNotFoundException('GlAccount', { code: ACCOUNT_PREPAID_EXPENSE });
    }
    if (!accountByCode.has(ACCOUNT_DEFERRED_INCOME)) {
      throw new EntityNotFoundException('GlAccount', { code: ACCOUNT_DEFERRED_INCOME });
    }

    // Vérification de chaque entrée (existence + cohérence classe).
    for (const e of entries) {
      const acct = accountByCode.get(e.accountCode);
      if (!acct) throw new EntityNotFoundException('GlAccount', { code: e.accountCode });
      const expectedClassPrefix = e.direction === 'CCA' ? '6' : '7';
      if (!acct.class.startsWith(expectedClassPrefix)) {
        // CCA exige un compte de charge (classe 6), PCA un compte de produit
        // (classe 7) — sinon l'écriture inversée n'aurait aucun sens
        // comptable. Le message rappelle l'attendu.
        throw new InvalidClassPrefixException(e.accountCode, expectedClassPrefix);
      }
    }

    const nextPeriod = await this.findNextPeriod(period);
    if (!nextPeriod) {
      this.logger.warn(
        { periodCode: period.code, entries: entries.length },
        'no next fiscal period found — prepayments will be created WITHOUT auto-reversal',
      );
    }

    const lines: PrepaymentLineResult[] = [];
    let totalCca = 0;
    let totalPca = 0;

    for (const entry of entries) {
      const line = await this.processOnePrepayment(actor, period, nextPeriod, entry);
      lines.push(line);
      if (entry.direction === 'CCA') totalCca += line.amount;
      else totalPca += line.amount;
    }

    await this.prisma.periodCloseEvent.create({
      data: {
        periodId,
        action: 'prepayments_regularization',
        userId: actor.id,
        payload: {
          processed: lines.length,
          totalCca,
          totalPca,
          nextPeriodId: nextPeriod?.id ?? null,
        } as Prisma.InputJsonValue,
      },
    });

    this.logger.log(
      {
        periodCode: period.code,
        processed: lines.length,
        totalCca,
        totalPca,
        actor: actor.email,
      },
      'prepayments regularization run completed',
    );

    return {
      periodId,
      periodCode: period.code,
      processed: lines.length,
      totalCca: this.round2(totalCca),
      totalPca: this.round2(totalPca),
      lines,
      reversalsPeriodId: nextPeriod?.id ?? null,
    };
  }

  // ------------------------------------------------------------------
  // Per-entry — création écriture + extourne
  // ------------------------------------------------------------------

  private async processOnePrepayment(
    actor: PrepaymentActor,
    period: FiscalPeriod,
    nextPeriod: FiscalPeriod | null,
    entry: PrepaymentEntryInput,
  ): Promise<PrepaymentLineResult> {
    const sourceType =
      entry.direction === 'CCA' ? SOURCE_TYPE_PREPAYMENT_CCA : SOURCE_TYPE_PREPAYMENT_PCA;
    const reversalSourceType =
      entry.direction === 'CCA'
        ? SOURCE_TYPE_PREPAYMENT_CCA_REVERSAL
        : SOURCE_TYPE_PREPAYMENT_PCA_REVERSAL;

    // Sens des comptes :
    //   CCA → débit 476, crédit <accountCode (charge classe 6)>
    //   PCA → débit <accountCode (produit classe 7)>, crédit 477
    const [debitAccount, creditAccount] =
      entry.direction === 'CCA'
        ? [ACCOUNT_PREPAID_EXPENSE, entry.accountCode]
        : [entry.accountCode, ACCOUNT_DEFERRED_INCOME];

    const amount = this.round2(entry.amount);

    const baseImputation = {
      grantId: entry.grantId ?? null,
      budgetLineId: entry.budgetLineId ?? null,
      projectId: entry.projectId ?? null,
      costCenterId: entry.costCenterId ?? null,
      activityId: entry.activityId ?? null,
    };

    const result = await this.prisma.$transaction(async (tx) => {
      // 1) Régularisation clôture
      const number = await this.generateEntryNumber(tx, JournalType.OD);
      const labelPrefix = entry.direction === 'CCA' ? 'CCA' : 'PCA';
      const sourceRef = entry.sourceReference ? ` [${entry.sourceReference}]` : '';
      const regEntry = await tx.journalEntry.create({
        data: {
          entryNumber: number,
          journal: JournalType.OD,
          entryDate: period.endDate,
          periodId: period.id,
          label: `${labelPrefix} ${entry.label}${sourceRef}`.slice(0, 256),
          sourceType,
          sourceId: null, // pas d'entité source unique — référence textuelle dans label
          status: EntryStatus.draft,
        },
      });
      await tx.journalLine.createMany({
        data: [
          {
            entryId: regEntry.id,
            lineNumber: 1,
            accountCode: debitAccount,
            label: `${labelPrefix} (D) ${entry.label}`.slice(0, 256),
            debit: new Prisma.Decimal(amount.toString()),
            credit: new Prisma.Decimal(0),
            currency: 'XOF',
            ...baseImputation,
          },
          {
            entryId: regEntry.id,
            lineNumber: 2,
            accountCode: creditAccount,
            label: `${labelPrefix} (C) ${entry.label}`.slice(0, 256),
            debit: new Prisma.Decimal(0),
            credit: new Prisma.Decimal(amount.toString()),
            currency: 'XOF',
            ...baseImputation,
          },
        ],
      });
      await tx.journalEntry.update({
        where: { id: regEntry.id },
        data: { status: EntryStatus.posted, postedAt: new Date(), postedBy: actor.id },
      });

      // 2) Extourne sur la période suivante (si elle existe, non close)
      let reversalId: string | null = null;
      if (nextPeriod && !nextPeriod.isClosed) {
        const revNumber = await this.generateEntryNumber(tx, JournalType.OD);
        const reversal = await tx.journalEntry.create({
          data: {
            entryNumber: revNumber,
            journal: JournalType.OD,
            entryDate: nextPeriod.startDate,
            periodId: nextPeriod.id,
            label: `Extourne ${labelPrefix} ${entry.label}${sourceRef}`.slice(0, 256),
            sourceType: reversalSourceType,
            sourceId: null,
            status: EntryStatus.draft,
          },
        });
        // Lignes inversées (debit ↔ credit)
        await tx.journalLine.createMany({
          data: [
            {
              entryId: reversal.id,
              lineNumber: 1,
              accountCode: creditAccount, // ex-crédit devient débit
              label: `Extourne ${labelPrefix} (D) ${entry.label}`.slice(0, 256),
              debit: new Prisma.Decimal(amount.toString()),
              credit: new Prisma.Decimal(0),
              currency: 'XOF',
              ...baseImputation,
            },
            {
              entryId: reversal.id,
              lineNumber: 2,
              accountCode: debitAccount, // ex-débit devient crédit
              label: `Extourne ${labelPrefix} (C) ${entry.label}`.slice(0, 256),
              debit: new Prisma.Decimal(0),
              credit: new Prisma.Decimal(amount.toString()),
              currency: 'XOF',
              ...baseImputation,
            },
          ],
        });
        await tx.journalEntry.update({
          where: { id: reversal.id },
          data: { status: EntryStatus.posted, postedAt: new Date(), postedBy: actor.id },
        });
        await tx.journalEntry.update({
          where: { id: regEntry.id },
          data: { reversedById: reversal.id },
        });
        reversalId = reversal.id;
      }
      return { regId: regEntry.id, reversalId };
    });

    return {
      direction: entry.direction,
      label: entry.label,
      amount,
      prepaymentEntryId: result.regId,
      reversalEntryId: result.reversalId,
    };
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  private async findNextPeriod(current: FiscalPeriod): Promise<FiscalPeriod | null> {
    return this.prisma.fiscalPeriod.findFirst({
      where: {
        periodType: current.periodType,
        startDate: { gt: current.endDate },
      },
      orderBy: { startDate: 'asc' },
    });
  }

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

  private round2(v: number): number {
    return Math.round(v * 100) / 100;
  }
}

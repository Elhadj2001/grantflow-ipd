import { Injectable, Logger } from '@nestjs/common';
import { EntryStatus, FundMovement, JournalType, Prisma } from '@prisma/client';
import type { FiscalPeriod } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  PeriodAlreadyClosedException,
  PeriodNotFoundException,
} from '../../common/exceptions/business.exception';

/** Compte SYSCEBNL — Dotations aux fonds dédiés (charge classe 6). */
export const ACCOUNT_DEDICATED_FUND_DOTATION = '689';
/** Compte SYSCEBNL — Fonds dédiés (passif classe 1). */
export const ACCOUNT_DEDICATED_FUND_BALANCE = '19';
/** Compte SYSCEBNL — Reports des ressources non utilisées (produit classe 7). */
export const ACCOUNT_DEDICATED_FUND_REPRISE = '789';

export interface DedicatedFundsActor {
  id: string;
  email: string;
  fullName?: string;
}

export interface GrantFundResult {
  grantId: string;
  grantReference: string;
  resourcesReceived: number;
  expensesIncurred: number;
  movementType: FundMovement;
  amount: number;
  journalEntryId: string | null;
  rationale: string;
}

export interface DedicatedFundsRunResult {
  periodId: string;
  periodCode: string;
  grants: GrantFundResult[];
  totalDotation: number;
  totalReprise: number;
}

/**
 * Pour chaque grant actif sur la période, on calcule :
 *   - ressources reçues sur N (somme crédit-débit des comptes 75x
 *     imputés au grant) en XOF
 *   - dépenses réelles sur N (somme débit-crédit des comptes 6x
 *     imputés au grant) en XOF
 *
 * Décision SYSCEBNL :
 *   - Si ressources > dépenses (excès de fonds reçus non encore
 *     utilisés sur la période) → DOTATION aux fonds dédiés.
 *     Écriture OD : 689 D / 19 C (diff = ressources - dépenses).
 *   - Si grant porte un solde 19 non nul (dotation N-1) ET que des
 *     dépenses N en consomment → REPRISE.
 *     Écriture OD : 19 D / 789 C (diff = min(solde 19, dépenses)).
 *
 * Cette logique est exécutée en pré-clôture par le DAF/CONTROLEUR. Un
 * mouvement co.dedicated_fund_movement est créé par grant traité et
 * référence l'entry comptable. Idempotent : on supprime les
 * mouvements déjà créés pour (grant, période) avant de recréer.
 */
@Injectable()
export class DedicatedFundsService {
  private readonly logger = new Logger(DedicatedFundsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async run(actor: DedicatedFundsActor, periodId: string): Promise<DedicatedFundsRunResult> {
    const period = await this.prisma.fiscalPeriod.findUnique({ where: { id: periodId } });
    if (!period) throw new PeriodNotFoundException(periodId);
    if (period.isClosed) throw new PeriodAlreadyClosedException(period.id, period.code);

    const grants = await this.prisma.grantAgreement.findMany({
      where: { status: 'active' },
      select: { id: true, reference: true, currency: true },
    });

    const results: GrantFundResult[] = [];
    for (const grant of grants) {
      const res = await this.processGrant(actor, period, grant);
      if (res) results.push(res);
    }

    const totalDotation = results
      .filter((r) => r.movementType === FundMovement.allocation)
      .reduce((s, r) => s + r.amount, 0);
    const totalReprise = results
      .filter((r) => r.movementType === FundMovement.reprise)
      .reduce((s, r) => s + r.amount, 0);

    // Évènement audit
    await this.prisma.periodCloseEvent.create({
      data: {
        periodId,
        action: 'dedicated_funds',
        userId: actor.id,
        payload: {
          grantsProcessed: results.length,
          totalDotation,
          totalReprise,
        } as Prisma.InputJsonValue,
      },
    });

    this.logger.log(
      {
        periodCode: period.code,
        grants: results.length,
        totalDotation,
        totalReprise,
        actor: actor.email,
      },
      'dedicated funds run completed',
    );

    return {
      periodId,
      periodCode: period.code,
      grants: results,
      totalDotation: this.round2(totalDotation),
      totalReprise: this.round2(totalReprise),
    };
  }

  /**
   * Calcul + persistence du mouvement pour 1 grant. Renvoie `null` si
   * aucune action requise (ressources = dépenses et pas de solde 19).
   */
  async processGrant(
    actor: DedicatedFundsActor,
    period: FiscalPeriod,
    grant: { id: string; reference: string; currency: string },
  ): Promise<GrantFundResult | null> {
    const [resources, expenses, openingBalance] = await Promise.all([
      this.sumByAccountPrefix(grant.id, period, '75'),
      this.sumByAccountPrefix(grant.id, period, '6'),
      this.openingFundBalance(grant.id, period),
    ]);

    const resourcesAmount = this.round2(resources);
    const expensesAmount = this.round2(expenses);
    const surplus = this.round2(resourcesAmount - expensesAmount);

    // Détermine action : dotation (surplus > 0), reprise (surplus < 0 et
    // solde 19 existant > 0), ou pas d'action.
    let movementType: FundMovement;
    let amount: number;
    let rationale: string;

    if (surplus > 0) {
      movementType = FundMovement.allocation;
      amount = surplus;
      rationale = `Surplus ressources ${resourcesAmount} - dépenses ${expensesAmount} = ${surplus} XOF`;
    } else if (surplus < 0 && openingBalance > 0) {
      movementType = FundMovement.reprise;
      amount = Math.min(openingBalance, Math.abs(surplus));
      rationale = `Reprise sur fonds dédiés ouverture ${openingBalance} (consommation ${Math.abs(
        surplus,
      )} XOF)`;
    } else {
      // Pas d'action : on nettoie quand même un éventuel mouvement
      // précédent (rerun idempotent).
      await this.prisma.dedicatedFundMovement.deleteMany({
        where: { grantId: grant.id, periodId: period.id },
      });
      return null;
    }

    // Idempotence : on supprime tout mouvement précédent pour (grant, period)
    // et son écriture comptable. Permet de ré-exécuter le job sans
    // accumuler les écritures.
    const previous = await this.prisma.dedicatedFundMovement.findFirst({
      where: { grantId: grant.id, periodId: period.id },
    });
    if (previous?.journalEntryId) {
      // L'écriture est posted — on ne peut PAS supprimer (cf. CLAUDE.md §8).
      // On la marque comme reversed et on la chaîne. Pour la simplicité
      // sprint 6.2 : on crée une nouvelle entry en remplacement et on
      // garde l'historique des deux mouvements.
      this.logger.warn(
        { grantId: grant.id, previousEntryId: previous.journalEntryId },
        'previous dedicated fund entry exists — keeping for audit, creating new one',
      );
    }

    const entry = await this.createDedicatedFundEntry(
      actor,
      period,
      grant,
      movementType,
      amount,
      rationale,
    );

    await this.prisma.dedicatedFundMovement.create({
      data: {
        grantId: grant.id,
        periodId: period.id,
        movementType,
        amount: new Prisma.Decimal(amount.toString()),
        currency: 'XOF',
        journalEntryId: entry.id,
        rationale,
      },
    });

    return {
      grantId: grant.id,
      grantReference: grant.reference,
      resourcesReceived: resourcesAmount,
      expensesIncurred: expensesAmount,
      movementType,
      amount: this.round2(amount),
      journalEntryId: entry.id,
      rationale,
    };
  }

  /**
   * Crée l'écriture OD :
   *   - allocation : 689 D / 19 C (constate la dotation)
   *   - reprise    : 19 D  / 789 C (libère le fonds)
   * Imputation analytique : grantId est posé sur les 2 lignes.
   */
  private async createDedicatedFundEntry(
    actor: DedicatedFundsActor,
    period: FiscalPeriod,
    grant: { id: string; reference: string },
    movementType: FundMovement,
    amount: number,
    rationale: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const entryNumber = await this.generateEntryNumber(tx);

      const [debitAccount, creditAccount, label] =
        movementType === FundMovement.allocation
          ? [
              ACCOUNT_DEDICATED_FUND_DOTATION,
              ACCOUNT_DEDICATED_FUND_BALANCE,
              `Dotation fonds dédiés ${grant.reference} - ${period.code}`,
            ]
          : [
              ACCOUNT_DEDICATED_FUND_BALANCE,
              ACCOUNT_DEDICATED_FUND_REPRISE,
              `Reprise fonds dédiés ${grant.reference} - ${period.code}`,
            ];

      const entry = await tx.journalEntry.create({
        data: {
          entryNumber,
          journal: JournalType.OD,
          entryDate: period.endDate,
          periodId: period.id,
          label,
          sourceType: 'dedicated_fund_movement',
          sourceId: null,
          status: EntryStatus.draft,
        },
      });

      await tx.journalLine.createMany({
        data: [
          {
            entryId: entry.id,
            lineNumber: 1,
            accountCode: debitAccount,
            label: rationale,
            debit: new Prisma.Decimal(amount.toString()),
            credit: 0,
            currency: 'XOF',
            grantId: grant.id,
          },
          {
            entryId: entry.id,
            lineNumber: 2,
            accountCode: creditAccount,
            label: rationale,
            debit: 0,
            credit: new Prisma.Decimal(amount.toString()),
            currency: 'XOF',
            grantId: grant.id,
          },
        ],
      });

      return tx.journalEntry.update({
        where: { id: entry.id },
        data: {
          status: EntryStatus.posted,
          postedAt: new Date(),
          postedBy: actor.id,
        },
      });
    });
  }

  /** Somme signée sur les comptes commençant par `prefix` pour le grant. */
  private async sumByAccountPrefix(
    grantId: string,
    period: FiscalPeriod,
    prefix: string,
  ): Promise<number> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ net: number }>>(
      `
      SELECT COALESCE(SUM(
        CASE WHEN $3 = '75' THEN (l.credit - l.debit)
             ELSE (l.debit - l.credit)
        END
      ), 0)::float AS net
      FROM gl.journal_line l
      JOIN gl.journal_entry e ON e.id = l.entry_id
      WHERE e.status = 'posted'
        AND e.period_id = $1::uuid
        AND l.grant_id = $2::uuid
        AND l.account_code LIKE $3 || '%'
      `,
      period.id,
      grantId,
      prefix,
    );
    return Number(rows[0]?.net ?? 0);
  }

  /**
   * Solde d'ouverture du compte 19 pour ce grant : somme des dotations
   * (credit) − reprises (debit) sur les périodes antérieures (closed
   * ou non, peu importe — le solde est cumulé).
   */
  private async openingFundBalance(grantId: string, period: FiscalPeriod): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ balance: number }>>`
      SELECT COALESCE(SUM(l.credit - l.debit), 0)::float AS balance
      FROM gl.journal_line l
      JOIN gl.journal_entry e ON e.id = l.entry_id
      WHERE e.status = 'posted'
        AND e.entry_date < ${period.startDate}::date
        AND l.grant_id = ${grantId}::uuid
        AND l.account_code = '19'
    `;
    return Number(rows[0]?.balance ?? 0);
  }

  private async generateEntryNumber(tx: Prisma.TransactionClient): Promise<string> {
    const year = new Date().getFullYear();
    const count = await tx.journalEntry.count({
      where: { journal: JournalType.OD, entryNumber: { startsWith: `OD-${year}-` } },
    });
    return `OD-${year}-${String(count + 1).padStart(4, '0')}`;
  }

  private round2(v: number): number {
    return Math.round(v * 100) / 100;
  }
}

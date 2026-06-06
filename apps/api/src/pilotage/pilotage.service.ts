import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  EntityNotFoundException,
  PiNotOwnerOfProjectException,
} from '../common/exceptions/business.exception';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import {
  BreakdownDimension,
  BreakdownEntryDto,
  BreakdownResponseDto,
  DedicatedFundsResponseDto,
  MyProjectsResponseDto,
  OverheadResponseDto,
  TransactionDto,
  TransactionsQuery,
  TransactionsResponseDto,
} from './dto/pilotage.dto';

const GRANT_ENTITY = 'Grant';

/** Préfixes de compte_code par typologie SYSCEBNL utilisée pour la breakdown. */
const EXPENSE_PREFIXES = ['6']; // charges classe 6
const REVENUE_PREFIXES = ['7']; // produits classe 7
const OVERHEAD_REVERSAL_PREFIX = '754'; // remboursement frais administratifs facturés au bailleur

/** Mapping sourceType (journal_entry) → famille UI cliente. */
const SOURCE_FAMILY: Record<string, 'pr' | 'po' | 'invoice' | 'payment' | 'od'> = {
  purchase_request: 'pr',
  purchase_order: 'po',
  goods_receipt: 'po',
  invoice: 'invoice',
  payment_run: 'payment',
  payment: 'payment',
  dedicated_fund_movement: 'od',
  overhead_calculation: 'od',
};

interface RawTransaction {
  entry_id: string;
  entry_number: string;
  entry_date: Date;
  journal: string;
  label: string;
  source_type: string | null;
  source_id: string | null;
  account_code: string;
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
  currency: string;
  status: string;
}

interface RawBreakdownRow {
  key: string;
  label: string | null;
  amount: number;
}

@Injectable()
export class PilotageService {
  private readonly logger = new Logger(PilotageService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ------------------------------------------------------------------
  // /grants/my-projects — PI only (cross-PI safe)
  // ------------------------------------------------------------------

  async myProjects(actor: AuthenticatedUser): Promise<MyProjectsResponseDto> {
    const appUserId = await this.resolveAppUserId(actor);

    const projects = await this.prisma.project.findMany({
      where: { piUserId: appUserId },
      include: {
        grants: {
          where: { status: { in: ['draft', 'active', 'suspended'] } },
          include: { donor: { select: { code: true, label: true } } },
          orderBy: { startDate: 'desc' },
        },
      },
      orderBy: { code: 'asc' },
    });

    const data = projects.map((p) => ({
      id: p.id,
      code: p.code,
      title: p.title,
      status: p.status,
      grants: p.grants.map((g) => ({
        id: g.id,
        reference: g.reference,
        amount: Number(g.amount),
        currency: g.currency,
        startDate: g.startDate.toISOString().slice(0, 10),
        endDate: g.endDate.toISOString().slice(0, 10),
        status: g.status,
        donorCode: g.donor.code,
        donorLabel: g.donor.label,
      })),
    }));

    return { piUserId: appUserId, data, total: data.length };
  }

  // ------------------------------------------------------------------
  // Cross-PI safety helper
  // ------------------------------------------------------------------

  /**
   * Garde-fou : un PI ne voit que les grants des projets dont il est piUserId.
   * CG / DAF / SUPER_ADMIN bypassent.
   * Lève PiNotOwnerOfProjectException si un PI tente d'accéder à un grant
   * dont il n'est pas owner.
   */
  async assertCanViewGrant(actor: AuthenticatedUser, grantId: string): Promise<void> {
    const privileged =
      actor.roles.includes('SUPER_ADMIN') ||
      actor.roles.includes('DAF') ||
      actor.roles.includes('CONTROLEUR');
    if (privileged) return;

    if (!actor.roles.includes('PI')) return; // autres rôles : RBAC du contrôleur fait foi

    const grant = await this.prisma.grantAgreement.findUnique({
      where: { id: grantId },
      select: { id: true, project: { select: { piUserId: true } } },
    });
    if (!grant) throw new EntityNotFoundException(GRANT_ENTITY, { id: grantId });

    const appUserId = await this.resolveAppUserId(actor);
    if (grant.project.piUserId !== appUserId) {
      throw new PiNotOwnerOfProjectException(appUserId, grantId);
    }
  }

  // ------------------------------------------------------------------
  // /grants/:id/transactions
  // ------------------------------------------------------------------

  async transactions(grantId: string, query: TransactionsQuery): Promise<TransactionsResponseDto> {
    await this.ensureGrantExists(grantId);

    const conditions: string[] = ['l.grant_id = $1::uuid'];
    const params: unknown[] = [grantId];

    if (query.fromDate) {
      params.push(query.fromDate);
      conditions.push(`e.entry_date >= $${params.length}::date`);
    }
    if (query.toDate) {
      params.push(query.toDate);
      conditions.push(`e.entry_date <= $${params.length}::date`);
    }
    if (query.accountCode) {
      params.push(`${query.accountCode}%`);
      conditions.push(`l.account_code LIKE $${params.length}`);
    }

    // Filtre par "type" : on mappe sur la famille SOURCE_FAMILY ci-dessus.
    const sourceTypesForFamily = (fam: string): string[] =>
      Object.entries(SOURCE_FAMILY)
        .filter(([, v]) => v === fam)
        .map(([k]) => k);

    if (query.type && query.type !== 'all') {
      const sourceTypes = sourceTypesForFamily(query.type);
      if (sourceTypes.length === 0) {
        return { data: [], total: 0, totalDebit: 0, totalCredit: 0 };
      }
      params.push(sourceTypes);
      conditions.push(`e.source_type = ANY($${params.length}::text[])`);
    }

    const rows = await this.prisma.$queryRawUnsafe<RawTransaction[]>(
      `
      SELECT e.id          AS entry_id,
             e.entry_number,
             e.entry_date,
             e.journal::text AS journal,
             e.label,
             e.source_type,
             e.source_id,
             l.account_code,
             l.debit,
             l.credit,
             l.currency,
             e.status::text AS status
      FROM gl.journal_line l
      JOIN gl.journal_entry e ON e.id = l.entry_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY e.entry_date DESC, e.entry_number DESC, l.id ASC
      LIMIT 500
      `,
      ...params,
    );

    // Agrégats en Prisma.Decimal pour préserver la précision comptable (F10).
    // r.debit / r.credit sont des Prisma.Decimal — on calcule net et totaux en
    // Decimal, puis .toNumber() uniquement au remplissage des champs DTO.
    let totalDebitDec = new Prisma.Decimal(0);
    let totalCreditDec = new Prisma.Decimal(0);

    const data: TransactionDto[] = rows.map((r) => {
      const debit = r.debit;
      const credit = r.credit;
      totalDebitDec = totalDebitDec.plus(debit);
      totalCreditDec = totalCreditDec.plus(credit);
      return {
        entryId: r.entry_id,
        entryNumber: r.entry_number,
        entryDate: new Date(r.entry_date).toISOString().slice(0, 10),
        journal: r.journal,
        label: r.label,
        sourceType: r.source_type,
        sourceId: r.source_id,
        accountCode: r.account_code,
        debit: debit.toNumber(),
        credit: credit.toNumber(),
        net: this.round2(debit.minus(credit).toNumber()),
        currency: r.currency,
        status: r.status,
      };
    });

    const totalDebit = this.round2(totalDebitDec.toNumber());
    const totalCredit = this.round2(totalCreditDec.toNumber());

    return { data, total: data.length, totalDebit, totalCredit };
  }

  // ------------------------------------------------------------------
  // /grants/:id/analytical-breakdown?by=...
  // ------------------------------------------------------------------

  async analyticalBreakdown(
    grantId: string,
    by: BreakdownDimension,
    fromDate?: string,
    toDate?: string,
  ): Promise<BreakdownResponseDto> {
    await this.ensureGrantExists(grantId);

    const dateConditions: string[] = [];
    const params: unknown[] = [grantId];
    if (fromDate) {
      params.push(fromDate);
      dateConditions.push(`e.entry_date >= $${params.length}::date`);
    }
    if (toDate) {
      params.push(toDate);
      dateConditions.push(`e.entry_date <= $${params.length}::date`);
    }
    const dateClause = dateConditions.length > 0 ? `AND ${dateConditions.join(' AND ')}` : '';

    // Toutes les breakdowns ne considèrent que les charges (classe 6) — base
    // de l'analyse analytique de consommation des fonds. Les ressources
    // (classe 7) sont traitées séparément via overhead-calculation.
    const accountFilter = `AND l.account_code LIKE '6%'`;

    let rows: RawBreakdownRow[] = [];

    if (by === 'account') {
      rows = await this.prisma.$queryRawUnsafe<RawBreakdownRow[]>(
        `
        SELECT l.account_code AS key,
               COALESCE(a.label, l.account_code) AS label,
               SUM(l.debit - l.credit)::float AS amount
        FROM gl.journal_line l
        JOIN gl.journal_entry e ON e.id = l.entry_id
        LEFT JOIN ref.gl_account a ON a.code = l.account_code
        WHERE l.grant_id = $1::uuid AND e.status = 'posted' ${accountFilter} ${dateClause}
        GROUP BY l.account_code, a.label
        ORDER BY amount DESC
        `,
        ...params,
      );
    } else if (by === 'cost_center') {
      rows = await this.prisma.$queryRawUnsafe<RawBreakdownRow[]>(
        `
        SELECT COALESCE(cc.code, 'NON_AFFECTE') AS key,
               COALESCE(cc.label, 'Non affecté') AS label,
               SUM(l.debit - l.credit)::float AS amount
        FROM gl.journal_line l
        JOIN gl.journal_entry e ON e.id = l.entry_id
        LEFT JOIN ref.analytical_axis cc ON cc.id = l.cost_center_id
        WHERE l.grant_id = $1::uuid AND e.status = 'posted' ${accountFilter} ${dateClause}
        GROUP BY cc.code, cc.label
        ORDER BY amount DESC
        `,
        ...params,
      );
    } else if (by === 'activity') {
      rows = await this.prisma.$queryRawUnsafe<RawBreakdownRow[]>(
        `
        SELECT COALESCE(act.code, 'NON_AFFECTE') AS key,
               COALESCE(act.label, 'Non affecté') AS label,
               SUM(l.debit - l.credit)::float AS amount
        FROM gl.journal_line l
        JOIN gl.journal_entry e ON e.id = l.entry_id
        LEFT JOIN ref.analytical_axis act ON act.id = l.activity_id
        WHERE l.grant_id = $1::uuid AND e.status = 'posted' ${accountFilter} ${dateClause}
        GROUP BY act.code, act.label
        ORDER BY amount DESC
        `,
        ...params,
      );
    } else {
      // by = period — buckets mensuels
      rows = await this.prisma.$queryRawUnsafe<RawBreakdownRow[]>(
        `
        SELECT TO_CHAR(DATE_TRUNC('month', e.entry_date), 'YYYY-MM') AS key,
               TO_CHAR(DATE_TRUNC('month', e.entry_date), 'YYYY-MM') AS label,
               SUM(l.debit - l.credit)::float AS amount
        FROM gl.journal_line l
        JOIN gl.journal_entry e ON e.id = l.entry_id
        WHERE l.grant_id = $1::uuid AND e.status = 'posted' ${accountFilter} ${dateClause}
        GROUP BY DATE_TRUNC('month', e.entry_date)
        ORDER BY DATE_TRUNC('month', e.entry_date) ASC
        `,
        ...params,
      );
    }

    const total = this.round2(rows.reduce((s, r) => s + Number(r.amount), 0));

    const entries: BreakdownEntryDto[] = rows.map((r) => ({
      key: String(r.key),
      label: String(r.label ?? r.key),
      amount: this.round2(Number(r.amount)),
      share: total > 0 ? Number(r.amount) / total : 0,
    }));

    return { by, total, entries };
  }

  // ------------------------------------------------------------------
  // /grants/:id/dedicated-funds
  // ------------------------------------------------------------------

  async dedicatedFunds(grantId: string): Promise<DedicatedFundsResponseDto> {
    const grant = await this.ensureGrantExists(grantId);

    const movements = await this.prisma.dedicatedFundMovement.findMany({
      where: { grantId },
      orderBy: { computedAt: 'desc' },
      include: { period: { select: { code: true } } },
    });

    // Solde compte 19 net imputé au grant (toutes périodes confondues, posted)
    const balanceRows = await this.prisma.$queryRaw<Array<{ balance: number }>>`
      SELECT COALESCE(SUM(l.credit - l.debit), 0)::float AS balance
      FROM gl.journal_line l
      JOIN gl.journal_entry e ON e.id = l.entry_id
      WHERE e.status = 'posted'
        AND l.grant_id = ${grantId}::uuid
        AND l.account_code = '19'
    `;
    const balance = this.round2(Number(balanceRows[0]?.balance ?? 0));

    const data = movements.map((m) => ({
      id: m.id,
      movementType: m.movementType,
      amount: Number(m.amount),
      currency: m.currency,
      rationale: m.rationale,
      computedAt: m.computedAt.toISOString(),
      journalEntryId: m.journalEntryId,
      periodCode: m.period?.code ?? null,
    }));

    return {
      grantId: grant.id,
      grantReference: grant.reference,
      balance,
      currency: 'XOF',
      movements: data,
      lastMovement: data[0] ?? null,
    };
  }

  // ------------------------------------------------------------------
  // /grants/:id/overhead-calculation
  // ------------------------------------------------------------------

  async overheadCalculation(grantId: string): Promise<OverheadResponseDto> {
    const grant = await this.ensureGrantExists(grantId);

    const calcs = await this.prisma.overheadCalculation.findMany({
      where: { grantId },
      orderBy: { computedAt: 'desc' },
      include: { period: { select: { code: true } } },
    });

    // Somme en Prisma.Decimal pour préserver la précision (F10) ; .toNumber()
    // uniquement à la sortie (champ DTO totalBillable: number).
    const totalBillableDec = calcs.reduce(
      (s, c) => s.plus(c.overheadAmount ?? 0),
      new Prisma.Decimal(0),
    );
    const totalBillable = this.round2(totalBillableDec.toNumber());

    // Reversé : crédits compte 754x liés au grant
    const reversedRows = await this.prisma.$queryRaw<Array<{ reversed: number }>>`
      SELECT COALESCE(SUM(l.credit - l.debit), 0)::float AS reversed
      FROM gl.journal_line l
      JOIN gl.journal_entry e ON e.id = l.entry_id
      WHERE e.status = 'posted'
        AND l.grant_id = ${grantId}::uuid
        AND l.account_code LIKE ${`${OVERHEAD_REVERSAL_PREFIX}%`}
    `;
    const totalReversed = this.round2(Number(reversedRows[0]?.reversed ?? 0));

    const variance = this.round2(totalBillable - totalReversed);
    const variancePercent = totalBillable > 0 ? variance / totalBillable : 0;

    const entries = calcs.map((c) => ({
      id: c.id,
      periodCode: c.period.code,
      eligibleBase: Number(c.eligibleBase),
      overheadRate: Number(c.overheadRate),
      overheadAmount: Number(c.overheadAmount),
      journalEntryId: c.journalEntryId,
      computedAt: c.computedAt.toISOString(),
    }));

    return {
      grantId: grant.id,
      grantReference: grant.reference,
      grantOverheadRate: Number(grant.overheadRate),
      totalBillable,
      totalReversed,
      variance,
      variancePercent,
      entries,
    };
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  private async ensureGrantExists(grantId: string) {
    const grant = await this.prisma.grantAgreement.findUnique({ where: { id: grantId } });
    if (!grant) throw new EntityNotFoundException(GRANT_ENTITY, { id: grantId });
    return grant;
  }

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

  private round2(v: number): number {
    return Math.round(v * 100) / 100;
  }

  /** Pour tests / debug — expose la map des familles. */
  static readonly EXPENSE_PREFIXES = EXPENSE_PREFIXES;
  static readonly REVENUE_PREFIXES = REVENUE_PREFIXES;
  static readonly OVERHEAD_REVERSAL_PREFIX = OVERHEAD_REVERSAL_PREFIX;
  static readonly SOURCE_FAMILY = SOURCE_FAMILY;
}

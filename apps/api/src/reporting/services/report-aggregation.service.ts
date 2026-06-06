import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  DonorTemplateHasNoMappingsException,
  ReportingFxRateMissingException,
} from '../../common/exceptions/business.exception';

/**
 * Seuil de variance (en %) au-delà duquel une ligne est flaggée comme
 * "alerte budget" dans le rapport. Ne bloque pas la génération — c'est
 * une indication visuelle pour le contrôleur de gestion / DAF.
 */
export const VARIANCE_ALERT_THRESHOLD_PCT = 10;

export interface AggregationInput {
  grantId: string;
  templateId: string;
  periodStart: Date;
  periodEnd: Date;
  targetCurrency: string;
}

export interface AggregatedCategoryLine {
  donorCategoryId: string;
  categoryCode: string;
  categoryLabel: string;
  budgetAmount: number;
  spentAmount: number;
  variance: number;
  variancePct: number;
  alert: boolean;
}

export interface AggregationResult {
  lines: AggregatedCategoryLine[];
  totalBudget: number;
  totalSpent: number;
  totalOverhead: number;
  fundsCarried: number;
  fxRateUsed: number;
}

/**
 * Service d'agrégation des écritures comptables pour un rapport bailleur.
 *
 * Workflow :
 *   1. Charge le template + ses categories + mappings (sinon erreur si pas
 *      de mappings).
 *   2. Pour chaque journal_line de la période sur les comptes mappés
 *      (`gl_account_code ∈ template.mappings.glAccountCode`, grant_id
 *      = report.grantId, entry.status='posted'), calcule
 *      sum = (debit - credit) * mapping.sign. Convertit en target currency
 *      via `ref.exchange_rate` au dernier jour de la période.
 *   3. Agrège l'overhead consommé via `co.overhead_calculation` pour la
 *      grant + période.
 *   4. Calcule "Funds carried over" = (grant.amount - totalSpent) si > 0.
 *   5. Variance par catégorie : (spent - budget) / budget * 100. Alerte
 *      si |variance| > 10%.
 *
 * Notes :
 *  - Les `journal_line` du sprint 4.2b stockent debit/credit DÉJÀ EN
 *    XOF (livres tenus en XOF). On convertit XOF → target currency à
 *    la fin (1 seule fois). Si target = XOF, fxRateUsed = 1.
 *  - L'imputation par grant existe sur les lignes 6xx (charges) et 401
 *    (fournisseurs) — on filtre sur grant_id IS NOT NULL pour éviter
 *    les lignes TVA/banque non imputées.
 */
@Injectable()
export class ReportAggregationService {
  private readonly logger = new Logger(ReportAggregationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async aggregate(input: AggregationInput): Promise<AggregationResult> {
    const template = await this.prisma.donorReportTemplate.findUnique({
      where: { id: input.templateId },
      include: {
        categories: { orderBy: { sortOrder: 'asc' } },
        mappings: true,
      },
    });
    if (!template) {
      throw new DonorTemplateHasNoMappingsException(input.templateId);
    }
    if (template.mappings.length === 0) {
      throw new DonorTemplateHasNoMappingsException(input.templateId);
    }

    // Taux de change XOF → target currency à la fin de période
    const fxRateUsed = await this.lookupFxRate(
      'XOF',
      input.targetCurrency,
      input.periodEnd,
    );

    // Agrégation par compte
    const accountCodes = template.mappings.map((m) => m.glAccountCode);
    const sumsByAccount = await this.sumByAccount(
      input.grantId,
      accountCodes,
      input.periodStart,
      input.periodEnd,
    );

    // Mapping account → category
    const categoryByAccount = new Map<string, { categoryId: string; sign: number }>();
    for (const m of template.mappings) {
      categoryByAccount.set(m.glAccountCode, {
        categoryId: m.donorCategoryId,
        sign: m.sign,
      });
    }

    // Accumulateur par categoryId (en Decimal pour préserver la précision —
    // produit montant XOF × taux FX × sens, cf. ADR-005 / audit F10)
    const spentByCategory = new Map<string, Prisma.Decimal>();
    for (const [accountCode, signedAmountXof] of sumsByAccount) {
      const mapping = categoryByAccount.get(accountCode);
      if (!mapping) continue; // compte non mappé — ignoré
      const inTarget = signedAmountXof.times(fxRateUsed).times(mapping.sign);
      const acc = spentByCategory.get(mapping.categoryId) ?? new Prisma.Decimal(0);
      spentByCategory.set(mapping.categoryId, acc.plus(inTarget));
    }

    // Budget par categorie : on cherche les budget_lines associées à la
    // grant qui ont un default_account mappé sur cette catégorie. Sinon
    // budget = 0 (cas typique pour les catégories INDIRECT). Le total
    // budget est la somme des budgeted_amount (déjà en devise grant —
    // on convertit aussi).
    const budgetByCategory = await this.budgetByCategory(
      input.grantId,
      input.templateId,
      input.targetCurrency,
      input.periodEnd,
    );

    // Construit les lignes finales en respectant l'ordre des categories.
    // Agrégats internes en Decimal ; conversion .toNumber() seulement au
    // remplissage des champs DTO (number) — cf. audit F10.
    const spentDecByCategory = new Map<string, Prisma.Decimal>();
    const budgetDecByCategory = new Map<string, Prisma.Decimal>();
    const lines: AggregatedCategoryLine[] = template.categories.map((c) => {
      const spentDec = this.roundDec2(spentByCategory.get(c.id) ?? new Prisma.Decimal(0));
      const budgetDec = this.roundDec2(budgetByCategory.get(c.id) ?? new Prisma.Decimal(0));
      const varianceDec = this.roundDec2(spentDec.minus(budgetDec));
      const variancePctDec = budgetDec.greaterThan(0)
        ? this.roundDec4(varianceDec.div(budgetDec).times(100))
        : new Prisma.Decimal(0);
      spentDecByCategory.set(c.id, spentDec);
      budgetDecByCategory.set(c.id, budgetDec);
      return {
        donorCategoryId: c.id,
        categoryCode: c.code,
        categoryLabel: c.label,
        budgetAmount: budgetDec.toNumber(),
        spentAmount: spentDec.toNumber(),
        variance: varianceDec.toNumber(),
        variancePct: variancePctDec.toNumber(),
        alert: variancePctDec.abs().greaterThan(VARIANCE_ALERT_THRESHOLD_PCT),
      };
    });

    // Overhead consommé sur la période (via co.overhead_calculation)
    const totalOverhead = await this.sumOverhead(
      input.grantId,
      input.periodStart,
      input.periodEnd,
      fxRateUsed,
    );

    const totalSpentDec = this.roundDec2(
      lines
        .reduce((s, l) => s.plus(spentDecByCategory.get(l.donorCategoryId) ?? new Prisma.Decimal(0)), new Prisma.Decimal(0))
        .plus(totalOverhead),
    );
    const totalSpent = totalSpentDec.toNumber();
    const totalBudget = this.roundDec2(
      lines.reduce((s, l) => s.plus(budgetDecByCategory.get(l.donorCategoryId) ?? new Prisma.Decimal(0)), new Prisma.Decimal(0)),
    ).toNumber();

    // Funds carried over : grant.amount converti en target currency − totalSpent
    const grant = await this.prisma.grantAgreement.findUnique({
      where: { id: input.grantId },
      select: { amount: true, currency: true },
    });
    let fundsCarried = 0;
    if (grant) {
      const grantAmountXof = await this.toXof(grant.amount, grant.currency, input.periodEnd);
      const grantInTarget = this.roundDec2(grantAmountXof.times(fxRateUsed));
      const carriedDec = this.roundDec2(grantInTarget.minus(totalSpentDec));
      fundsCarried = carriedDec.greaterThan(0) ? carriedDec.toNumber() : 0;
    }

    const fxRateUsedNum = fxRateUsed.toNumber();
    this.logger.log(
      {
        templateCode: template.code,
        grantId: input.grantId,
        lines: lines.length,
        totalSpent,
        totalOverhead,
        fundsCarried,
        fxRateUsed: fxRateUsedNum,
      },
      'donor report aggregated',
    );

    return {
      lines,
      totalBudget,
      totalSpent,
      totalOverhead,
      fundsCarried,
      fxRateUsed: fxRateUsedNum,
    };
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  /**
   * Somme signée (debit - credit) par compte sur la période, restreinte
   * au grant + entries posted. Renvoie une Map<accountCode, amountInXof>.
   */
  private async sumByAccount(
    grantId: string,
    accountCodes: string[],
    periodStart: Date,
    periodEnd: Date,
  ): Promise<Map<string, Prisma.Decimal>> {
    const rows = await this.prisma.journalLine.groupBy({
      by: ['accountCode'],
      where: {
        grantId,
        accountCode: { in: accountCodes },
        entry: {
          status: 'posted',
          entryDate: { gte: periodStart, lte: periodEnd },
        },
      },
      _sum: { debit: true, credit: true },
    });
    const out = new Map<string, Prisma.Decimal>();
    for (const r of rows) {
      const d = r._sum.debit ?? new Prisma.Decimal(0);
      const c = r._sum.credit ?? new Prisma.Decimal(0);
      out.set(r.accountCode, d.minus(c));
    }
    return out;
  }

  /**
   * Pour chaque budget_line de la grant, distribue son budgeted_amount
   * sur la categorie cible si default_account est mappé. Si non mappé,
   * la budget_line n'apparaît dans aucune categorie (le total budget
   * ne couvre que les categories mappées).
   *
   * Convention : budget_line.budgeted_amount est stocké en devise du
   * grant. Conversion grant.currency → XOF puis XOF → target currency.
   */
  private async budgetByCategory(
    grantId: string,
    templateId: string,
    targetCurrency: string,
    periodEnd: Date,
  ): Promise<Map<string, Prisma.Decimal>> {
    const grant = await this.prisma.grantAgreement.findUnique({
      where: { id: grantId },
      select: { currency: true },
    });
    if (!grant) return new Map();

    const grantToXof = await this.toXof(new Prisma.Decimal(1), grant.currency, periodEnd);
    const xofToTarget = await this.lookupFxRate('XOF', targetCurrency, periodEnd);
    const factor = grantToXof.times(xofToTarget);

    const budgetLines = await this.prisma.budgetLine.findMany({
      where: { grantId },
      select: { id: true, budgetedAmount: true, defaultAccount: true },
    });

    const mappings = await this.prisma.accountMapping.findMany({
      where: { templateId },
      select: { glAccountCode: true, donorCategoryId: true },
    });
    const categoryByAccount = new Map<string, string>();
    for (const m of mappings) categoryByAccount.set(m.glAccountCode, m.donorCategoryId);

    const out = new Map<string, Prisma.Decimal>();
    for (const bl of budgetLines) {
      if (!bl.defaultAccount) continue;
      const categoryId = categoryByAccount.get(bl.defaultAccount);
      if (!categoryId) continue;
      const amt = bl.budgetedAmount.times(factor);
      out.set(categoryId, (out.get(categoryId) ?? new Prisma.Decimal(0)).plus(amt));
    }
    return out;
  }

  /**
   * Somme des overhead_amount calculés pour la grant pendant la période,
   * convertie en target currency.
   */
  private async sumOverhead(
    grantId: string,
    periodStart: Date,
    periodEnd: Date,
    xofToTarget: Prisma.Decimal,
  ): Promise<number> {
    const rows = await this.prisma.overheadCalculation.findMany({
      where: {
        grantId,
        computedAt: { gte: periodStart, lte: periodEnd },
      },
      select: { overheadAmount: true },
    });
    const totalXof = rows.reduce(
      (s, r) => s.plus(r.overheadAmount ?? new Prisma.Decimal(0)),
      new Prisma.Decimal(0),
    );
    return this.round2(totalXof.times(xofToTarget).toNumber());
  }

  /**
   * Convertit 1 unité de `from` en XOF (devise des livres) à la date
   * la plus récente ≤ targetDate. Si from=XOF, renvoie 1.
   */
  private async toXof(
    amount: Prisma.Decimal,
    from: string,
    targetDate: Date,
  ): Promise<Prisma.Decimal> {
    if (from === 'XOF') return amount;
    const rate = await this.lookupFxRate(from, 'XOF', targetDate);
    return amount.times(rate);
  }

  /**
   * Lookup d'un taux dans `ref.exchange_rate`. Lève
   * REPORTING_FX_RATE_MISSING sinon. Le taux retourné s'applique en
   * multiplication (amount_from * rate = amount_to).
   */
  private async lookupFxRate(
    from: string,
    to: string,
    targetDate: Date,
  ): Promise<Prisma.Decimal> {
    if (from === to) return new Prisma.Decimal(1);
    const direct = await this.prisma.exchangeRate.findFirst({
      where: { fromCurrency: from, toCurrency: to, rateDate: { lte: targetDate } },
      orderBy: { rateDate: 'desc' },
    });
    if (direct) return direct.rate;
    // Tente l'inverse : si rate(B→A) existe, on peut faire 1/rate
    const inverse = await this.prisma.exchangeRate.findFirst({
      where: { fromCurrency: to, toCurrency: from, rateDate: { lte: targetDate } },
      orderBy: { rateDate: 'desc' },
    });
    if (inverse) return new Prisma.Decimal(1).div(inverse.rate);
    throw new ReportingFxRateMissingException(
      from,
      to,
      targetDate.toISOString().slice(0, 10),
    );
  }

  private round2(v: number): number {
    return Math.round(v * 100) / 100;
  }

  /** Arrondi Decimal à 2 décimales (préserve la précision, cf. audit F10). */
  private roundDec2(v: Prisma.Decimal): Prisma.Decimal {
    return v.toDecimalPlaces(2);
  }
  /** Arrondi Decimal à 4 décimales (pourcentages de variance). */
  private roundDec4(v: Prisma.Decimal): Prisma.Decimal {
    return v.toDecimalPlaces(4);
  }
}

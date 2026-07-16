import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ExchangeRateService } from '../../referential/exchange-rate/exchange-rate.service';
import type { EligibilityContext } from './eligibility-context';

/** Entrée minimale décrivant la DA à valider. */
export interface EligibilityPrInput {
  id?: string;
  grantId: string;
  budgetLineId: string;
  totalAmount: Prisma.Decimal;
  currency: string;
  expenseNatureCode: string;
  requestedById: string;
  requestedAt?: Date;
  /**
   * CLOSE-S6 — champs matérialisés US-054, transportés par runEligibilityGate
   * et propagés tels quels dans ctx.pr (spread) : active PPT-5
   * (NotPasteurParisReimbursedRule) et PPT-6 (NoCrossProjectDuplicateRule).
   */
  pasteurParisReimbursed?: boolean;
  supplierInvoiceNumber?: string | null;
}

/**
 * Construit un EligibilityContext complet (ADR-007) en chargeant depuis la BD
 * la convention, la Note Technique active, les règles d'éligibilité, la ligne
 * budgétaire et la nature de dépense, et en convertissant le montant en XOF
 * (ADR-005). Utilisé par PurchaseRequestService au moment du submit.
 */
@Injectable()
export class EligibilityContextBuilder {
  private readonly logger = new Logger(EligibilityContextBuilder.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fx: ExchangeRateService,
  ) {}

  async build(
    pr: EligibilityPrInput,
    actor: { id: string; roles: string[] },
  ): Promise<EligibilityContext> {
    const grant = await this.prisma.grantAgreement.findUnique({
      where: { id: pr.grantId },
      select: { id: true, currency: true, startDate: true, endDate: true },
    });
    if (!grant) throw new NotFoundException(`Grant ${pr.grantId} not found`);

    const activeNoteTechnique = await this.prisma.noteTechnique.findFirst({
      where: { grantId: pr.grantId, status: 'active', deletedAt: null },
      select: { id: true, overheadRuleId: true, singleActorAuthorized: true },
    });

    const eligibilityRules = await this.prisma.eligibilityRule.findMany({
      where: { grantId: pr.grantId },
      select: { expenseNatureId: true, maxPerRequestXof: true, maxPerYearXof: true, excluded: true },
    });

    const budgetLine = await this.prisma.budgetLine.findUnique({
      where: { id: pr.budgetLineId },
      select: { id: true, budgetedAmountXof: true, currency: true, category: true },
    });
    if (!budgetLine) throw new NotFoundException(`BudgetLine ${pr.budgetLineId} not found`);

    const expenseNature = await this.prisma.expenseNature.findUnique({
      where: { code: pr.expenseNatureCode },
      select: { id: true, code: true, category: true },
    });
    if (!expenseNature) {
      throw new NotFoundException(`ExpenseNature ${pr.expenseNatureCode} not found`);
    }

    const conv = await this.fx.convertToXof(pr.totalAmount, pr.currency, pr.requestedAt ?? new Date());

    // US-056 — lecture DIRECTE de ref.budget_line.category (livrée US-055) :
    // active réellement PPT-4 (LineNatureCoherentRule peut désormais détecter
    // une nature imputée sur une ligne de catégorie incompatible).
    // Fallback DOCUMENTÉ : lignes historiques créées avant US-055 → category
    // NULL → on retombe sur l'ancien proxy US-049 (catégorie de la nature,
    // toujours cohérent donc jamais bloquant) avec un WARN structuré, jusqu'au
    // backfill du référentiel.
    let lineCategory = budgetLine.category;
    if (lineCategory === null || lineCategory === undefined) {
      lineCategory = expenseNature.category;
      this.logger.warn(
        {
          event: 'us049_proxy_fallback_used',
          budgetLineId: budgetLine.id,
          expenseNatureCode: expenseNature.code,
          proxyCategory: expenseNature.category,
        },
        'US-049 proxy fallback used, backfill needed (budget_line.category IS NULL)',
      );
    }

    return {
      pr: { ...pr, totalAmountXof: conv.xofAmount },
      actor,
      grant,
      activeNoteTechnique,
      eligibilityRules,
      budgetLine: {
        id: budgetLine.id,
        budgetedAmountXof: budgetLine.budgetedAmountXof,
        currency: budgetLine.currency,
        category: lineCategory,
      },
      expenseNature,
      now: new Date(),
    };
  }
}

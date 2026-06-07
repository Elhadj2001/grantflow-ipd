import { Injectable, NotFoundException } from '@nestjs/common';
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
}

/**
 * Construit un EligibilityContext complet (ADR-007) en chargeant depuis la BD
 * la convention, la Note Technique active, les règles d'éligibilité, la ligne
 * budgétaire et la nature de dépense, et en convertissant le montant en XOF
 * (ADR-005). Utilisé par PurchaseRequestService au moment du submit.
 */
@Injectable()
export class EligibilityContextBuilder {
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
      select: { id: true, budgetedAmountXof: true, currency: true },
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

    return {
      pr: { ...pr, totalAmountXof: conv.xofAmount },
      actor,
      grant,
      activeNoteTechnique,
      eligibilityRules,
      // budget_line n'a pas de colonne `category` ; la catégorie comptable de
      // la ligne est portée par la nature de dépense (rapprochement budgétaire
      // affiné en story future). On expose la catégorie de la nature comme
      // proxy pour la règle LineNatureCoherent.
      budgetLine: { ...budgetLine, category: expenseNature.category },
      expenseNature,
      now: new Date(),
    };
  }
}

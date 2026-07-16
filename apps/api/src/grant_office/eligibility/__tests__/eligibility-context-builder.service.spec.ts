import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EligibilityContextBuilder } from '../eligibility-context-builder.service';
import { LineNatureCoherentRule } from '../rules/line-nature-coherent.rule';
import { isBlocking } from '../verdict';
import { ExchangeRateService } from '../../../referential/exchange-rate/exchange-rate.service';
import { createPrismaMock, type PrismaMock } from '../../../test-utils/prisma-mock';

/**
 * US-056 — EligibilityContextBuilder : lecture DIRECTE de
 * ref.budget_line.category (US-055), fallback proxy US-049 (catégorie de la
 * nature) quand la colonne est NULL (données historiques), avec WARN Pino.
 * Le test 3 prouve l'activation réelle de PPT-4 (LineNatureCoherentRule).
 */
describe('EligibilityContextBuilder — budget_line.category (US-056)', () => {
  let prisma: PrismaMock;
  let builder: EligibilityContextBuilder;

  const ACTOR = { id: 'actor-1', roles: ['DEMANDEUR'] };

  function prInput() {
    return {
      id: 'pr-1',
      grantId: 'grant-1',
      budgetLineId: 'bl-1',
      totalAmount: new Prisma.Decimal('100000'),
      currency: 'XOF',
      expenseNatureCode: 'LAB_EQUIPMENT_PCR',
      requestedById: 'user-1',
      requestedAt: new Date('2026-06-15'),
    };
  }

  /** Mocks communs : grant + NT active + règles vides + nature 'functioning'. */
  function configure(budgetLineCategory: string | null, natureCategory = 'functioning'): void {
    prisma.grantAgreement.findUnique.mockResolvedValue({
      id: 'grant-1',
      currency: 'XOF',
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-12-31'),
    } as never);
    prisma.noteTechnique.findFirst.mockResolvedValue({
      id: 'nt-1',
      overheadRuleId: null,
      singleActorAuthorized: false,
    } as never);
    prisma.eligibilityRule.findMany.mockResolvedValue([] as never);
    prisma.budgetLine.findUnique.mockResolvedValue({
      id: 'bl-1',
      budgetedAmountXof: 10_000_000n,
      currency: 'XOF',
      category: budgetLineCategory,
    } as never);
    prisma.expenseNature.findUnique.mockResolvedValue({
      id: 'nat-1',
      code: 'LAB_EQUIPMENT_PCR',
      category: natureCategory,
    } as never);
  }

  beforeEach(() => {
    prisma = createPrismaMock();
    const fx = {
      convertToXof: jest.fn(async (amount: number | { toString(): string }) => ({
        xofAmount: Number(amount),
        fxRate: 1,
        fxRateDate: new Date('2026-06-15'),
        isIndicativeFallback: false,
      })),
    };
    builder = new EligibilityContextBuilder(prisma, fx as unknown as ExchangeRateService);
  });

  it('Test 1 — budget_line.category peuplée → lecture DIRECTE (pas de proxy, pas de warn)', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    configure('equipment', 'functioning');

    const ctx = await builder.build(prInput(), ACTOR);

    expect(ctx.budgetLine.category).toBe('equipment'); // ≠ nature → PAS le proxy
    expect(ctx.expenseNature.category).toBe('functioning');
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('Test 2 — budget_line.category NULL → fallback proxy nature.category + WARN structuré', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    configure(null, 'functioning');

    const ctx = await builder.build(prInput(), ACTOR);

    expect(ctx.budgetLine.category).toBe('functioning'); // proxy US-049
    const payload = warnSpy.mock.calls.find(
      (c) => (c[0] as { event?: string })?.event === 'us049_proxy_fallback_used',
    )?.[0] as { budgetLineId?: string; proxyCategory?: string } | undefined;
    expect(payload).toBeDefined();
    expect(payload?.budgetLineId).toBe('bl-1');
    expect(payload?.proxyCategory).toBe('functioning');
    warnSpy.mockRestore();
  });

  it('Test 3 — catégories incompatibles → LineNatureCoherentRule BLOQUE (PPT-4 activée)', async () => {
    // Ligne 'equipment', nature 'functioning' : le proxy US-049 rendait ce
    // conflit invisible (toujours cohérent) ; en lecture directe, PPT-4 bloque.
    configure('equipment', 'functioning');

    const ctx = await builder.build(prInput(), ACTOR);
    const verdict = await new LineNatureCoherentRule().check(ctx);

    expect(isBlocking(verdict)).toBe(true);
    if (isBlocking(verdict)) {
      expect(verdict.code).toBe('ELIG_LINE_NATURE_INCOHERENT');
    }
  });
});

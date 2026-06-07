import { Prisma } from '@prisma/client';
import { LineNotExceededRule } from '../rules/line-not-exceeded.rule';
import type { EligibilityContext } from '../eligibility-context';

/**
 * Fixture minimale d'EligibilityContext pour la règle LineNotExceeded (US-043).
 *
 * Seuls les champs lus par la règle sont signifiants :
 * - pr.totalAmountXof
 * - expenseNature.id
 * - eligibilityRules
 * Les autres champs sont remplis de valeurs neutres pour satisfaire le type.
 */
function makeContext(overrides: {
  totalAmountXof?: number;
  maxPerRequestXof?: bigint | null;
  withMatchingRule?: boolean;
}): EligibilityContext {
  const expenseNatureId = 'nature-001';
  const withMatchingRule = overrides.withMatchingRule ?? true;

  return {
    pr: {
      grantId: 'grant-001',
      budgetLineId: 'line-001',
      totalAmount: new Prisma.Decimal(0),
      totalAmountXof: overrides.totalAmountXof,
      currency: 'XOF',
      expenseNatureCode: 'FOURN',
      requestedById: 'user-001',
    },
    actor: { id: 'user-001', roles: [] },
    grant: {
      id: 'grant-001',
      currency: 'XOF',
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-12-31'),
    },
    activeNoteTechnique: null,
    eligibilityRules: withMatchingRule
      ? [
          {
            expenseNatureId,
            maxPerRequestXof: overrides.maxPerRequestXof ?? null,
            maxPerYearXof: null,
            excluded: false,
          },
        ]
      : [],
    budgetLine: {
      id: 'line-001',
      budgetedAmountXof: null,
      currency: 'XOF',
      category: 'OPERATING',
    },
    expenseNature: {
      id: expenseNatureId,
      code: 'FOURN',
      category: 'OPERATING',
    },
    now: new Date('2026-06-07'),
  };
}

describe('LineNotExceededRule (US-043)', () => {
  const rule = new LineNotExceededRule();

  it('1. montant sous le plafond → OK', async () => {
    const verdict = await rule.check(
      makeContext({ totalAmountXof: 100_000_000, maxPerRequestXof: 200_000_000n }),
    );
    expect(verdict.kind).toBe('ok');
  });

  it('2. montant au-dessus du plafond → blocked ELIG_LINE_BUDGET_EXCEEDED', async () => {
    const verdict = await rule.check(
      makeContext({ totalAmountXof: 300_000_000, maxPerRequestXof: 200_000_000n }),
    );
    expect(verdict.kind).toBe('blocked');
    if (verdict.kind === 'blocked') {
      expect(verdict.code).toBe('ELIG_LINE_BUDGET_EXCEEDED');
      expect(verdict.details).toMatchObject({
        maxPerRequestXof: 200_000_000,
        totalAmountXof: 300_000_000,
      });
    }
  });

  it('3. montant XOF non calculé → blocked ELIG_XOF_NOT_COMPUTED', async () => {
    const verdict = await rule.check(
      makeContext({ totalAmountXof: undefined, maxPerRequestXof: 200_000_000n }),
    );
    expect(verdict.kind).toBe('blocked');
    if (verdict.kind === 'blocked') {
      expect(verdict.code).toBe('ELIG_XOF_NOT_COMPUTED');
    }
  });

  it('4. pas de plafond unitaire (rule sans maxPerRequestXof) → OK', async () => {
    const verdict = await rule.check(
      makeContext({ totalAmountXof: 999_999, maxPerRequestXof: null }),
    );
    expect(verdict.kind).toBe('ok');
  });
});

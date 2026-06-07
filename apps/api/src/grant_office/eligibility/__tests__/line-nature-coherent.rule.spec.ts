import { Prisma } from '@prisma/client';
import { LineNatureCoherentRule } from '../rules/line-nature-coherent.rule';
import type { EligibilityContext } from '../eligibility-context';
import { isBlocking } from '../verdict';

/**
 * Construit un contexte minimal pour la règle US-044 : seules les catégories
 * de la ligne budgétaire et de la nature de dépense importent ici.
 */
function makeContext(params: {
  lineCategory: string;
  natureCode: string;
  natureCategory: string;
}): EligibilityContext {
  return {
    pr: {
      grantId: 'grant-1',
      budgetLineId: 'line-1',
      totalAmount: new Prisma.Decimal('1000'),
      currency: 'XOF',
      expenseNatureCode: params.natureCode,
      requestedById: 'user-1',
    },
    actor: { id: 'user-1', roles: ['CG'] },
    grant: {
      id: 'grant-1',
      currency: 'XOF',
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-12-31'),
    },
    activeNoteTechnique: null,
    eligibilityRules: [],
    budgetLine: {
      id: 'line-1',
      budgetedAmountXof: null,
      currency: 'XOF',
      category: params.lineCategory,
    },
    expenseNature: {
      id: 'nature-1',
      code: params.natureCode,
      category: params.natureCategory,
    },
    now: new Date('2026-06-07'),
  };
}

describe('LineNatureCoherentRule (US-044)', () => {
  const rule = new LineNatureCoherentRule();

  it('1. nature functioning sur ligne functioning → OK', async () => {
    const verdict = await rule.check(
      makeContext({
        lineCategory: 'functioning',
        natureCode: 'OFFICE_SUPPLIES',
        natureCategory: 'functioning',
      }),
    );
    expect(verdict.kind).toBe('ok');
  });

  it('2. nature equipment sur ligne functioning → blocked', async () => {
    const verdict = await rule.check(
      makeContext({
        lineCategory: 'functioning',
        natureCode: 'LAB_EQUIPMENT_PCR',
        natureCategory: 'equipment',
      }),
    );
    expect(isBlocking(verdict)).toBe(true);
    if (isBlocking(verdict)) {
      expect(verdict.code).toBe('ELIG_LINE_NATURE_INCOHERENT');
    }
  });

  it('3. nature overhead sur ligne functioning → OK (tolérance overhead)', async () => {
    const verdict = await rule.check(
      makeContext({
        lineCategory: 'functioning',
        natureCode: 'OVERHEAD_INDIRECT',
        natureCategory: 'overhead',
      }),
    );
    expect(verdict.kind).toBe('ok');
  });

  it('4. nature personnel sur ligne functioning → blocked', async () => {
    const verdict = await rule.check(
      makeContext({
        lineCategory: 'functioning',
        natureCode: 'PERSONNEL_NATIONAL',
        natureCategory: 'personnel',
      }),
    );
    expect(isBlocking(verdict)).toBe(true);
    if (isBlocking(verdict)) {
      expect(verdict.code).toBe('ELIG_LINE_NATURE_INCOHERENT');
    }
  });
});

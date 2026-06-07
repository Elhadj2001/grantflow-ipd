import { Prisma } from '@prisma/client';
import { NotPasteurParisReimbursedRule } from '../rules/not-pasteur-paris-reimbursed.rule';
import type { EligibilityContext } from '../eligibility-context';

/**
 * Fabrique un contexte minimal. `prOverride` permet d'injecter le drapeau
 * optionnel `pasteurParisReimbursed` (absent du type `EligibilityContext.pr`
 * tant que le DDL S6 n'est pas livré) via un cast `as unknown as`.
 */
function makeContext(prOverride: Record<string, unknown> = {}): EligibilityContext {
  const now = new Date('2026-06-07T00:00:00.000Z');
  return {
    pr: {
      grantId: 'grant-1',
      budgetLineId: 'bl-1',
      totalAmount: new Prisma.Decimal('100000'),
      currency: 'XOF',
      expenseNatureCode: 'NAT-001',
      requestedById: 'user-1',
      ...prOverride,
    },
    actor: { id: 'user-1', roles: ['PI'] },
    grant: {
      id: 'grant-1',
      currency: 'XOF',
      startDate: new Date('2026-01-01T00:00:00.000Z'),
      endDate: new Date('2026-12-31T00:00:00.000Z'),
    },
    activeNoteTechnique: {
      id: 'nt-1',
      overheadRuleId: null,
      singleActorAuthorized: false,
    },
    eligibilityRules: [],
    budgetLine: {
      id: 'bl-1',
      budgetedAmountXof: 1_000_000n,
      currency: 'XOF',
      category: 'EQUIPMENT',
    },
    expenseNature: { id: 'en-1', code: 'NAT-001', category: 'EQUIPMENT' },
    now,
  } as unknown as EligibilityContext;
}

describe('NotPasteurParisReimbursedRule (US-045)', () => {
  let rule: NotPasteurParisReimbursedRule;

  beforeEach(() => {
    rule = new NotPasteurParisReimbursedRule();
  });

  it('no-op : pr sans le drapeau pasteurParisReimbursed → OK', async () => {
    const verdict = await rule.check(makeContext());
    expect(verdict).toEqual({ kind: 'ok' });
  });

  it('pr avec pasteurParisReimbursed = true → blocked, code ELIG_PASTEUR_PARIS_REIMBURSED', async () => {
    const verdict = await rule.check(makeContext({ pasteurParisReimbursed: true }));
    expect(verdict.kind).toBe('blocked');
    if (verdict.kind === 'blocked') {
      expect(verdict.code).toBe('ELIG_PASTEUR_PARIS_REIMBURSED');
      expect(verdict.message).toBe('Dépense déjà refacturée à Pasteur Paris — non éligible.');
    }
  });

  it('pr avec pasteurParisReimbursed = false → OK', async () => {
    const verdict = await rule.check(makeContext({ pasteurParisReimbursed: false }));
    expect(verdict).toEqual({ kind: 'ok' });
  });
});

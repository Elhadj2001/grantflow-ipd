import { NatureAllowedRule } from '../rules/nature-allowed.rule';
import type { EligibilityContext } from '../eligibility-context';

/**
 * Fixture minimale : ne renseigne que les champs lus par NatureAllowedRule
 * (activeNoteTechnique, eligibilityRules, expenseNature). Cast assumé pour
 * éviter de fabriquer un EligibilityContext complet inutile au test.
 */
function makeCtx(overrides: {
  activeNoteTechnique?: EligibilityContext['activeNoteTechnique'];
  eligibilityRules?: EligibilityContext['eligibilityRules'];
  expenseNature?: EligibilityContext['expenseNature'];
}): EligibilityContext {
  return {
    // 'in' check : distinguer « non fourni » (défaut) de « explicitement null »
    // (?? écraserait null par le défaut, masquant le cas de test).
    activeNoteTechnique: 'activeNoteTechnique' in overrides
      ? overrides.activeNoteTechnique
      : {
          id: 'nt-1',
          overheadRuleId: null,
          singleActorAuthorized: false,
        },
    eligibilityRules: overrides.eligibilityRules ?? [],
    expenseNature:
      overrides.expenseNature ?? {
        id: 'nat-1',
        code: 'FUEL',
        category: 'OPERATING',
      },
  } as unknown as EligibilityContext;
}

describe('NatureAllowedRule (US-041)', () => {
  const rule = new NatureAllowedRule();

  it('expose le bon code et la sévérité blocking', () => {
    expect(rule.code).toBe('ELIG_NATURE_NOT_ALLOWED');
    expect(rule.severity).toBe('blocking');
  });

  it('nature avec une règle correspondante non exclue → OK', async () => {
    const ctx = makeCtx({
      expenseNature: { id: 'nat-1', code: 'FUEL', category: 'OPERATING' },
      eligibilityRules: [
        { expenseNatureId: 'nat-1', maxPerRequestXof: null, maxPerYearXof: null, excluded: false },
      ],
    });
    const v = await rule.check(ctx);
    expect(v.kind).toBe('ok');
  });

  it('nature avec une règle excluded=true → blocked ELIG_NATURE_NOT_ALLOWED', async () => {
    const ctx = makeCtx({
      expenseNature: { id: 'nat-2', code: 'ALCOHOL', category: 'OTHER' },
      eligibilityRules: [
        { expenseNatureId: 'nat-2', maxPerRequestXof: null, maxPerYearXof: null, excluded: true },
      ],
    });
    const v = await rule.check(ctx);
    expect(v.kind).toBe('blocked');
    if (v.kind === 'blocked') {
      expect(v.code).toBe('ELIG_NATURE_NOT_ALLOWED');
    }
  });

  it('activeNoteTechnique null → blocked ELIG_NO_ACTIVE_NOTE_TECHNIQUE', async () => {
    const ctx = makeCtx({ activeNoteTechnique: null });
    const v = await rule.check(ctx);
    expect(v.kind).toBe('blocked');
    if (v.kind === 'blocked') {
      expect(v.code).toBe('ELIG_NO_ACTIVE_NOTE_TECHNIQUE');
    }
  });

  it('nature sans règle correspondante (mode permissif) → OK', async () => {
    const ctx = makeCtx({
      expenseNature: { id: 'nat-3', code: 'TRAVEL', category: 'OPERATING' },
      eligibilityRules: [
        { expenseNatureId: 'nat-other', maxPerRequestXof: null, maxPerYearXof: null, excluded: true },
      ],
    });
    const v = await rule.check(ctx);
    expect(v.kind).toBe('ok');
  });
});

import { DateWindowRule } from '../rules/date-window.rule';
import type { EligibilityContext } from '../eligibility-context';

/**
 * Fabrique un EligibilityContext minimal pour US-042. Seuls les champs
 * pertinents à DateWindowRule sont renseignés ; le reste est cast.
 * Fenêtre de convention : 2026-01-01 → 2026-12-31 (bornes inclusives).
 */
function makeContext(requestedAt: Date): EligibilityContext {
  return {
    pr: { requestedAt },
    grant: {
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-12-31'),
    },
    now: new Date('2026-06-15'),
  } as unknown as EligibilityContext;
}

describe('DateWindowRule (US-042)', () => {
  const rule = new DateWindowRule();

  it('retourne OK quand la date est dans la fenêtre', async () => {
    const verdict = await rule.check(makeContext(new Date('2026-06-15')));
    expect(verdict.kind).toBe('ok');
  });

  it('bloque quand la date est avant la date de début', async () => {
    const verdict = await rule.check(makeContext(new Date('2025-12-31')));
    expect(verdict.kind).toBe('blocked');
    if (verdict.kind === 'blocked') {
      expect(verdict.code).toBe('ELIG_DATE_OUT_OF_WINDOW');
    }
  });

  it('bloque quand la date est après la date de fin', async () => {
    const verdict = await rule.check(makeContext(new Date('2027-01-01')));
    expect(verdict.kind).toBe('blocked');
    if (verdict.kind === 'blocked') {
      expect(verdict.code).toBe('ELIG_DATE_OUT_OF_WINDOW');
    }
  });

  it('retourne OK sur les bornes exactes (inclusives)', async () => {
    const onStart = await rule.check(makeContext(new Date('2026-01-01')));
    const onEnd = await rule.check(makeContext(new Date('2026-12-31')));
    expect(onStart.kind).toBe('ok');
    expect(onEnd.kind).toBe('ok');
  });
});

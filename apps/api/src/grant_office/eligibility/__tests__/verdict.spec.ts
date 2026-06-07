import { OK, blocked, warning, isBlocking, isWarning } from '../verdict';

describe('Verdict helpers (US-040)', () => {
  it('OK is a positive verdict', () => {
    expect(OK).toEqual({ kind: 'ok' });
  });

  it('blocked() builds a blocked verdict', () => {
    expect(blocked('ELIG_X', 'refusé', { a: 1 })).toEqual({
      kind: 'blocked',
      code: 'ELIG_X',
      message: 'refusé',
      details: { a: 1 },
    });
  });

  it('warning() builds a warning verdict', () => {
    expect(warning('ELIG_SPLIT', 'attention')).toEqual({
      kind: 'warning',
      code: 'ELIG_SPLIT',
      message: 'attention',
      details: undefined,
    });
  });

  it('isBlocking() narrows on blocked, false otherwise', () => {
    expect(isBlocking(blocked('C', 'm'))).toBe(true);
    expect(isBlocking(OK)).toBe(false);
    expect(isBlocking(warning('C', 'm'))).toBe(false);
  });

  it('isWarning() narrows on warning, false otherwise', () => {
    expect(isWarning(warning('C', 'm'))).toBe(true);
    expect(isWarning(OK)).toBe(false);
    expect(isWarning(blocked('C', 'm'))).toBe(false);
  });
});

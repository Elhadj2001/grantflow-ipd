import { computeGrantAlertLevel, formatAmount, formatPercent } from '../pilotage';

describe('lib/api/pilotage helpers', () => {
  describe('formatAmount', () => {
    it('formate avec espace insécable + devise', () => {
      const v = formatAmount(1_234_567, 'XOF');
      //   = espace insécable
      expect(v).toContain('XOF');
      expect(v).toMatch(/1.234.567|1\s234\s567/);
    });

    it('NaN ou Infinity → "—"', () => {
      expect(formatAmount(NaN)).toBe('—');
      expect(formatAmount(Infinity)).toBe('—');
    });
  });

  describe('formatPercent', () => {
    it('formate 0.123 → "12,3 %"', () => {
      const v = formatPercent(0.123);
      expect(v).toMatch(/12[.,]3\s%/);
    });

    it('NaN → "—"', () => {
      expect(formatPercent(NaN)).toBe('—');
    });
  });

  describe('computeGrantAlertLevel', () => {
    const today = new Date('2026-05-15T00:00:00Z');

    it('aucun warning quand échéance lointaine et utilisation faible', () => {
      expect(computeGrantAlertLevel('2027-12-31', 0.3, today)).toBe('none');
    });

    it('warning si échéance < 90j', () => {
      expect(computeGrantAlertLevel('2026-07-15', 0.3, today)).toBe('warning');
    });

    it('critical si échéance ≤ 30j', () => {
      expect(computeGrantAlertLevel('2026-06-01', 0.3, today)).toBe('critical');
    });

    it('critical si utilisation ≥ 90% (même si grant à long terme)', () => {
      expect(computeGrantAlertLevel('2027-12-31', 0.95, today)).toBe('critical');
    });

    it('warning si utilisation ≥ 75% (mais < 90%)', () => {
      expect(computeGrantAlertLevel('2027-12-31', 0.8, today)).toBe('warning');
    });
  });
});

import {
  filterReportsForBailleur,
  OFFICIAL_TEMPLATE_CODES,
  varianceLevel,
  type DonorReportSummary,
} from '../reporting';

describe('lib/api/reporting helpers', () => {
  describe('varianceLevel', () => {
    it('< 5 % → none', () => {
      expect(varianceLevel(0)).toBe('none');
      expect(varianceLevel(3)).toBe('none');
      expect(varianceLevel(-4.9)).toBe('none');
    });
    it('entre 5 % et 15 % → warning', () => {
      expect(varianceLevel(5)).toBe('warning');
      expect(varianceLevel(10)).toBe('warning');
      expect(varianceLevel(-15)).toBe('warning');
    });
    it('> 15 % → critical', () => {
      expect(varianceLevel(20)).toBe('critical');
      expect(varianceLevel(-50)).toBe('critical');
    });
  });

  describe('OFFICIAL_TEMPLATE_CODES', () => {
    it('contient USAID / OMS / Wellcome', () => {
      expect(OFFICIAL_TEMPLATE_CODES.has('USAID_FFR425')).toBe(true);
      expect(OFFICIAL_TEMPLATE_CODES.has('OMS_STANDARD')).toBe(true);
      expect(OFFICIAL_TEMPLATE_CODES.has('WELLCOME_TRUST')).toBe(true);
    });
    it('ne contient pas un code custom', () => {
      expect(OFFICIAL_TEMPLATE_CODES.has('CUSTOM_IPD')).toBe(false);
    });
  });

  describe('filterReportsForBailleur', () => {
    const reports = [
      { id: 'r1', status: 'draft' },
      { id: 'r2', status: 'locked' },
      { id: 'r3', status: 'sent' },
      { id: 'r4', status: 'sent' },
    ] as Partial<DonorReportSummary>[] as DonorReportSummary[];

    it('garde uniquement les sent', () => {
      const filtered = filterReportsForBailleur(reports);
      expect(filtered).toHaveLength(2);
      expect(filtered.every((r) => r.status === 'sent')).toBe(true);
    });

    it('liste vide → liste vide', () => {
      expect(filterReportsForBailleur([])).toEqual([]);
    });
  });
});

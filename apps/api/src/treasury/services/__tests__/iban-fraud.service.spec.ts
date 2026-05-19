import { IbanFraudService, type IbanAlert } from '../iban-fraud.service';
import { PrismaService } from '../../../prisma/prisma.service';

describe('IbanFraudService', () => {
  let svc: IbanFraudService;
  let prisma: {
    supplier: { findMany: jest.Mock };
    supplierIbanHistory: { findFirst: jest.Mock };
  };

  beforeEach(() => {
    prisma = {
      supplier: { findMany: jest.fn() },
      supplierIbanHistory: { findFirst: jest.fn() },
    };
    svc = new IbanFraudService(prisma as unknown as PrismaService);
  });

  describe('computeAlertsForRun', () => {
    it('returns empty when no suppliers concerned by run', async () => {
      prisma.supplier.findMany.mockResolvedValue([]);
      const alerts = await svc.computeAlertsForRun('run-1');
      expect(alerts).toEqual([]);
      // Pas d'appel à supplierIbanHistory (early return)
      expect(prisma.supplierIbanHistory.findFirst).not.toHaveBeenCalled();
    });

    it('returns empty when supplier has no historical IBAN change in window', async () => {
      prisma.supplier.findMany.mockResolvedValue([
        { id: 's1', code: 'A', name: 'Alice', iban: 'FR76...' },
      ]);
      prisma.supplierIbanHistory.findFirst.mockResolvedValue(null);
      const alerts = await svc.computeAlertsForRun('run-1');
      expect(alerts).toEqual([]);
    });

    it('flags supplier whose IBAN was changed within window', async () => {
      prisma.supplier.findMany.mockResolvedValue([
        { id: 's1', code: 'THERMO', name: 'Thermo', iban: 'FR76NEW' },
      ]);
      const changedAt = new Date(Date.now() - 5 * 24 * 3600 * 1000); // 5j ago
      prisma.supplierIbanHistory.findFirst.mockResolvedValue({
        supplierId: 's1',
        iban: 'FR76OLD',
        effectiveTo: changedAt,
        changedBy: 'user-x',
      });

      const alerts = await svc.computeAlertsForRun('run-1');
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toMatchObject({
        supplierId: 's1',
        supplierCode: 'THERMO',
        supplierName: 'Thermo',
        currentIban: 'FR76NEW',
        previousIban: 'FR76OLD',
        daysSinceChange: expect.any(Number),
        acknowledged: false,
      });
      expect(alerts[0].daysSinceChange).toBeGreaterThanOrEqual(4);
      expect(alerts[0].daysSinceChange).toBeLessThanOrEqual(6);
    });

    it('uses custom windowDays parameter', async () => {
      prisma.supplier.findMany.mockResolvedValue([
        { id: 's1', code: 'A', name: 'Alice', iban: 'FR76' },
      ]);
      prisma.supplierIbanHistory.findFirst.mockResolvedValue(null);
      await svc.computeAlertsForRun('run-1', 60);
      const call = prisma.supplierIbanHistory.findFirst.mock.calls[0][0];
      // gte cutoff doit être ~ now - 60j
      const cutoff = call.where.effectiveTo.gte as Date;
      const diffDays = (Date.now() - cutoff.getTime()) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeCloseTo(60, 0);
    });

    it('multiple suppliers : one alert per supplier with recent change', async () => {
      prisma.supplier.findMany.mockResolvedValue([
        { id: 's1', code: 'A', name: 'Alice', iban: 'FR1' },
        { id: 's2', code: 'B', name: 'Bob', iban: 'FR2' },
      ]);
      const recent = new Date(Date.now() - 10 * 24 * 3600 * 1000);
      prisma.supplierIbanHistory.findFirst
        .mockResolvedValueOnce({ supplierId: 's1', iban: 'OLD1', effectiveTo: recent, changedBy: null })
        .mockResolvedValueOnce(null); // s2 sans alerte

      const alerts = await svc.computeAlertsForRun('run-1');
      expect(alerts).toHaveLength(1);
      expect(alerts[0].supplierId).toBe('s1');
    });
  });

  describe('countUnacknowledged', () => {
    it('returns 0 for null/empty alerts', () => {
      expect(svc.countUnacknowledged(null)).toBe(0);
      expect(svc.countUnacknowledged([])).toBe(0);
    });

    it('counts only non-acknowledged entries', () => {
      const alerts: IbanAlert[] = [
        makeAlert({ acknowledged: false }),
        makeAlert({ acknowledged: true }),
        makeAlert({ acknowledged: false }),
      ];
      expect(svc.countUnacknowledged(alerts)).toBe(2);
    });
  });

  describe('acknowledgeAll', () => {
    it('marks all alerts as acknowledged with metadata', () => {
      const alerts: IbanAlert[] = [
        makeAlert({ acknowledged: false }),
        makeAlert({ acknowledged: false }),
      ];
      const result = svc.acknowledgeAll(alerts, {
        email: 'daf@pasteur.sn',
        reason: 'Vérifié par téléphone',
      });
      expect(result.every((a) => a.acknowledged)).toBe(true);
      expect(result[0].acknowledgedBy).toBe('daf@pasteur.sn');
      expect(result[0].acknowledgeReason).toBe('Vérifié par téléphone');
      expect(result[0].acknowledgedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('preserves existing ack metadata for already-acked alerts', () => {
      const previouslyAcked: IbanAlert = makeAlert({
        acknowledged: true,
        acknowledgedBy: 'old@pasteur.sn',
        acknowledgedAt: '2026-01-01T00:00:00.000Z',
        acknowledgeReason: 'Old reason',
      });
      const result = svc.acknowledgeAll([previouslyAcked], {
        email: 'new@pasteur.sn',
        reason: 'New reason',
      });
      expect(result[0].acknowledgedBy).toBe('old@pasteur.sn');
      expect(result[0].acknowledgeReason).toBe('Old reason');
    });

    it('returns new array (immutable)', () => {
      const alerts: IbanAlert[] = [makeAlert({ acknowledged: false })];
      const result = svc.acknowledgeAll(alerts, { email: 'a', reason: 'b' });
      expect(result).not.toBe(alerts);
      expect(alerts[0].acknowledged).toBe(false);
    });
  });

  describe('maskIban', () => {
    it('returns dash for null/undefined', () => {
      expect(svc.maskIban(null)).toBe('—');
      expect(svc.maskIban(undefined)).toBe('—');
    });

    it('masks middle digits keeping country + last 4', () => {
      expect(svc.maskIban('FR7630006000011234567890189')).toBe('FR76 **** **** **** **01 89');
    });

    it('handles whitespace input', () => {
      expect(svc.maskIban('FR76 3000 6000 0112 3456 7890 189')).toBe('FR76 **** **** **** **01 89');
    });

    it('returns **** for too-short input', () => {
      expect(svc.maskIban('FR76')).toBe('****');
    });
  });
});

function makeAlert(overrides: Partial<IbanAlert> = {}): IbanAlert {
  return {
    supplierId: 's1',
    supplierCode: 'A',
    supplierName: 'Alice',
    currentIban: 'FR76NEW',
    previousIban: 'FR76OLD',
    changedAt: new Date().toISOString(),
    daysSinceChange: 5,
    changedBy: null,
    acknowledged: false,
    acknowledgedBy: null,
    acknowledgedAt: null,
    acknowledgeReason: null,
    ...overrides,
  };
}

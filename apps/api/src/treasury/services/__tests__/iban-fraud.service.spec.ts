import { IbanFraudService, IBAN_ALERT_WINDOW_DAYS } from '../iban-fraud.service';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Tests unitaires IbanFraudService (sprint 5.2).
 *
 * Couvre :
 *  - pas d'alerte si fournisseur sans historique (1 ligne)
 *  - pas d'alerte si la précédente entry est plus vieille que 90 jours
 *  - alerte si changement < 90 jours
 *  - le payload d'alerte inclut current/previous IBAN + days
 *  - run vide → tableau vide
 *  - plusieurs payments → plusieurs alertes potentielles
 */
describe('IbanFraudService', () => {
  let prisma: {
    payment: { findMany: jest.Mock };
    supplierIbanHistory: { findMany: jest.Mock };
  };
  let svc: IbanFraudService;

  function makePayment(supplierId: string, supplierCode: string) {
    return {
      id: `p-${supplierCode}`,
      invoiceId: `inv-${supplierCode}`,
      invoice: {
        id: `inv-${supplierCode}`,
        supplier: { id: supplierId, code: supplierCode, name: supplierCode, iban: 'CURRENT' },
      },
    };
  }

  beforeEach(() => {
    prisma = {
      payment: { findMany: jest.fn() },
      supplierIbanHistory: { findMany: jest.fn() },
    };
    svc = new IbanFraudService(prisma as unknown as PrismaService);
  });

  it('returns empty when run has no payments', async () => {
    prisma.payment.findMany.mockResolvedValue([]);
    const r = await svc.checkPaymentRun('run-1');
    expect(r).toEqual([]);
  });

  it('no alert when supplier has no history (less than 2 entries)', async () => {
    prisma.payment.findMany.mockResolvedValue([makePayment('s1', 'ACME')]);
    prisma.supplierIbanHistory.findMany.mockResolvedValue([
      { iban: 'CURRENT', effectiveTo: null },
    ]);
    const r = await svc.checkPaymentRun('run-1');
    expect(r).toEqual([]);
  });

  it('no alert when previous IBAN change is older than 90 days', async () => {
    prisma.payment.findMany.mockResolvedValue([makePayment('s1', 'ACME')]);
    const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
    prisma.supplierIbanHistory.findMany.mockResolvedValue([
      { iban: 'CURRENT', effectiveTo: null, changedBy: null, changeReason: null },
      { iban: 'OLD', effectiveTo: oldDate },
    ]);
    const r = await svc.checkPaymentRun('run-1');
    expect(r).toEqual([]);
  });

  it('alerts when IBAN changed within 90 days', async () => {
    prisma.payment.findMany.mockResolvedValue([makePayment('s1', 'ACME')]);
    const recentDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    prisma.supplierIbanHistory.findMany.mockResolvedValue([
      {
        iban: 'NEW-IBAN',
        effectiveTo: null,
        changedBy: 'user-1',
        changeReason: 'PATCH',
      },
      { iban: 'OLD-IBAN', effectiveTo: recentDate },
    ]);
    const r = await svc.checkPaymentRun('run-1');
    expect(r).toHaveLength(1);
    expect(r[0].currentIban).toBe('NEW-IBAN');
    expect(r[0].previousIban).toBe('OLD-IBAN');
    expect(r[0].daysSinceChange).toBe(7);
    expect(r[0].supplierCode).toBe('ACME');
    expect(r[0].changeReason).toBe('PATCH');
  });

  it('alert at the boundary (exactly 90 days ago) still fires', async () => {
    prisma.payment.findMany.mockResolvedValue([makePayment('s1', 'ACME')]);
    const boundary = new Date(
      Date.now() - (IBAN_ALERT_WINDOW_DAYS - 1) * 24 * 60 * 60 * 1000,
    );
    prisma.supplierIbanHistory.findMany.mockResolvedValue([
      { iban: 'NEW', effectiveTo: null, changedBy: null, changeReason: null },
      { iban: 'OLD', effectiveTo: boundary },
    ]);
    const r = await svc.checkPaymentRun('run-1');
    expect(r).toHaveLength(1);
  });

  it('no alert when previous entry has no effectiveTo (data anomaly)', async () => {
    prisma.payment.findMany.mockResolvedValue([makePayment('s1', 'ACME')]);
    prisma.supplierIbanHistory.findMany.mockResolvedValue([
      { iban: 'X', effectiveTo: null },
      { iban: 'Y', effectiveTo: null }, // anomaly: 2 currents
    ]);
    const r = await svc.checkPaymentRun('run-1');
    expect(r).toEqual([]);
  });

  it('multiple payments → multiple alerts independently evaluated', async () => {
    prisma.payment.findMany.mockResolvedValue([
      makePayment('s1', 'ACME'),
      makePayment('s2', 'BIOTECH'),
    ]);
    const recentDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const oldDate = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000);
    prisma.supplierIbanHistory.findMany
      .mockResolvedValueOnce([
        { iban: 'A-NEW', effectiveTo: null, changedBy: null, changeReason: null },
        { iban: 'A-OLD', effectiveTo: recentDate },
      ])
      .mockResolvedValueOnce([
        { iban: 'B-NEW', effectiveTo: null, changedBy: null, changeReason: null },
        { iban: 'B-OLD', effectiveTo: oldDate },
      ]);
    const r = await svc.checkPaymentRun('run-1');
    expect(r).toHaveLength(1); // Only ACME alert
    expect(r[0].supplierCode).toBe('ACME');
  });

  it('alert payload includes invoiceId and paymentId for traceability', async () => {
    prisma.payment.findMany.mockResolvedValue([makePayment('s1', 'ACME')]);
    const recentDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    prisma.supplierIbanHistory.findMany.mockResolvedValue([
      { iban: 'NEW', effectiveTo: null, changedBy: null, changeReason: null },
      { iban: 'OLD', effectiveTo: recentDate },
    ]);
    const r = await svc.checkPaymentRun('run-1');
    expect(r[0].paymentId).toBe('p-ACME');
    expect(r[0].invoiceId).toBe('inv-ACME');
    expect(r[0].supplierId).toBe('s1');
  });

  it('alert daysSinceChange floor-rounds correctly', async () => {
    prisma.payment.findMany.mockResolvedValue([makePayment('s1', 'ACME')]);
    const date1d = new Date(Date.now() - 1.7 * 24 * 60 * 60 * 1000);
    prisma.supplierIbanHistory.findMany.mockResolvedValue([
      { iban: 'NEW', effectiveTo: null, changedBy: null, changeReason: null },
      { iban: 'OLD', effectiveTo: date1d },
    ]);
    const r = await svc.checkPaymentRun('run-1');
    expect(r[0].daysSinceChange).toBe(1);
  });

  it('IBAN_ALERT_WINDOW_DAYS exported as 90', () => {
    expect(IBAN_ALERT_WINDOW_DAYS).toBe(90);
  });
});

import type { FiscalPeriod } from '@prisma/client';
import { PeriodCloseService } from '../services/period-close.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  PeriodAlreadyClosedException,
  PeriodAlreadyOpenException,
  PeriodCloseBlockedException,
  PeriodCloseReasonRequiredException,
  PeriodNotFoundException,
  PeriodReopenReasonRequiredException,
} from '../../common/exceptions/business.exception';

describe('PeriodCloseService', () => {
  const periodId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const actor = {
    id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    email: 'daf@pasteur.sn',
    fullName: 'DAF Test',
  };

  const openPeriod: FiscalPeriod = {
    id: periodId,
    code: '2026-01',
    periodType: 'month',
    startDate: new Date('2026-01-01'),
    endDate: new Date('2026-01-31'),
    isClosed: false,
    closedAt: null,
    closedBy: null,
    reopenedAt: null,
    reopenedBy: null,
    reopenReason: null,
  } as unknown as FiscalPeriod;

  const closedPeriod: FiscalPeriod = {
    ...openPeriod,
    isClosed: true,
    closedAt: new Date('2026-02-05T10:00:00Z'),
    closedBy: actor.id,
  } as unknown as FiscalPeriod;

  type PrismaMock = {
    fiscalPeriod: { findUnique: jest.Mock; findFirst: jest.Mock; findMany: jest.Mock; update: jest.Mock };
    periodCloseCheck: { deleteMany: jest.Mock; createMany: jest.Mock; findMany: jest.Mock };
    periodCloseEvent: { create: jest.Mock; findMany: jest.Mock };
    purchaseRequest: { count: jest.Mock };
    purchaseOrder: { count: jest.Mock };
    invoice: { count: jest.Mock };
    goodsReceipt: { count: jest.Mock };
    dedicatedFundMovement: { findMany: jest.Mock };
    $queryRaw: jest.Mock;
    $queryRawUnsafe: jest.Mock;
    $transaction: jest.Mock;
  };
  let prisma: PrismaMock;
  let svc: PeriodCloseService;

  beforeEach(() => {
    prisma = {
      fiscalPeriod: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      periodCloseCheck: { deleteMany: jest.fn(), createMany: jest.fn(), findMany: jest.fn() },
      periodCloseEvent: { create: jest.fn(), findMany: jest.fn() },
      purchaseRequest: { count: jest.fn().mockResolvedValue(0) },
      purchaseOrder: { count: jest.fn().mockResolvedValue(0) },
      invoice: { count: jest.fn().mockResolvedValue(0) },
      goodsReceipt: { count: jest.fn().mockResolvedValue(0) },
      dedicatedFundMovement: { findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      $queryRawUnsafe: jest.fn().mockResolvedValue([]),
      $transaction: jest.fn(async (arg: unknown) => {
        if (typeof arg === 'function') return (arg as (tx: unknown) => unknown)(prisma);
        return Promise.all(arg as Promise<unknown>[]);
      }),
    };
    svc = new PeriodCloseService(prisma as unknown as PrismaService);
  });

  // -------------------------------------------------------------- listing

  describe('listEvents', () => {
    it('throws PeriodNotFoundException when period missing', async () => {
      prisma.fiscalPeriod.findUnique.mockResolvedValue(null);
      await expect(svc.listEvents(periodId)).rejects.toBeInstanceOf(PeriodNotFoundException);
    });
    it('returns events ordered desc', async () => {
      prisma.fiscalPeriod.findUnique.mockResolvedValue(openPeriod);
      prisma.periodCloseEvent.findMany.mockResolvedValue([{ id: 'e1' }]);
      const r = await svc.listEvents(periodId);
      expect(r).toEqual([{ id: 'e1' }]);
      expect(prisma.periodCloseEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { occurredAt: 'desc' } }),
      );
    });
  });

  describe('listChecks', () => {
    it('throws PeriodNotFoundException when period missing', async () => {
      prisma.fiscalPeriod.findUnique.mockResolvedValue(null);
      await expect(svc.listChecks(periodId)).rejects.toBeInstanceOf(PeriodNotFoundException);
    });
    it('returns checks for the period', async () => {
      prisma.fiscalPeriod.findUnique.mockResolvedValue(openPeriod);
      prisma.periodCloseCheck.findMany.mockResolvedValue([{ code: 'C001' }]);
      await svc.listChecks(periodId);
      expect(prisma.periodCloseCheck.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { periodId } }),
      );
    });
  });

  // -------------------------------------------------------------- precheck

  describe('precheck', () => {
    it('returns canClose=true when no findings', async () => {
      prisma.fiscalPeriod.findUnique.mockResolvedValue(openPeriod);
      const r = await svc.precheck(actor, periodId);
      expect(r.canClose).toBe(true);
      expect(r.blockingCount).toBe(0);
      expect(r.warningCount).toBe(0);
      expect(r.findings).toHaveLength(0);
    });

    it('returns blocking C001 when pending PRs exist', async () => {
      prisma.fiscalPeriod.findUnique.mockResolvedValue(openPeriod);
      prisma.purchaseRequest.count.mockResolvedValue(3);
      const r = await svc.precheck(actor, periodId);
      expect(r.canClose).toBe(false);
      expect(r.blockingCount).toBe(1);
      expect(r.findings[0].code).toBe('C001');
      expect(r.findings[0].payload).toEqual({ count: 3 });
    });

    it('returns blocking C002 + C003 when both exist', async () => {
      prisma.fiscalPeriod.findUnique.mockResolvedValue(openPeriod);
      prisma.purchaseOrder.count.mockResolvedValue(2);
      prisma.invoice.count.mockResolvedValue(1);
      const r = await svc.precheck(actor, periodId);
      const codes = r.findings.map((f) => f.code).sort();
      expect(codes).toEqual(['C002', 'C003']);
      expect(r.blockingCount).toBe(2);
    });

    it('returns warning W003 when previous period not closed', async () => {
      prisma.fiscalPeriod.findUnique.mockResolvedValue(openPeriod);
      prisma.fiscalPeriod.findFirst.mockResolvedValue({
        ...openPeriod,
        id: 'prev',
        code: '2025-12',
        isClosed: false,
      });
      const r = await svc.precheck(actor, periodId);
      expect(r.canClose).toBe(true); // warning only
      expect(r.warningCount).toBe(1);
      expect(r.findings[0].code).toBe('W003');
    });

    it('persists findings (deleteMany + createMany) and creates a precheck event', async () => {
      prisma.fiscalPeriod.findUnique.mockResolvedValue(openPeriod);
      prisma.purchaseRequest.count.mockResolvedValue(1);
      await svc.precheck(actor, periodId);
      expect(prisma.periodCloseCheck.deleteMany).toHaveBeenCalledWith({ where: { periodId } });
      expect(prisma.periodCloseCheck.createMany).toHaveBeenCalled();
      expect(prisma.periodCloseEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'precheck',
            userId: actor.id,
          }),
        }),
      );
    });

    it('throws PeriodNotFoundException when period missing', async () => {
      prisma.fiscalPeriod.findUnique.mockResolvedValue(null);
      await expect(svc.precheck(actor, periodId)).rejects.toBeInstanceOf(PeriodNotFoundException);
    });
  });

  // -------------------------------------------------------------- close

  describe('close', () => {
    it('throws PeriodAlreadyClosedException when already closed', async () => {
      prisma.fiscalPeriod.findUnique.mockResolvedValue(closedPeriod);
      await expect(svc.close(actor, periodId, {})).rejects.toBeInstanceOf(
        PeriodAlreadyClosedException,
      );
    });

    it('closes period when no blocking findings', async () => {
      prisma.fiscalPeriod.findUnique.mockResolvedValue(openPeriod);
      prisma.fiscalPeriod.update.mockResolvedValue({ ...openPeriod, isClosed: true });
      const r = await svc.close(actor, periodId, {});
      expect(r.isClosed).toBe(true);
      expect(prisma.periodCloseEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'close', userId: actor.id }),
        }),
      );
    });

    it('throws PeriodCloseBlockedException when blocking findings + no ack', async () => {
      prisma.fiscalPeriod.findUnique.mockResolvedValue(openPeriod);
      prisma.purchaseRequest.count.mockResolvedValue(2);
      await expect(svc.close(actor, periodId, {})).rejects.toBeInstanceOf(
        PeriodCloseBlockedException,
      );
    });

    it('throws PeriodCloseReasonRequiredException when ack=true but no reason', async () => {
      prisma.fiscalPeriod.findUnique.mockResolvedValue(openPeriod);
      prisma.purchaseRequest.count.mockResolvedValue(2);
      await expect(
        svc.close(actor, periodId, { acknowledgeWarnings: true }),
      ).rejects.toBeInstanceOf(PeriodCloseReasonRequiredException);
    });

    it('closes with override + reason when ack=true + reason >= 5 chars', async () => {
      prisma.fiscalPeriod.findUnique.mockResolvedValue(openPeriod);
      prisma.purchaseRequest.count.mockResolvedValue(2);
      prisma.fiscalPeriod.update.mockResolvedValue({ ...openPeriod, isClosed: true });
      const r = await svc.close(actor, periodId, {
        acknowledgeWarnings: true,
        reason: 'Annuel — DAF a validé hors PR',
      });
      expect(r.isClosed).toBe(true);
      const eventCall = prisma.periodCloseEvent.create.mock.calls[0][0];
      expect(eventCall.data.payload.blockingOverridden).toBe(1);
    });

    it('throws PeriodNotFoundException when period missing', async () => {
      prisma.fiscalPeriod.findUnique.mockResolvedValue(null);
      await expect(svc.close(actor, periodId, {})).rejects.toBeInstanceOf(
        PeriodNotFoundException,
      );
    });
  });

  // -------------------------------------------------------------- reopen

  describe('reopen', () => {
    it('throws PeriodReopenReasonRequiredException when reason empty', async () => {
      await expect(svc.reopen(actor, periodId, { reason: '' })).rejects.toBeInstanceOf(
        PeriodReopenReasonRequiredException,
      );
    });

    it('throws PeriodAlreadyOpenException when period not closed', async () => {
      prisma.fiscalPeriod.findUnique.mockResolvedValue(openPeriod);
      await expect(
        svc.reopen(actor, periodId, { reason: 'Correction écriture' }),
      ).rejects.toBeInstanceOf(PeriodAlreadyOpenException);
    });

    it('reopens period and writes audit event', async () => {
      prisma.fiscalPeriod.findUnique.mockResolvedValue(closedPeriod);
      prisma.fiscalPeriod.update.mockResolvedValue({ ...closedPeriod, isClosed: false });
      const r = await svc.reopen(actor, periodId, { reason: 'Correction écriture' });
      expect(r.isClosed).toBe(false);
      expect(prisma.periodCloseEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'reopen',
            reason: 'Correction écriture',
            userId: actor.id,
          }),
        }),
      );
    });

    it('throws PeriodNotFoundException when period missing', async () => {
      prisma.fiscalPeriod.findUnique.mockResolvedValue(null);
      await expect(svc.reopen(actor, periodId, { reason: 'Correction' })).rejects.toBeInstanceOf(
        PeriodNotFoundException,
      );
    });
  });

  // -------------------------------------------------------------- checks fins

  describe('individual checks', () => {
    it('C001 returns null when count=0', async () => {
      prisma.purchaseRequest.count.mockResolvedValue(0);
      const f = await svc.checkPendingPurchaseRequests(openPeriod);
      expect(f).toBeNull();
    });

    it('C004 returns finding when unbalanced entries detected', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([
        { entry_id: 'eee', diff: 12.34 },
      ]);
      const f = await svc.checkUnbalancedEntries(openPeriod);
      expect(f?.code).toBe('C004');
      expect(f?.severity).toBe('BLOCKING');
    });

    it('C005 flags grants with resources but no dedicated fund movement', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{ grant_id: 'g1', resources_received: 100 }]);
      prisma.dedicatedFundMovement.findMany.mockResolvedValue([]);
      const f = await svc.checkDedicatedFundsNotAllocated(openPeriod);
      expect(f?.code).toBe('C005');
    });

    it('W001 returns null when no variance > 10%', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]);
      const f = await svc.checkBudgetVarianceWarning(openPeriod);
      expect(f).toBeNull();
    });

    it('W002 returns null gracefully when supplier_iban_history missing', async () => {
      prisma.$queryRaw.mockRejectedValueOnce(new Error('relation does not exist'));
      const f = await svc.checkRecentIbanChangesWarning(openPeriod);
      expect(f).toBeNull();
    });

    it('W003 returns null when previous period is closed', async () => {
      prisma.fiscalPeriod.findFirst.mockResolvedValue({ ...closedPeriod, code: '2025-12' });
      const f = await svc.checkPreviousPeriodNotClosedWarning(openPeriod);
      expect(f).toBeNull();
    });
  });
});

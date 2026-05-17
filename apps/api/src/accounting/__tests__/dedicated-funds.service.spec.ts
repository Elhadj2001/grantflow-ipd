import { FundMovement } from '@prisma/client';
import type { FiscalPeriod } from '@prisma/client';
import {
  ACCOUNT_DEDICATED_FUND_BALANCE,
  ACCOUNT_DEDICATED_FUND_DOTATION,
  ACCOUNT_DEDICATED_FUND_REPRISE,
  DedicatedFundsService,
} from '../services/dedicated-funds.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  PeriodAlreadyClosedException,
  PeriodNotFoundException,
} from '../../common/exceptions/business.exception';

describe('DedicatedFundsService', () => {
  const periodId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const actor = {
    id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    email: 'controleur@pasteur.sn',
  };

  const openPeriod = {
    id: periodId,
    code: '2026-02',
    periodType: 'month',
    startDate: new Date('2026-02-01'),
    endDate: new Date('2026-02-28'),
    isClosed: false,
  } as unknown as FiscalPeriod;

  type PrismaMock = {
    fiscalPeriod: { findUnique: jest.Mock };
    grantAgreement: { findMany: jest.Mock };
    dedicatedFundMovement: {
      findFirst: jest.Mock;
      deleteMany: jest.Mock;
      create: jest.Mock;
    };
    journalEntry: { create: jest.Mock; update: jest.Mock; count: jest.Mock };
    journalLine: { createMany: jest.Mock };
    periodCloseEvent: { create: jest.Mock };
    $queryRaw: jest.Mock;
    $queryRawUnsafe: jest.Mock;
    $transaction: jest.Mock;
  };

  let prisma: PrismaMock;
  let svc: DedicatedFundsService;

  beforeEach(() => {
    prisma = {
      fiscalPeriod: { findUnique: jest.fn() },
      grantAgreement: { findMany: jest.fn().mockResolvedValue([]) },
      dedicatedFundMovement: {
        findFirst: jest.fn().mockResolvedValue(null),
        deleteMany: jest.fn(),
        create: jest.fn(),
      },
      journalEntry: {
        create: jest.fn().mockResolvedValue({ id: 'entry-1', entryNumber: 'OD-2026-0001' }),
        update: jest.fn().mockResolvedValue({ id: 'entry-1' }),
        count: jest.fn().mockResolvedValue(0),
      },
      journalLine: { createMany: jest.fn() },
      periodCloseEvent: { create: jest.fn() },
      $queryRaw: jest.fn().mockResolvedValue([]),
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ net: 0 }]),
      $transaction: jest.fn(async (arg: unknown) => {
        if (typeof arg === 'function') return (arg as (tx: unknown) => unknown)(prisma);
        return Promise.all(arg as Promise<unknown>[]);
      }),
    };
    svc = new DedicatedFundsService(prisma as unknown as PrismaService);
  });

  describe('run', () => {
    it('throws PeriodNotFoundException when period missing', async () => {
      prisma.fiscalPeriod.findUnique.mockResolvedValue(null);
      await expect(svc.run(actor, periodId)).rejects.toBeInstanceOf(PeriodNotFoundException);
    });

    it('throws PeriodAlreadyClosedException when period closed', async () => {
      prisma.fiscalPeriod.findUnique.mockResolvedValue({ ...openPeriod, isClosed: true });
      await expect(svc.run(actor, periodId)).rejects.toBeInstanceOf(
        PeriodAlreadyClosedException,
      );
    });

    it('writes period_close_event with totals when no grants', async () => {
      prisma.fiscalPeriod.findUnique.mockResolvedValue(openPeriod);
      const r = await svc.run(actor, periodId);
      expect(r.grants).toHaveLength(0);
      expect(r.totalDotation).toBe(0);
      expect(r.totalReprise).toBe(0);
      expect(prisma.periodCloseEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'dedicated_funds' }),
        }),
      );
    });
  });

  describe('processGrant', () => {
    const grant = { id: 'g1', reference: 'USAID-2026', currency: 'USD' };

    function mockSums(opts: { resources: number; expenses: number; opening?: number }) {
      // $queryRawUnsafe for sumByAccountPrefix — 75 then 6
      prisma.$queryRawUnsafe
        .mockResolvedValueOnce([{ net: opts.resources }])
        .mockResolvedValueOnce([{ net: opts.expenses }]);
      // $queryRaw for openingFundBalance
      prisma.$queryRaw.mockResolvedValueOnce([{ balance: opts.opening ?? 0 }]);
    }

    it('returns null when ressources = dépenses (no action)', async () => {
      mockSums({ resources: 500, expenses: 500 });
      const r = await svc.processGrant(actor, openPeriod, grant);
      expect(r).toBeNull();
      expect(prisma.dedicatedFundMovement.create).not.toHaveBeenCalled();
      expect(prisma.dedicatedFundMovement.deleteMany).toHaveBeenCalled();
    });

    it('creates allocation 689→19 when ressources > dépenses', async () => {
      mockSums({ resources: 1000, expenses: 300 });
      const r = await svc.processGrant(actor, openPeriod, grant);
      expect(r?.movementType).toBe(FundMovement.allocation);
      expect(r?.amount).toBe(700);
      expect(prisma.journalLine.createMany).toHaveBeenCalled();
      const linesArg = prisma.journalLine.createMany.mock.calls[0][0].data;
      expect(linesArg[0].accountCode).toBe(ACCOUNT_DEDICATED_FUND_DOTATION);
      expect(linesArg[0].debit.toString()).toBe('700');
      expect(linesArg[1].accountCode).toBe(ACCOUNT_DEDICATED_FUND_BALANCE);
      expect(linesArg[1].credit.toString()).toBe('700');
    });

    it('creates reprise 19→789 when dépenses > ressources AND opening balance > 0', async () => {
      mockSums({ resources: 200, expenses: 500, opening: 1000 });
      const r = await svc.processGrant(actor, openPeriod, grant);
      expect(r?.movementType).toBe(FundMovement.reprise);
      expect(r?.amount).toBe(300);
      const linesArg = prisma.journalLine.createMany.mock.calls[0][0].data;
      expect(linesArg[0].accountCode).toBe(ACCOUNT_DEDICATED_FUND_BALANCE);
      expect(linesArg[1].accountCode).toBe(ACCOUNT_DEDICATED_FUND_REPRISE);
    });

    it('limits reprise to opening balance', async () => {
      mockSums({ resources: 0, expenses: 1000, opening: 250 });
      const r = await svc.processGrant(actor, openPeriod, grant);
      expect(r?.amount).toBe(250);
    });

    it('returns null when dépenses > ressources but no opening balance', async () => {
      mockSums({ resources: 0, expenses: 500, opening: 0 });
      const r = await svc.processGrant(actor, openPeriod, grant);
      expect(r).toBeNull();
    });

    it('attaches grantId on both journal lines', async () => {
      mockSums({ resources: 1000, expenses: 300 });
      await svc.processGrant(actor, openPeriod, grant);
      const linesArg = prisma.journalLine.createMany.mock.calls[0][0].data;
      expect(linesArg[0].grantId).toBe(grant.id);
      expect(linesArg[1].grantId).toBe(grant.id);
    });

    it('writes movement with periodId + currency XOF', async () => {
      mockSums({ resources: 1000, expenses: 300 });
      await svc.processGrant(actor, openPeriod, grant);
      expect(prisma.dedicatedFundMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            grantId: grant.id,
            periodId: openPeriod.id,
            currency: 'XOF',
            movementType: FundMovement.allocation,
          }),
        }),
      );
    });
  });

  describe('run aggregates totals across grants', () => {
    it('sums dotations + reprises correctly', async () => {
      prisma.fiscalPeriod.findUnique.mockResolvedValue(openPeriod);
      prisma.grantAgreement.findMany.mockResolvedValue([
        { id: 'g1', reference: 'USAID', currency: 'USD' },
        { id: 'g2', reference: 'WHO', currency: 'CHF' },
      ]);
      // Grant 1 : dotation 500
      prisma.$queryRawUnsafe
        .mockResolvedValueOnce([{ net: 1000 }])
        .mockResolvedValueOnce([{ net: 500 }])
        // Grant 2 : reprise 200
        .mockResolvedValueOnce([{ net: 100 }])
        .mockResolvedValueOnce([{ net: 300 }]);
      prisma.$queryRaw
        .mockResolvedValueOnce([{ balance: 0 }])
        .mockResolvedValueOnce([{ balance: 500 }]);

      const r = await svc.run(actor, periodId);
      expect(r.grants).toHaveLength(2);
      expect(r.totalDotation).toBe(500);
      expect(r.totalReprise).toBe(200);
    });
  });
});

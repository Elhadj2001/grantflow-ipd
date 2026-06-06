import { FundMovement } from '@prisma/client';
import type { FiscalPeriod } from '@prisma/client';
import {
  ACCOUNT_DEDICATED_FUND_BALANCE,
  ACCOUNT_DEDICATED_FUND_DOTATION,
  ACCOUNT_DEDICATED_FUND_REPRISE,
  DedicatedFundsService,
} from '../services/dedicated-funds.service';
import { createPrismaMock, type PrismaMock } from '../../test-utils/prisma-mock';
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

  // Forme structurelle d'une ligne d'écriture telle que lue dans les
  // assertions. Avec mockDeep, `createMany.mock.calls[0][0].data` est typé
  // `JournalLineCreateManyInput | …[]` (union non indexable) ; on le projette
  // ici sur le sous-ensemble réellement testé.
  type JournalLineArg = {
    accountCode: string;
    debit: { toString(): string };
    credit: { toString(): string };
    grantId: string | null;
  };
  const linesOf = (calls: unknown[][]): JournalLineArg[] =>
    (calls[0][0] as { data: JournalLineArg[] }).data;

  let prisma: PrismaMock;
  let svc: DedicatedFundsService;

  beforeEach(() => {
    // US-060 (fix F2) : mockDeep<PrismaService>() via le helper partagé
    // `createPrismaMock`. Il auto-stube toute méthode tx — dont
    // `tx.journalEntry.findFirst`, ajoutée par le refactor count→findFirst du
    // générateur de numéro OD, et que l'ancien mock littéral n'exposait pas
    // (cause des 6 tests rouges F2 de cette suite). `$transaction` passthrough
    // est fourni par le helper. On ne re-stube que les retours dont les
    // assertions dépendent (mockDeep renvoie `undefined` par défaut ;
    // `findFirst` indéfini → lastSeq 0 → numéro `OD-2026-0001`).
    prisma = createPrismaMock();
    prisma.grantAgreement.findMany.mockResolvedValue([] as never);
    prisma.dedicatedFundMovement.findFirst.mockResolvedValue(null as never);
    prisma.journalEntry.create.mockResolvedValue(
      { id: 'entry-1', entryNumber: 'OD-2026-0001' } as never,
    );
    prisma.journalEntry.update.mockResolvedValue({ id: 'entry-1' } as never);
    prisma.journalEntry.count.mockResolvedValue(0 as never);
    prisma.$queryRaw.mockResolvedValue([] as never);
    prisma.$queryRawUnsafe.mockResolvedValue([{ net: 0 }] as never);
    svc = new DedicatedFundsService(prisma);
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
      const linesArg = linesOf(prisma.journalLine.createMany.mock.calls);
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
      const linesArg = linesOf(prisma.journalLine.createMany.mock.calls);
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
      const linesArg = linesOf(prisma.journalLine.createMany.mock.calls);
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
      ] as never);
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

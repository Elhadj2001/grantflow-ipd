import { Prisma, JournalType, EntryStatus, PoStatus } from '@prisma/client';
import type { PurchaseOrder } from '@prisma/client';
import { PostingService } from '../services/posting.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NoOpenFiscalPeriodException, EntityNotFoundException } from '../../common/exceptions/business.exception';

/**
 * Tests unitaires PostingService.
 *
 * Couverture :
 *  - createCommitmentEntry : équilibre 801 debit = 802 credit
 *  - Numéro d'écriture : OD-YYYY-NNNN
 *  - Imputation analytique recopiée depuis la PR liée
 *  - Période fiscale : préférence month > quarter > year
 *  - Période fiscale absente → NoOpenFiscalPeriodException
 *  - reverseCommitmentEntry : crée entrée inverse + chaîne reversedById
 *  - reverseCommitmentEntry sur entry inexistante → 404
 *  - listEntriesForPo : filtre source_type/source_id
 */
describe('PostingService', () => {
  let prisma: {
    journalEntry: { create: jest.Mock; update: jest.Mock; count: jest.Mock; findFirst: jest.Mock; findMany: jest.Mock };
    journalLine: { createMany: jest.Mock };
    fiscalPeriod: { findMany: jest.Mock };
    purchaseRequest: { findUnique: jest.Mock };
    supplier: { findUnique: jest.Mock };
    $transaction: jest.Mock;
    $executeRawUnsafe: jest.Mock;
  };
  let svc: PostingService;

  const poId = 'po000000-0000-0000-0000-000000000001';
  const prId = 'pr000000-0000-0000-0000-000000000002';
  const supplierId = 'sup00000-0000-0000-0000-000000000003';
  const projectId = 'prj00000-0000-0000-0000-000000000004';
  const grantId = 'grt00000-0000-0000-0000-000000000005';
  const blId = 'bl100000-0000-0000-0000-000000000006';
  const periodMonth = { id: 'per-month', periodType: 'month', isClosed: false };
  const periodQuarter = { id: 'per-quarter', periodType: 'quarter', isClosed: false };
  const periodYear = { id: 'per-year', periodType: 'year', isClosed: false };

  const actor = { id: 'usr-1', email: 'a@x', fullName: 'A' };

  function makePo(overrides: Partial<PurchaseOrder> = {}): PurchaseOrder & { prLinks: Array<{ prId: string }> } {
    return {
      id: poId,
      poNumber: 'BC-2026-0001',
      prId,
      supplierId,
      orderDate: new Date('2026-05-15T00:00:00Z'),
      expectedDate: null,
      status: PoStatus.draft,
      totalHt: new Prisma.Decimal('500000'),
      totalVat: new Prisma.Decimal('0'),
      totalTtc: new Prisma.Decimal('500000'),
      currency: 'XOF',
      incoterm: null,
      deliveryAddress: null,
      buyerId: null,
      sentAt: null,
      acknowledgedAt: null,
      acknowledgedBy: null,
      cancelledAt: null,
      cancellationReason: null,
      pdfObjectKey: null,
      emailSentAt: null,
      emailSentTo: null,
      createdAt: new Date(),
      ...overrides,
      prLinks: [{ prId }],
    } as PurchaseOrder & { prLinks: Array<{ prId: string }> };
  }

  beforeEach(() => {
    prisma = {
      journalEntry: {
        create: jest.fn(),
        update: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
      journalLine: { createMany: jest.fn() },
      fiscalPeriod: { findMany: jest.fn().mockResolvedValue([periodMonth, periodQuarter, periodYear]) },
      purchaseRequest: {
        findUnique: jest.fn().mockResolvedValue({
          projectId,
          grantId,
          costCenterId: null,
          activityId: null,
          lines: [{ budgetLineId: blId }],
        }),
      },
      supplier: { findUnique: jest.fn().mockResolvedValue({ name: 'ACME Lab Supplies' }) },
      $transaction: jest.fn(async (cb: unknown) => {
        if (typeof cb === 'function') return (cb as (tx: unknown) => unknown)(prisma);
        return Promise.all(cb as unknown[]);
      }),
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
    };
    svc = new PostingService(prisma as unknown as PrismaService);
  });

  // ------------------------------------------------------------------
  describe('createCommitmentEntry', () => {
    it('creates a balanced entry : 801 debit = 802 credit', async () => {
      prisma.journalEntry.create.mockResolvedValue({ id: 'je-1' });
      prisma.journalEntry.update.mockResolvedValue({ id: 'je-1', entryNumber: 'OD-2026-0001', lines: [] });
      await svc.createCommitmentEntry(makePo(), actor);

      const lines = prisma.journalLine.createMany.mock.calls[0][0].data;
      expect(lines).toHaveLength(2);
      expect(lines[0]).toMatchObject({ accountCode: '801', debit: 500000, credit: 0 });
      expect(lines[1]).toMatchObject({ accountCode: '802', debit: 0, credit: 500000 });
    });

    it('formats entry number as OD-YYYY-NNNN', async () => {
      prisma.journalEntry.count.mockResolvedValue(4);
      prisma.journalEntry.create.mockResolvedValue({ id: 'je-1' });
      prisma.journalEntry.update.mockResolvedValue({ id: 'je-1', lines: [] });
      await svc.createCommitmentEntry(makePo(), actor);
      const createArgs = prisma.journalEntry.create.mock.calls[0][0].data;
      const year = new Date().getFullYear();
      expect(createArgs.entryNumber).toBe(`OD-${year}-0005`);
      expect(createArgs.journal).toBe(JournalType.OD);
    });

    it('copies analytical imputation (project, grant, budget_line) from linked PR', async () => {
      prisma.journalEntry.create.mockResolvedValue({ id: 'je-1' });
      prisma.journalEntry.update.mockResolvedValue({ id: 'je-1', lines: [] });
      await svc.createCommitmentEntry(makePo(), actor);
      const lines = prisma.journalLine.createMany.mock.calls[0][0].data;
      expect(lines[0]).toMatchObject({ projectId, grantId, budgetLineId: blId });
      expect(lines[1]).toMatchObject({ projectId, grantId, budgetLineId: blId });
    });

    it('promotes entry to posted with postedBy/postedAt', async () => {
      prisma.journalEntry.create.mockResolvedValue({ id: 'je-1' });
      prisma.journalEntry.update.mockResolvedValue({
        id: 'je-1',
        entryNumber: 'OD-2026-0001',
        status: EntryStatus.posted,
        lines: [],
      });
      await svc.createCommitmentEntry(makePo(), actor);
      const updateArgs = prisma.journalEntry.update.mock.calls[0][0];
      expect(updateArgs.data).toMatchObject({
        status: EntryStatus.posted,
        postedBy: actor.id,
      });
      expect(updateArgs.data.postedAt).toBeInstanceOf(Date);
    });

    it('prefers month period over quarter/year', async () => {
      prisma.journalEntry.create.mockResolvedValue({ id: 'je-1' });
      prisma.journalEntry.update.mockResolvedValue({ id: 'je-1', lines: [] });
      await svc.createCommitmentEntry(makePo(), actor);
      const createArgs = prisma.journalEntry.create.mock.calls[0][0].data;
      expect(createArgs.periodId).toBe(periodMonth.id);
    });

    it('falls back to quarter then year when month period is missing', async () => {
      prisma.fiscalPeriod.findMany.mockResolvedValue([periodQuarter, periodYear]);
      prisma.journalEntry.create.mockResolvedValue({ id: 'je-1' });
      prisma.journalEntry.update.mockResolvedValue({ id: 'je-1', lines: [] });
      await svc.createCommitmentEntry(makePo(), actor);
      expect(prisma.journalEntry.create.mock.calls[0][0].data.periodId).toBe(periodQuarter.id);
    });

    it('throws NoOpenFiscalPeriodException when no period covers the date', async () => {
      prisma.fiscalPeriod.findMany.mockResolvedValue([]);
      await expect(svc.createCommitmentEntry(makePo(), actor)).rejects.toBeInstanceOf(
        NoOpenFiscalPeriodException,
      );
    });

    it('label includes po number + supplier name', async () => {
      prisma.journalEntry.create.mockResolvedValue({ id: 'je-1' });
      prisma.journalEntry.update.mockResolvedValue({ id: 'je-1', lines: [] });
      await svc.createCommitmentEntry(makePo(), actor);
      const label = prisma.journalEntry.create.mock.calls[0][0].data.label;
      expect(label).toContain('BC-2026-0001');
      expect(label).toContain('ACME Lab Supplies');
    });

    it('uses sourceType=purchase_order + sourceId=po.id', async () => {
      prisma.journalEntry.create.mockResolvedValue({ id: 'je-1' });
      prisma.journalEntry.update.mockResolvedValue({ id: 'je-1', lines: [] });
      await svc.createCommitmentEntry(makePo(), actor);
      const data = prisma.journalEntry.create.mock.calls[0][0].data;
      expect(data.sourceType).toBe('purchase_order');
      expect(data.sourceId).toBe(poId);
    });
  });

  // ------------------------------------------------------------------
  describe('reverseCommitmentEntry', () => {
    it('creates inverse entry (debit↔credit swapped)', async () => {
      const original = {
        id: 'je-1',
        entryNumber: 'OD-2026-0001',
        lines: [
          {
            id: 'l-1', lineNumber: 1, accountCode: '801', debit: 500000, credit: 0,
            currency: 'XOF', label: 'Engagement BC-2026-0001',
            projectId, grantId, budgetLineId: blId, costCenterId: null, activityId: null,
          },
          {
            id: 'l-2', lineNumber: 2, accountCode: '802', debit: 0, credit: 500000,
            currency: 'XOF', label: 'Contre-engagement BC-2026-0001',
            projectId, grantId, budgetLineId: blId, costCenterId: null, activityId: null,
          },
        ],
      };
      prisma.journalEntry.findFirst.mockResolvedValue(original);
      prisma.journalEntry.create.mockResolvedValue({ id: 'je-2' });
      prisma.journalEntry.update.mockResolvedValue({ id: 'je-2', entryNumber: 'OD-2026-0002', lines: [] });

      await svc.reverseCommitmentEntry(makePo(), actor, 'fournisseur en faillite');

      const newLines = prisma.journalLine.createMany.mock.calls[0][0].data;
      expect(newLines[0]).toMatchObject({ accountCode: '801', debit: 0, credit: 500000 });
      expect(newLines[1]).toMatchObject({ accountCode: '802', debit: 500000, credit: 0 });
    });

    it('marks original entry as reversed and chains reversedById', async () => {
      prisma.journalEntry.findFirst.mockResolvedValue({
        id: 'je-1',
        lines: [{
          id: 'l-1', lineNumber: 1, accountCode: '801', debit: 500000, credit: 0,
          currency: 'XOF', label: 'Engagement',
          projectId: null, grantId: null, budgetLineId: null, costCenterId: null, activityId: null,
        }],
      });
      prisma.journalEntry.create.mockResolvedValue({ id: 'je-2' });
      prisma.journalEntry.update
        .mockResolvedValueOnce({ id: 'je-2', entryNumber: 'OD-2026-0002', lines: [] }) // posted
        .mockResolvedValueOnce({ id: 'je-1', status: 'reversed' }); // original

      await svc.reverseCommitmentEntry(makePo(), actor, 'erreur saisie');

      const lastUpdate = prisma.journalEntry.update.mock.calls[1][0];
      expect(lastUpdate.where.id).toBe('je-1');
      expect(lastUpdate.data).toMatchObject({ reversedById: 'je-2', status: EntryStatus.reversed });
    });

    it('throws 404 when no original entry exists', async () => {
      prisma.journalEntry.findFirst.mockResolvedValue(null);
      await expect(
        svc.reverseCommitmentEntry(makePo(), actor, 'reason'),
      ).rejects.toBeInstanceOf(EntityNotFoundException);
    });
  });

  describe('listEntriesForPo', () => {
    it('filters by sourceType=purchase_order + sourceId', async () => {
      prisma.journalEntry.findMany.mockResolvedValue([]);
      await svc.listEntriesForPo(poId);
      const args = prisma.journalEntry.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ sourceType: 'purchase_order', sourceId: poId });
      expect(args.orderBy).toEqual({ createdAt: 'asc' });
    });
  });
});

import { Prisma } from '@prisma/client';
import type { BudgetLine } from '@prisma/client';
import * as XLSX from 'xlsx';
import { BudgetLineService } from '../budget-line.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { ExchangeRateService } from '../../exchange-rate/exchange-rate.service';
import {
  AlreadyActiveException,
  AlreadyInactiveException,
  BudgetLineHasUsageException,
  BudgetLinesExceedGrantException,
  EntityNotFoundException,
  InvalidGlAccountException,
} from '../../../common/exceptions/business.exception';
import type { CreateBudgetLineDto } from '../dto/create-budget-line.dto';

describe('BudgetLineService', () => {
  let prisma: {
    grantAgreement: { findUnique: jest.Mock };
    budgetLine: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      aggregate: jest.Mock;
    };
    purchaseRequestLine: { count: jest.Mock };
    purchaseOrderLine: { count: jest.Mock };
    journalLine: { count: jest.Mock };
    glAccount: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };
  let svc: BudgetLineService;

  const grantId = '11111111-1111-1111-1111-111111111111';
  const lineId = '22222222-2222-2222-2222-222222222222';

  const fakeLine: BudgetLine = {
    id: lineId,
    grantId,
    code: 'L01',
    label: 'Consommables',
    budgetedAmount: new Prisma.Decimal('38000.00'),
    defaultAccount: null,
    isOverheadEligible: true,
    isActive: true,
    budgetedAmountXof: null,
    fxRate: null,
    fxRateDate: null,
    currency: null,
  };

  function dto(overrides: Partial<CreateBudgetLineDto> = {}): CreateBudgetLineDto {
    return {
      code: 'L01',
      label: 'Consommables',
      budgetedAmount: '38000',
      isOverheadEligible: true,
      ...overrides,
    } as CreateBudgetLineDto;
  }

  beforeEach(() => {
    prisma = {
      grantAgreement: { findUnique: jest.fn() },
      budgetLine: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        aggregate: jest.fn(),
      },
      purchaseRequestLine: { count: jest.fn() },
      purchaseOrderLine: { count: jest.fn() },
      journalLine: { count: jest.fn() },
      glAccount: { findUnique: jest.fn() },
      $transaction: jest.fn(),
    };
    // US-024 : ExchangeRateService stub déterministe. XOF identité, EUR parité
    // BCEAO 655,957. La devise vient du grant (ensureGrantExists).
    const fx = {
      convertToXof: jest.fn(
        async (amount: number | { toString(): string }, currency: string) => {
          const n = Number(amount);
          const fxRateDate = new Date('2026-06-15');
          if (currency === 'EUR') {
            return { xofAmount: Math.round(n * 655.957), fxRate: 655.957, fxRateDate, isIndicativeFallback: false };
          }
          return { xofAmount: Math.round(n), fxRate: 1, fxRateDate, isIndicativeFallback: false };
        },
      ),
    };
    svc = new BudgetLineService(
      prisma as unknown as PrismaService,
      fx as unknown as ExchangeRateService,
    );
  });

  // ------------------------------------------------------------------
  describe('listByGrant', () => {
    it('throws 404 when grant does not exist', async () => {
      prisma.grantAgreement.findUnique.mockResolvedValue(null);
      await expect(svc.listByGrant(grantId)).rejects.toBeInstanceOf(EntityNotFoundException);
    });

    it('returns active lines only', async () => {
      prisma.grantAgreement.findUnique.mockResolvedValue({ amount: new Prisma.Decimal('500000'), currency: 'XOF' });
      prisma.budgetLine.findMany.mockResolvedValue([fakeLine]);
      const res = await svc.listByGrant(grantId);
      expect(res.total).toBe(1);
      expect(prisma.budgetLine.findMany).toHaveBeenCalledWith({
        where: { grantId, isActive: true },
        orderBy: { code: 'asc' },
      });
    });
  });

  // ------------------------------------------------------------------
  describe('findOne', () => {
    it('returns the line scoped to grant', async () => {
      prisma.grantAgreement.findUnique.mockResolvedValue({ amount: new Prisma.Decimal('500000'), currency: 'XOF' });
      prisma.budgetLine.findFirst.mockResolvedValue(fakeLine);
      const res = await svc.findOne(grantId, lineId);
      expect(res).toEqual(fakeLine);
      expect(prisma.budgetLine.findFirst).toHaveBeenCalledWith({
        where: { id: lineId, grantId },
      });
    });

    it('404 when line.grantId differs', async () => {
      prisma.grantAgreement.findUnique.mockResolvedValue({ amount: new Prisma.Decimal('500000'), currency: 'XOF' });
      prisma.budgetLine.findFirst.mockResolvedValue(null);
      await expect(svc.findOne(grantId, lineId)).rejects.toBeInstanceOf(EntityNotFoundException);
    });
  });

  // ------------------------------------------------------------------
  describe('create', () => {
    it('creates when sum stays within grant.amount', async () => {
      prisma.grantAgreement.findUnique.mockResolvedValue({ amount: new Prisma.Decimal('100000'), currency: 'XOF' });
      prisma.budgetLine.aggregate.mockResolvedValue({ _sum: { budgetedAmount: new Prisma.Decimal('30000') } });
      prisma.budgetLine.create.mockResolvedValue(fakeLine);

      const res = await svc.create(grantId, dto({ budgetedAmount: '20000' }));
      expect(res).toEqual(fakeLine);
    });

    it('throws BudgetLinesExceedGrantException when sum > grant.amount', async () => {
      prisma.grantAgreement.findUnique.mockResolvedValue({ amount: new Prisma.Decimal('100000'), currency: 'XOF' });
      prisma.budgetLine.aggregate.mockResolvedValue({ _sum: { budgetedAmount: new Prisma.Decimal('90000') } });
      await expect(svc.create(grantId, dto({ budgetedAmount: '20000' }))).rejects.toBeInstanceOf(
        BudgetLinesExceedGrantException,
      );
    });

    it('throws InvalidGlAccountException when defaultAccount unknown', async () => {
      prisma.grantAgreement.findUnique.mockResolvedValue({ amount: new Prisma.Decimal('100000'), currency: 'XOF' });
      prisma.glAccount.findUnique.mockResolvedValue(null);
      await expect(
        svc.create(grantId, dto({ defaultAccount: '9999' })),
      ).rejects.toBeInstanceOf(InvalidGlAccountException);
    });

    it('US-024 — fige budgetedAmountXof en EUR (parité BCEAO 655,957)', async () => {
      prisma.grantAgreement.findUnique.mockResolvedValue({
        amount: new Prisma.Decimal('100000000'),
        currency: 'EUR',
      });
      prisma.budgetLine.aggregate.mockResolvedValue({ _sum: { budgetedAmount: new Prisma.Decimal('0') } });
      prisma.budgetLine.create.mockResolvedValue(fakeLine);

      await svc.create(grantId, dto({ budgetedAmount: '100000' }));
      const data = prisma.budgetLine.create.mock.calls[0][0].data;
      // 100 000 EUR × 655,957 = 65 595 700 XOF (BIGINT).
      expect(data.budgetedAmountXof).toBe(65595700n);
      expect(data.fxRate.toString()).toBe('655.957');
      expect(data.currency).toBe('EUR');
    });

    it('US-024 — budgetedAmountXof = montant brut en XOF (no-op identité)', async () => {
      prisma.grantAgreement.findUnique.mockResolvedValue({
        amount: new Prisma.Decimal('20000000'),
        currency: 'XOF',
      });
      prisma.budgetLine.aggregate.mockResolvedValue({ _sum: { budgetedAmount: new Prisma.Decimal('0') } });
      prisma.budgetLine.create.mockResolvedValue(fakeLine);

      await svc.create(grantId, dto({ budgetedAmount: '10000000' }));
      const data = prisma.budgetLine.create.mock.calls[0][0].data;
      expect(data.budgetedAmountXof).toBe(10000000n);
      expect(data.fxRate.toString()).toBe('1');
      expect(data.currency).toBe('XOF');
    });

    it('maps P2002 to DuplicateCodeException', async () => {
      prisma.grantAgreement.findUnique.mockResolvedValue({ amount: new Prisma.Decimal('100000'), currency: 'XOF' });
      prisma.budgetLine.aggregate.mockResolvedValue({ _sum: { budgetedAmount: new Prisma.Decimal('0') } });
      prisma.budgetLine.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: '5' }),
      );
      await expect(svc.create(grantId, dto())).rejects.toMatchObject({
        code: expect.stringContaining('BUSINESS.DUPLICATE_CODE'),
      });
    });
  });

  // ------------------------------------------------------------------
  describe('update — overflow check ignores own line', () => {
    it('passes when new amount fits after subtracting old', async () => {
      prisma.grantAgreement.findUnique.mockResolvedValue({ amount: new Prisma.Decimal('100000'), currency: 'XOF' });
      prisma.budgetLine.findFirst.mockResolvedValue(fakeLine);
      // Aggregate excludes own line (id !== lineId).
      prisma.budgetLine.aggregate.mockResolvedValue({ _sum: { budgetedAmount: new Prisma.Decimal('40000') } });
      prisma.budgetLine.update.mockResolvedValue({ ...fakeLine, budgetedAmount: new Prisma.Decimal('50000') });

      const res = await svc.update(grantId, lineId, { budgetedAmount: '50000' } as never);
      expect(res.budgetedAmount.toString()).toBe('50000');
      expect(prisma.budgetLine.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: { not: lineId } }) }),
      );
    });
  });

  // ------------------------------------------------------------------
  describe('softDelete', () => {
    it('switches to inactive when no usage', async () => {
      prisma.grantAgreement.findUnique.mockResolvedValue({ amount: new Prisma.Decimal('100000'), currency: 'XOF' });
      prisma.budgetLine.findFirst.mockResolvedValue(fakeLine);
      prisma.purchaseRequestLine.count.mockResolvedValue(0);
      prisma.purchaseOrderLine.count.mockResolvedValue(0);
      prisma.journalLine.count.mockResolvedValue(0);
      prisma.budgetLine.update.mockResolvedValue({ ...fakeLine, isActive: false });

      const res = await svc.softDelete(grantId, lineId);
      expect(res.isActive).toBe(false);
    });

    it('refuses when at least one usage exists', async () => {
      prisma.grantAgreement.findUnique.mockResolvedValue({ amount: new Prisma.Decimal('100000'), currency: 'XOF' });
      prisma.budgetLine.findFirst.mockResolvedValue(fakeLine);
      prisma.purchaseRequestLine.count.mockResolvedValue(0);
      prisma.purchaseOrderLine.count.mockResolvedValue(2);
      prisma.journalLine.count.mockResolvedValue(0);

      await expect(svc.softDelete(grantId, lineId)).rejects.toBeInstanceOf(
        BudgetLineHasUsageException,
      );
    });

    it('refuses when already inactive', async () => {
      prisma.grantAgreement.findUnique.mockResolvedValue({ amount: new Prisma.Decimal('100000'), currency: 'XOF' });
      prisma.budgetLine.findFirst.mockResolvedValue({ ...fakeLine, isActive: false });
      await expect(svc.softDelete(grantId, lineId)).rejects.toBeInstanceOf(
        AlreadyInactiveException,
      );
    });
  });

  // ------------------------------------------------------------------
  describe('restore', () => {
    it('switches inactive → active', async () => {
      prisma.grantAgreement.findUnique.mockResolvedValue({ amount: new Prisma.Decimal('100000'), currency: 'XOF' });
      prisma.budgetLine.findFirst.mockResolvedValue({ ...fakeLine, isActive: false });
      prisma.budgetLine.update.mockResolvedValue({ ...fakeLine, isActive: true });
      const res = await svc.restore(grantId, lineId);
      expect(res.isActive).toBe(true);
    });

    it('refuses when already active', async () => {
      prisma.grantAgreement.findUnique.mockResolvedValue({ amount: new Prisma.Decimal('100000'), currency: 'XOF' });
      prisma.budgetLine.findFirst.mockResolvedValue(fakeLine);
      await expect(svc.restore(grantId, lineId)).rejects.toBeInstanceOf(AlreadyActiveException);
    });
  });

  // ------------------------------------------------------------------
  describe('bulkImportFromBuffer', () => {
    function buildBook(rows: Array<Record<string, unknown>>): Buffer {
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
      return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    }

    it('imports 5 valid rows in a transaction', async () => {
      prisma.grantAgreement.findUnique.mockResolvedValue({ amount: new Prisma.Decimal('500000'), currency: 'XOF' });
      prisma.budgetLine.aggregate.mockResolvedValue({ _sum: { budgetedAmount: new Prisma.Decimal('0') } });
      const txCreate = jest.fn().mockResolvedValue(fakeLine);
      prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
        await cb({ budgetLine: { create: txCreate }, glAccount: { findUnique: jest.fn() } });
      });

      const buffer = buildBook([
        { code: 'L01', label: 'Consommables labo', budgeted_amount: 38000, default_account: null, is_overhead_eligible: true },
        { code: 'L02', label: 'Personnel', budgeted_amount: 120000, default_account: null, is_overhead_eligible: true },
        { code: 'L03', label: 'Equipement', budgeted_amount: 80000, default_account: null, is_overhead_eligible: true },
        { code: 'L04', label: 'Voyages internationaux', budgeted_amount: 25000, default_account: null, is_overhead_eligible: true },
        { code: 'L05', label: 'Formation et ateliers', budgeted_amount: 40000, default_account: null, is_overhead_eligible: true },
      ]);

      const res = await svc.bulkImportFromBuffer(grantId, buffer);
      expect(res.created).toBe(5);
      expect(res.errors).toEqual([]);
      expect(txCreate).toHaveBeenCalledTimes(5);
    });

    it('rejects all when one row is invalid (e.g. negative amount)', async () => {
      prisma.grantAgreement.findUnique.mockResolvedValue({ amount: new Prisma.Decimal('500000'), currency: 'XOF' });

      const buffer = buildBook([
        { code: 'L01', label: 'Consommables labo', budgeted_amount: 38000, is_overhead_eligible: true },
        { code: 'L02', label: 'Bad neg', budgeted_amount: -100, is_overhead_eligible: true },
      ]);

      const res = await svc.bulkImportFromBuffer(grantId, buffer);
      expect(res.created).toBe(0);
      expect(res.errors).toHaveLength(1);
      expect(res.errors[0].row).toBe(3);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws BudgetLinesExceedGrantException when total exceeds grant amount', async () => {
      prisma.grantAgreement.findUnique.mockResolvedValue({ amount: new Prisma.Decimal('100000'), currency: 'XOF' });
      prisma.budgetLine.aggregate.mockResolvedValue({ _sum: { budgetedAmount: new Prisma.Decimal('50000') } });

      const buffer = buildBook([
        { code: 'L01', label: 'Big line', budgeted_amount: 80000, is_overhead_eligible: true },
      ]);
      await expect(svc.bulkImportFromBuffer(grantId, buffer)).rejects.toBeInstanceOf(
        BudgetLinesExceedGrantException,
      );
    });
  });
});

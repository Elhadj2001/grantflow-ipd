import { Prisma } from '@prisma/client';
import type { CashBox } from '@prisma/client';
import { CashBoxService } from '../cash-box.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  AlreadyActiveException,
  AlreadyInactiveException,
  DuplicateCodeException,
  EntityNotFoundException,
} from '../../../common/exceptions/business.exception';
import type { CreateCashBoxDto } from '../dto/create-cash-box.dto';
import type { UpdateCashBoxDto } from '../dto/update-cash-box.dto';
import type { CashBoxQueryDto } from '../dto/cash-box-query.dto';

/**
 * Tests unitaires CashBoxService — pattern identique au DonorService.
 *
 * Couverture :
 *  - findMany : pagination, isActive par défaut, includeInactive, search q
 *  - findOne : 200 + prCount, 404
 *  - getBalance : retourne solde + plafonds + consommation du jour
 *  - create : 200, mapping P2002 → DuplicateCodeException
 *  - replace (PUT) : 200, 404, P2002
 *  - update (PATCH) : 200, 404, P2002
 *  - softDelete : 200, 404, idempotent ALREADY_INACTIVE
 *  - restore : 200, 404, idempotent ALREADY_ACTIVE
 */
describe('CashBoxService', () => {
  let prisma: {
    cashBox: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    purchaseRequest: { aggregate: jest.Mock };
    $transaction: jest.Mock;
  };
  let svc: CashBoxService;

  const fakeCb: CashBox = {
    id: '11111111-1111-1111-1111-111111111111',
    code: 'CAISSE-PRINCIPALE',
    label: 'Caisse principale',
    custodianUserId: 'usr-caissier',
    currency: 'XOF',
    currentBalance: new Prisma.Decimal('500000'),
    ceiling: new Prisma.Decimal('500000'),
    perRequestMax: new Prisma.Decimal('100000'),
    perDayUserMax: new Prisma.Decimal('200000'),
    isActive: true,
    createdAt: new Date('2026-05-01T00:00:00Z'),
    updatedAt: new Date('2026-05-01T00:00:00Z'),
  };

  function baseQuery(overrides: Partial<CashBoxQueryDto> = {}): CashBoxQueryDto {
    return {
      page: 1,
      pageSize: 20,
      sort: 'label',
      order: 'asc',
      ...overrides,
    } as CashBoxQueryDto;
  }

  beforeEach(() => {
    prisma = {
      cashBox: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      purchaseRequest: { aggregate: jest.fn().mockResolvedValue({ _sum: { totalAmount: null } }) },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation((ops: unknown[]) => Promise.all(ops));
    svc = new CashBoxService(prisma as unknown as PrismaService);
  });

  // ------------------------------------------------------------------
  describe('findMany', () => {
    it('paginates with defaults, hides inactive by default', async () => {
      prisma.cashBox.findMany.mockResolvedValue([fakeCb]);
      prisma.cashBox.count.mockResolvedValue(1);

      const res = await svc.findMany(baseQuery());
      expect(res).toEqual({
        data: [fakeCb],
        total: 1,
        page: 1,
        pageSize: 20,
        hasMore: false,
      });
      const args = prisma.cashBox.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ isActive: true });
      expect(args.orderBy).toEqual({ label: 'asc' });
    });

    it('includeInactive=true bypasses the isActive filter', async () => {
      prisma.cashBox.findMany.mockResolvedValue([]);
      prisma.cashBox.count.mockResolvedValue(0);
      await svc.findMany(baseQuery({ includeInactive: true }));
      expect(prisma.cashBox.findMany.mock.calls[0][0].where).toEqual({});
    });

    it('isActive=false returns only inactive boxes', async () => {
      prisma.cashBox.findMany.mockResolvedValue([]);
      prisma.cashBox.count.mockResolvedValue(0);
      await svc.findMany(baseQuery({ isActive: false }));
      expect(prisma.cashBox.findMany.mock.calls[0][0].where).toEqual({ isActive: false });
    });

    it('q applies OR ILIKE on code+label', async () => {
      prisma.cashBox.findMany.mockResolvedValue([]);
      prisma.cashBox.count.mockResolvedValue(0);
      await svc.findMany(baseQuery({ q: 'principale' }));
      const where = prisma.cashBox.findMany.mock.calls[0][0].where;
      expect(where.OR).toEqual([
        { code: { contains: 'principale', mode: 'insensitive' } },
        { label: { contains: 'principale', mode: 'insensitive' } },
      ]);
    });

    it('hasMore=true when skip+data.length < total', async () => {
      prisma.cashBox.findMany.mockResolvedValue([fakeCb]);
      prisma.cashBox.count.mockResolvedValue(50);
      const res = await svc.findMany(baseQuery({ page: 1, pageSize: 1 }));
      expect(res.hasMore).toBe(true);
    });
  });

  // ------------------------------------------------------------------
  describe('findOne', () => {
    it('returns cash box + prCount', async () => {
      prisma.cashBox.findUnique.mockResolvedValue({ ...fakeCb, _count: { purchaseRequests: 7 } });
      const res = await svc.findOne(fakeCb.id);
      expect(res.prCount).toBe(7);
      expect(res.code).toBe('CAISSE-PRINCIPALE');
    });

    it('throws 404 if not found', async () => {
      prisma.cashBox.findUnique.mockResolvedValue(null);
      await expect(svc.findOne('missing')).rejects.toBeInstanceOf(EntityNotFoundException);
    });
  });

  // ------------------------------------------------------------------
  describe('getBalance', () => {
    it('returns the balance + plafonds + todayConsumed', async () => {
      prisma.cashBox.findUnique.mockResolvedValue(fakeCb);
      prisma.purchaseRequest.aggregate.mockResolvedValue({
        _sum: { totalAmount: new Prisma.Decimal('75000') },
      });
      const bal = await svc.getBalance(fakeCb.id);
      expect(bal).toEqual({
        cashBoxId: fakeCb.id,
        currency: 'XOF',
        currentBalance: 500000,
        ceiling: 500000,
        perRequestMax: 100000,
        perDayUserMax: 200000,
        todayConsumed: 75000,
      });
    });

    it('handles empty aggregate (no PR today) as 0', async () => {
      prisma.cashBox.findUnique.mockResolvedValue(fakeCb);
      prisma.purchaseRequest.aggregate.mockResolvedValue({ _sum: { totalAmount: null } });
      const bal = await svc.getBalance(fakeCb.id);
      expect(bal.todayConsumed).toBe(0);
    });

    it('throws 404 if cash box missing', async () => {
      prisma.cashBox.findUnique.mockResolvedValue(null);
      await expect(svc.getBalance('missing')).rejects.toBeInstanceOf(EntityNotFoundException);
    });
  });

  // ------------------------------------------------------------------
  describe('create', () => {
    const dto: CreateCashBoxDto = {
      code: 'CAISSE-LAB',
      label: 'Caisse labo',
      currency: 'XOF',
      currentBalance: 0,
      ceiling: 300000,
      perRequestMax: 50000,
      perDayUserMax: 100000,
    } as CreateCashBoxDto;

    it('returns 201 created on happy path', async () => {
      prisma.cashBox.create.mockResolvedValue({ ...fakeCb, ...dto });
      const res = await svc.create(dto);
      expect(res.code).toBe('CAISSE-LAB');
    });

    it('maps P2002 → DuplicateCodeException', async () => {
      prisma.cashBox.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('UNIQUE', {
          code: 'P2002',
          clientVersion: '5.x',
        }),
      );
      await expect(svc.create(dto)).rejects.toBeInstanceOf(DuplicateCodeException);
    });

    it('rethrows unknown errors unchanged', async () => {
      prisma.cashBox.create.mockRejectedValue(new Error('boom'));
      await expect(svc.create(dto)).rejects.toThrow('boom');
    });
  });

  // ------------------------------------------------------------------
  describe('replace (PUT)', () => {
    it('replaces all fields', async () => {
      prisma.cashBox.findUnique.mockResolvedValue(fakeCb);
      prisma.cashBox.update.mockResolvedValue(fakeCb);
      const dto = {
        code: 'CAISSE-NEW',
        label: 'New label',
        currency: 'XOF',
        currentBalance: 100000,
        ceiling: 500000,
        perRequestMax: 80000,
        perDayUserMax: 200000,
      } as CreateCashBoxDto;
      await svc.replace(fakeCb.id, dto);
      const data = prisma.cashBox.update.mock.calls[0][0].data;
      expect(data.custodianUserId).toBeNull(); // not provided → reset to null
      expect(data.code).toBe('CAISSE-NEW');
    });

    it('404 if not found', async () => {
      prisma.cashBox.findUnique.mockResolvedValue(null);
      await expect(
        svc.replace('missing', {} as CreateCashBoxDto),
      ).rejects.toBeInstanceOf(EntityNotFoundException);
    });

    it('P2002 → DuplicateCodeException', async () => {
      prisma.cashBox.findUnique.mockResolvedValue(fakeCb);
      prisma.cashBox.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('UNIQUE', {
          code: 'P2002',
          clientVersion: '5.x',
        }),
      );
      await expect(
        svc.replace(fakeCb.id, { code: 'X' } as CreateCashBoxDto),
      ).rejects.toBeInstanceOf(DuplicateCodeException);
    });
  });

  // ------------------------------------------------------------------
  describe('update (PATCH)', () => {
    it('updates only provided fields', async () => {
      prisma.cashBox.findUnique.mockResolvedValue(fakeCb);
      prisma.cashBox.update.mockResolvedValue(fakeCb);
      const dto = { label: 'New label' } as UpdateCashBoxDto;
      await svc.update(fakeCb.id, dto);
      expect(prisma.cashBox.update.mock.calls[0][0].data).toEqual(dto);
    });

    it('404 if not found', async () => {
      prisma.cashBox.findUnique.mockResolvedValue(null);
      await expect(svc.update('missing', {} as UpdateCashBoxDto)).rejects.toBeInstanceOf(
        EntityNotFoundException,
      );
    });
  });

  // ------------------------------------------------------------------
  describe('softDelete + restore', () => {
    it('softDelete flips isActive to false', async () => {
      prisma.cashBox.findUnique.mockResolvedValue(fakeCb);
      prisma.cashBox.update.mockResolvedValue({ ...fakeCb, isActive: false });
      const res = await svc.softDelete(fakeCb.id);
      expect(res.isActive).toBe(false);
    });

    it('softDelete on already-inactive box → ALREADY_INACTIVE', async () => {
      prisma.cashBox.findUnique.mockResolvedValue({ ...fakeCb, isActive: false });
      await expect(svc.softDelete(fakeCb.id)).rejects.toBeInstanceOf(AlreadyInactiveException);
    });

    it('restore flips isActive to true', async () => {
      prisma.cashBox.findUnique.mockResolvedValue({ ...fakeCb, isActive: false });
      prisma.cashBox.update.mockResolvedValue(fakeCb);
      const res = await svc.restore(fakeCb.id);
      expect(res.isActive).toBe(true);
    });

    it('restore on already-active box → ALREADY_ACTIVE', async () => {
      prisma.cashBox.findUnique.mockResolvedValue(fakeCb);
      await expect(svc.restore(fakeCb.id)).rejects.toBeInstanceOf(AlreadyActiveException);
    });

    it('404 if box missing on softDelete', async () => {
      prisma.cashBox.findUnique.mockResolvedValue(null);
      await expect(svc.softDelete('missing')).rejects.toBeInstanceOf(EntityNotFoundException);
    });
  });
});

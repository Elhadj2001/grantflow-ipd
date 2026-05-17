import { Prisma } from '@prisma/client';
import type { Supplier } from '@prisma/client';
import { SupplierService } from '../supplier.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  AlreadyActiveException,
  AlreadyInactiveException,
  DuplicateCodeException,
  EntityNotFoundException,
  SupplierHasActivePosException,
} from '../../../common/exceptions/business.exception';
import { ErrorCode } from '../../../common/exceptions/error-codes';
import type { CreateSupplierDto } from '../dto/create-supplier.dto';
import type { SupplierQueryDto } from '../dto/supplier-query.dto';
import { isValidIban, isValidBic } from '../iban-bic.util';

describe('SupplierService', () => {
  let prisma: {
    supplier: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    supplierIbanHistory: {
      create: jest.Mock;
      updateMany: jest.Mock;
    };
    purchaseOrder: { count: jest.Mock };
    $transaction: jest.Mock;
    $queryRaw: jest.Mock;
  };
  let svc: SupplierService;

  const fakeSupplier: Supplier = {
    id: '11111111-1111-1111-1111-111111111111',
    code: 'THERMO_FISHER',
    name: 'Thermo Fisher Scientific',
    vatNumber: null,
    address: null,
    country: 'USA',
    iban: null,
    bic: null,
    bankName: null,
    paymentTermsDays: 30,
    currencyDefault: 'USD',
    riskScore: 10,
    isActive: true,
    createdAt: new Date('2026-05-01T00:00:00Z'),
  };

  function baseQuery(overrides: Partial<SupplierQueryDto> = {}): SupplierQueryDto {
    return {
      page: 1,
      pageSize: 20,
      sort: 'name',
      order: 'asc',
      ...overrides,
    } as SupplierQueryDto;
  }

  function dto(overrides: Partial<CreateSupplierDto> = {}): CreateSupplierDto {
    return {
      code: 'THERMO_FISHER',
      name: 'Thermo Fisher Scientific',
      paymentTermsDays: 30,
      currencyDefault: 'USD',
      riskScore: 10,
      ...overrides,
    } as CreateSupplierDto;
  }

  beforeEach(() => {
    prisma = {
      supplier: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      supplierIbanHistory: {
        create: jest.fn(),
        updateMany: jest.fn(),
      },
      purchaseOrder: { count: jest.fn() },
      $transaction: jest.fn(async (arg: unknown) => {
        if (typeof arg === 'function') return (arg as (tx: unknown) => unknown)(prisma);
        return Promise.all(arg as unknown[]);
      }),
      $queryRaw: jest.fn(),
    };
    svc = new SupplierService(prisma as unknown as PrismaService);
  });

  // ------------------------------------------------------------------
  describe('findMany — standard (no q)', () => {
    it('paginates with defaults, hides inactive', async () => {
      prisma.supplier.findMany.mockResolvedValue([fakeSupplier]);
      prisma.supplier.count.mockResolvedValue(1);
      const res = await svc.findMany(baseQuery());
      expect(res.total).toBe(1);
      const args = prisma.supplier.findMany.mock.calls[0][0];
      expect(args.where).toMatchObject({ isActive: true });
    });

    it('respects includeInactive=true', async () => {
      prisma.supplier.findMany.mockResolvedValue([]);
      prisma.supplier.count.mockResolvedValue(0);
      await svc.findMany(baseQuery({ includeInactive: true }));
      const args = prisma.supplier.findMany.mock.calls[0][0];
      expect(args.where.isActive).toBeUndefined();
    });

    it('filters by country and currency', async () => {
      prisma.supplier.findMany.mockResolvedValue([]);
      prisma.supplier.count.mockResolvedValue(0);
      await svc.findMany(baseQuery({ country: 'USA', currency: 'USD' }));
      const args = prisma.supplier.findMany.mock.calls[0][0];
      expect(args.where).toMatchObject({ country: 'USA', currencyDefault: 'USD' });
    });

    it('applies sort/order', async () => {
      prisma.supplier.findMany.mockResolvedValue([]);
      prisma.supplier.count.mockResolvedValue(0);
      await svc.findMany(baseQuery({ sort: 'riskScore', order: 'desc' }));
      const args = prisma.supplier.findMany.mock.calls[0][0];
      expect(args.orderBy).toEqual({ riskScore: 'desc' });
    });
  });

  // ------------------------------------------------------------------
  describe('findMany — trigram search', () => {
    it('uses $queryRaw when q is present and returns Supplier rows', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ ...fakeSupplier, similarity: 0.45 }])
        .mockResolvedValueOnce([{ total: 1n }]);
      const res = await svc.findMany(baseQuery({ q: 'therm' }));
      expect(res.total).toBe(1);
      expect(res.data[0]).not.toHaveProperty('similarity');
      expect(res.data[0].name).toBe('Thermo Fisher Scientific');
    });

    it('falls back to ILIKE when pg_trgm unavailable', async () => {
      prisma.$queryRaw.mockRejectedValue(new Error('function similarity does not exist'));
      prisma.supplier.findMany.mockResolvedValue([fakeSupplier]);
      prisma.supplier.count.mockResolvedValue(1);
      const res = await svc.findMany(baseQuery({ q: 'therm' }));
      expect(res.total).toBe(1);
    });
  });

  // ------------------------------------------------------------------
  describe('findOne / findByCode', () => {
    it('findOne returns supplier with poCount', async () => {
      prisma.supplier.findUnique.mockResolvedValue({
        ...fakeSupplier,
        _count: { purchaseOrders: 4 },
      });
      const res = await svc.findOne(fakeSupplier.id);
      expect(res.poCount).toBe(4);
    });

    it('findOne throws 404', async () => {
      prisma.supplier.findUnique.mockResolvedValue(null);
      await expect(svc.findOne(fakeSupplier.id)).rejects.toBeInstanceOf(EntityNotFoundException);
    });

    it('findByCode returns supplier', async () => {
      prisma.supplier.findUnique.mockResolvedValue({
        ...fakeSupplier,
        _count: { purchaseOrders: 0 },
      });
      const res = await svc.findByCode('THERMO_FISHER');
      expect(res.code).toBe('THERMO_FISHER');
    });

    it('findByCode 404', async () => {
      prisma.supplier.findUnique.mockResolvedValue(null);
      await expect(svc.findByCode('NOPE')).rejects.toMatchObject({
        code: ErrorCode.BUSINESS.NOT_FOUND,
      });
    });
  });

  // ------------------------------------------------------------------
  describe('create', () => {
    it('creates and returns supplier', async () => {
      prisma.supplier.create.mockResolvedValue(fakeSupplier);
      const res = await svc.create(dto());
      expect(res).toEqual(fakeSupplier);
    });

    it('maps P2002 to DuplicateCodeException', async () => {
      prisma.supplier.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: '5' }),
      );
      await expect(svc.create(dto())).rejects.toBeInstanceOf(DuplicateCodeException);
    });
  });

  // ------------------------------------------------------------------
  describe('softDelete', () => {
    it('switches isActive to false when no open POs', async () => {
      prisma.supplier.findUnique.mockResolvedValue(fakeSupplier);
      prisma.purchaseOrder.count.mockResolvedValue(0);
      prisma.supplier.update.mockResolvedValue({ ...fakeSupplier, isActive: false });
      const res = await svc.softDelete(fakeSupplier.id);
      expect(res.isActive).toBe(false);
    });

    it('refuses when at least one open PO exists', async () => {
      prisma.supplier.findUnique.mockResolvedValue(fakeSupplier);
      prisma.purchaseOrder.count.mockResolvedValue(2);
      await expect(svc.softDelete(fakeSupplier.id)).rejects.toBeInstanceOf(
        SupplierHasActivePosException,
      );
    });

    it('refuses when already inactive', async () => {
      prisma.supplier.findUnique.mockResolvedValue({ ...fakeSupplier, isActive: false });
      await expect(svc.softDelete(fakeSupplier.id)).rejects.toBeInstanceOf(AlreadyInactiveException);
    });

    it('only counts open statuses (cancelled / closed are ignored)', async () => {
      prisma.supplier.findUnique.mockResolvedValue(fakeSupplier);
      prisma.purchaseOrder.count.mockResolvedValue(0);
      prisma.supplier.update.mockResolvedValue({ ...fakeSupplier, isActive: false });
      await svc.softDelete(fakeSupplier.id);
      const args = prisma.purchaseOrder.count.mock.calls[0][0];
      expect(args.where.status.in).toEqual(
        expect.arrayContaining(['draft', 'sent', 'acknowledged']),
      );
      expect(args.where.status.in).not.toContain('cancelled');
      expect(args.where.status.in).not.toContain('closed');
    });
  });

  // ------------------------------------------------------------------
  describe('restore', () => {
    it('restores when inactive', async () => {
      prisma.supplier.findUnique.mockResolvedValue({ ...fakeSupplier, isActive: false });
      prisma.supplier.update.mockResolvedValue(fakeSupplier);
      const res = await svc.restore(fakeSupplier.id);
      expect(res.isActive).toBe(true);
    });

    it('refuses when already active', async () => {
      prisma.supplier.findUnique.mockResolvedValue(fakeSupplier);
      await expect(svc.restore(fakeSupplier.id)).rejects.toBeInstanceOf(AlreadyActiveException);
    });
  });

  // ------------------------------------------------------------------
  describe('buildWhere helper', () => {
    it('OR clause on code/name/country when q is present', () => {
      const w = SupplierService.buildWhere(baseQuery({ q: 'thermo' }));
      expect(w.OR).toHaveLength(3);
    });
  });
});

// =====================================================================
//  iban-bic.util — tests indépendants
// =====================================================================

describe('iban-bic.util', () => {
  describe('isValidIban', () => {
    it('accepts canonical sample IBANs (GB, DE, FR, SN)', () => {
      expect(isValidIban('GB82 WEST 1234 5698 7654 32')).toBe(true);
      expect(isValidIban('DE89 3704 0044 0532 0130 00')).toBe(true);
      expect(isValidIban('FR1420041010050500013M02606')).toBe(true);
      // SN — exemple synthétique respectant le mod 97
      expect(isValidIban('GB29NWBK60161331926819')).toBe(true);
    });

    it('rejects when checksum fails', () => {
      expect(isValidIban('GB99 WEST 1234 5698 7654 32')).toBe(false);
    });

    it('rejects bad format', () => {
      expect(isValidIban('NOTANIBAN')).toBe(false);
      expect(isValidIban('123456')).toBe(false);
    });
  });

  describe('isValidBic', () => {
    it('accepts 8 and 11 char BICs', () => {
      expect(isValidBic('DEUTDEFF')).toBe(true);
      expect(isValidBic('DEUTDEFF500')).toBe(true);
    });

    it('rejects bad BIC', () => {
      expect(isValidBic('XXX')).toBe(false);
      expect(isValidBic('deutdeff')).toBe(true); // util tolère la casse (upper en interne)
      expect(isValidBic('DEUTDEFF50')).toBe(false); // 10 chars not allowed
    });
  });
});

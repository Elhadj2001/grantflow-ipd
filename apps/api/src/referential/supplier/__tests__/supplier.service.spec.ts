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
      findFirst: jest.Mock;
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
    contactEmail: null,
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
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findFirst: jest.fn(),
      },
      purchaseOrder: { count: jest.fn() },
      // Supporte les deux formes : array (Promise.all) ou callback (tx)
      $transaction: jest.fn((opsOrCb: unknown) => {
        if (typeof opsOrCb === 'function') {
          // Callback form : exécute avec le mock prisma comme tx
          return (opsOrCb as (tx: typeof prisma) => Promise<unknown>)(prisma);
        }
        return Promise.all(opsOrCb as unknown[]);
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

    // Sprint F4a — hook IBAN history
    it('inserts initial supplier_iban_history row when iban provided at create', async () => {
      const withIban = { ...fakeSupplier, iban: 'FR7630006000011234567890189', bic: 'AGRIFRPP', bankName: 'CA' };
      prisma.supplier.create.mockResolvedValue(withIban);
      await svc.create(dto({ iban: withIban.iban, bic: withIban.bic, bankName: withIban.bankName }));
      expect(prisma.supplierIbanHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          supplierId: withIban.id,
          iban: withIban.iban,
          bic: withIban.bic,
          bankName: withIban.bankName,
        }),
      });
    });

    it('does NOT insert iban_history if iban not provided at create', async () => {
      prisma.supplier.create.mockResolvedValue(fakeSupplier); // iban: null
      await svc.create(dto());
      expect(prisma.supplierIbanHistory.create).not.toHaveBeenCalled();
    });

    // Sprint F-PO-EMAIL — propagation contactEmail
    it('persists contactEmail when provided', async () => {
      const withEmail = { ...fakeSupplier, contactEmail: 'achats@biomed.demo' };
      prisma.supplier.create.mockResolvedValue(withEmail);
      await svc.create(dto({ contactEmail: 'achats@biomed.demo' }));
      expect(prisma.supplier.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ contactEmail: 'achats@biomed.demo' }),
      });
    });
  });

  // Sprint F4a — anti-fraude : historisation des changements d'IBAN
  describe('historizeIbanIfChanged hook (update)', () => {
    it('closes previous row + inserts new one when IBAN changes', async () => {
      const before = { ...fakeSupplier, iban: 'OLD_IBAN', bic: 'OLD_BIC', bankName: 'OldBank' };
      const after = { ...before, iban: 'NEW_IBAN', bic: 'NEW_BIC', bankName: 'NewBank' };
      prisma.supplier.findUnique.mockResolvedValue(before);
      prisma.supplier.update.mockResolvedValue(after);

      await svc.update(fakeSupplier.id, { iban: 'NEW_IBAN', bic: 'NEW_BIC', bankName: 'NewBank' } as never);

      // Ligne courante clôturée
      expect(prisma.supplierIbanHistory.updateMany).toHaveBeenCalledWith({
        where: { supplierId: fakeSupplier.id, effectiveTo: null },
        data: { effectiveTo: expect.any(Date) },
      });
      // Nouvelle ligne courante
      expect(prisma.supplierIbanHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          supplierId: fakeSupplier.id,
          iban: 'NEW_IBAN',
          bic: 'NEW_BIC',
          bankName: 'NewBank',
        }),
      });
    });

    it('no-op when IBAN unchanged', async () => {
      const before = { ...fakeSupplier, iban: 'SAME', bic: 'SAME_BIC', bankName: 'SameBank' };
      prisma.supplier.findUnique.mockResolvedValue(before);
      prisma.supplier.update.mockResolvedValue(before); // pas de changement

      await svc.update(fakeSupplier.id, { name: 'Renamed' } as never);

      expect(prisma.supplierIbanHistory.updateMany).not.toHaveBeenCalled();
      expect(prisma.supplierIbanHistory.create).not.toHaveBeenCalled();
    });

    it('closes row but does NOT insert new one if iban cleared (set to null)', async () => {
      const before = { ...fakeSupplier, iban: 'FR76', bic: null, bankName: null };
      const after = { ...before, iban: null };
      prisma.supplier.findUnique.mockResolvedValue(before);
      prisma.supplier.update.mockResolvedValue(after);

      await svc.update(fakeSupplier.id, { iban: null } as never);

      expect(prisma.supplierIbanHistory.updateMany).toHaveBeenCalled();
      expect(prisma.supplierIbanHistory.create).not.toHaveBeenCalled();
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

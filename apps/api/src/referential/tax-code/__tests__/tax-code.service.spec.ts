import { Prisma } from '@prisma/client';
import type { TaxCode } from '@prisma/client';
import { TaxCodeService } from '../tax-code.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  AlreadyActiveException,
  AlreadyInactiveException,
  DuplicateCodeException,
  EntityNotFoundException,
  InvalidGlAccountException,
  TaxCodeHasUsageException,
} from '../../../common/exceptions/business.exception';
import type { CreateTaxCodeDto } from '../dto/create-tax-code.dto';
import type { TaxCodeQueryDto } from '../dto/tax-code-query.dto';

describe('TaxCodeService', () => {
  let prisma: {
    taxCode: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    purchaseOrderLine: { count: jest.Mock };
    invoiceLine: { count: jest.Mock };
    glAccount: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };
  let svc: TaxCodeService;

  const fakeTax: TaxCode = {
    id: '11111111-1111-1111-1111-111111111111',
    code: 'TVA18',
    label: 'TVA 18 % standard',
    rate: new Prisma.Decimal('0.18'),
    accountCode: '4456',
    isActive: true,
  };

  function dto(overrides: Partial<CreateTaxCodeDto> = {}): CreateTaxCodeDto {
    return { code: 'TVA18', label: 'TVA 18 % standard', rate: 0.18, ...overrides } as CreateTaxCodeDto;
  }

  function baseQuery(o: Partial<TaxCodeQueryDto> = {}): TaxCodeQueryDto {
    return { page: 1, pageSize: 50, sort: 'code', order: 'asc', ...o } as TaxCodeQueryDto;
  }

  beforeEach(() => {
    prisma = {
      taxCode: { findMany: jest.fn(), findUnique: jest.fn(), count: jest.fn(), create: jest.fn(), update: jest.fn() },
      purchaseOrderLine: { count: jest.fn().mockResolvedValue(0) },
      invoiceLine: { count: jest.fn().mockResolvedValue(0) },
      glAccount: { findUnique: jest.fn() },
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
    };
    svc = new TaxCodeService(prisma as unknown as PrismaService);
  });

  describe('findMany', () => {
    it('paginates with default sort=code asc, isActive=true by default', async () => {
      prisma.taxCode.findMany.mockResolvedValue([fakeTax]);
      prisma.taxCode.count.mockResolvedValue(1);
      const res = await svc.findMany(baseQuery());
      expect(res.total).toBe(1);
      const args = prisma.taxCode.findMany.mock.calls[0][0];
      expect(args.where.isActive).toBe(true);
    });

    it('q applies OR ILIKE on code+label', async () => {
      prisma.taxCode.findMany.mockResolvedValue([]);
      prisma.taxCode.count.mockResolvedValue(0);
      await svc.findMany(baseQuery({ q: 'tva' }));
      const args = prisma.taxCode.findMany.mock.calls[0][0];
      expect(args.where.OR).toHaveLength(2);
    });

    it('includeInactive removes isActive filter', async () => {
      prisma.taxCode.findMany.mockResolvedValue([]);
      prisma.taxCode.count.mockResolvedValue(0);
      await svc.findMany(baseQuery({ includeInactive: true }));
      const args = prisma.taxCode.findMany.mock.calls[0][0];
      expect(args.where.isActive).toBeUndefined();
    });
  });

  describe('findOne / findByCode', () => {
    it('findOne returns tax', async () => {
      prisma.taxCode.findUnique.mockResolvedValue(fakeTax);
      const res = await svc.findOne(fakeTax.id);
      expect(res.code).toBe('TVA18');
    });

    it('findOne throws 404', async () => {
      prisma.taxCode.findUnique.mockResolvedValue(null);
      await expect(svc.findOne(fakeTax.id)).rejects.toBeInstanceOf(EntityNotFoundException);
    });

    it('findByCode 404', async () => {
      prisma.taxCode.findUnique.mockResolvedValue(null);
      await expect(svc.findByCode('NOPE')).rejects.toBeInstanceOf(EntityNotFoundException);
    });
  });

  describe('create', () => {
    it('creates when accountCode exists', async () => {
      prisma.glAccount.findUnique.mockResolvedValue({ code: '4456' });
      prisma.taxCode.create.mockResolvedValue(fakeTax);
      const res = await svc.create(dto({ accountCode: '4456' }));
      expect(res).toEqual(fakeTax);
    });

    it('throws InvalidGlAccountException when accountCode unknown', async () => {
      prisma.glAccount.findUnique.mockResolvedValue(null);
      await expect(svc.create(dto({ accountCode: '9999' }))).rejects.toBeInstanceOf(
        InvalidGlAccountException,
      );
    });

    it('maps P2002 to DuplicateCodeException', async () => {
      prisma.taxCode.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: '5' }),
      );
      await expect(svc.create(dto())).rejects.toBeInstanceOf(DuplicateCodeException);
    });
  });

  describe('softDelete', () => {
    it('switches to inactive when no usage', async () => {
      prisma.taxCode.findUnique.mockResolvedValue(fakeTax);
      prisma.taxCode.update.mockResolvedValue({ ...fakeTax, isActive: false });
      const res = await svc.softDelete(fakeTax.id);
      expect(res.isActive).toBe(false);
    });

    it('rejects when referenced by invoice lines', async () => {
      prisma.taxCode.findUnique.mockResolvedValue(fakeTax);
      prisma.invoiceLine.count.mockResolvedValue(5);
      await expect(svc.softDelete(fakeTax.id)).rejects.toBeInstanceOf(TaxCodeHasUsageException);
    });

    it('refuses when already inactive', async () => {
      prisma.taxCode.findUnique.mockResolvedValue({ ...fakeTax, isActive: false });
      await expect(svc.softDelete(fakeTax.id)).rejects.toBeInstanceOf(AlreadyInactiveException);
    });
  });

  describe('restore', () => {
    it('restores inactive → active', async () => {
      prisma.taxCode.findUnique.mockResolvedValue({ ...fakeTax, isActive: false });
      prisma.taxCode.update.mockResolvedValue(fakeTax);
      const res = await svc.restore(fakeTax.id);
      expect(res.isActive).toBe(true);
    });

    it('rejects already active', async () => {
      prisma.taxCode.findUnique.mockResolvedValue(fakeTax);
      await expect(svc.restore(fakeTax.id)).rejects.toBeInstanceOf(AlreadyActiveException);
    });
  });
});

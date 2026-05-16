import { Prisma } from '@prisma/client';
import type { Donor } from '@prisma/client';
import { DonorService } from '../donor.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  AlreadyActiveException,
  AlreadyInactiveException,
  DuplicateCodeException,
  EntityNotFoundException,
} from '../../../common/exceptions/business.exception';
import { ErrorCode } from '../../../common/exceptions/error-codes';
import type { CreateDonorDto } from '../dto/create-donor.dto';
import type { UpdateDonorDto } from '../dto/update-donor.dto';
import type { DonorQueryDto } from '../dto/donor-query.dto';

/**
 * Tests unitaires du DonorService (mock complet du PrismaService).
 *
 * Couverture :
 *  - findMany : pagination, filtre actif/inactif/includeInactive,
 *    filtre type/country, search q (OR ILIKE), sort
 *  - findOne / findByCode : 200 + grantCount, 404
 *  - create : 200, mapping P2002 → DuplicateCodeException
 *  - replace (PUT) : 200, 404, P2002 → conflict
 *  - update (PATCH) : 200, 404, P2002 → conflict
 *  - softDelete : 204, 404, idempotent (ALREADY_INACTIVE)
 *  - restore : 200, 404, idempotent (ALREADY_ACTIVE)
 *  - buildWhere : helper statique pure (cas frontière)
 */
describe('DonorService', () => {
  let prisma: {
    donor: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let svc: DonorService;

  const fakeDonor: Donor = {
    id: '11111111-1111-1111-1111-111111111111',
    code: 'BMGF',
    label: 'Bill & Melinda Gates Foundation',
    type: 'private_foundation',
    country: 'USA',
    contactEmail: null,
    reportingTemplateId: null,
    isActive: true,
    createdAt: new Date('2026-05-01T00:00:00Z'),
    updatedAt: new Date('2026-05-01T00:00:00Z'),
  };

  function baseQuery(overrides: Partial<DonorQueryDto> = {}): DonorQueryDto {
    return {
      page: 1,
      pageSize: 20,
      sort: 'label',
      order: 'asc',
      ...overrides,
    } as DonorQueryDto;
  }

  beforeEach(() => {
    prisma = {
      donor: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    // $transaction reçoit un tableau et résout dans l'ordre.
    prisma.$transaction.mockImplementation((ops: unknown[]) => Promise.all(ops));
    svc = new DonorService(prisma as unknown as PrismaService);
  });

  // ------------------------------------------------------------------
  describe('findMany', () => {
    it('paginates with default page=1 pageSize=20 sort=label asc, hides inactive by default', async () => {
      prisma.donor.findMany.mockResolvedValue([fakeDonor]);
      prisma.donor.count.mockResolvedValue(1);

      const res = await svc.findMany(baseQuery());

      expect(res).toEqual({
        data: [fakeDonor],
        total: 1,
        page: 1,
        pageSize: 20,
        hasMore: false,
      });
      const args = prisma.donor.findMany.mock.calls[0][0];
      expect(args).toMatchObject({
        where: { isActive: true },
        orderBy: { label: 'asc' },
        skip: 0,
        take: 20,
      });
    });

    it('computes hasMore=true when total exceeds current page window', async () => {
      prisma.donor.findMany.mockResolvedValue(Array(20).fill(fakeDonor));
      prisma.donor.count.mockResolvedValue(45);
      const res = await svc.findMany(baseQuery({ page: 1, pageSize: 20 }));
      expect(res.hasMore).toBe(true);
      expect(res.total).toBe(45);
    });

    it('skip = (page-1) * pageSize', async () => {
      prisma.donor.findMany.mockResolvedValue([]);
      prisma.donor.count.mockResolvedValue(0);
      await svc.findMany(baseQuery({ page: 3, pageSize: 10 }));
      expect(prisma.donor.findMany.mock.calls[0][0].skip).toBe(20);
      expect(prisma.donor.findMany.mock.calls[0][0].take).toBe(10);
    });

    it('filters by type/country when provided', async () => {
      prisma.donor.findMany.mockResolvedValue([]);
      prisma.donor.count.mockResolvedValue(0);
      await svc.findMany(baseQuery({ type: 'public_intl', country: 'EU' }));
      expect(prisma.donor.findMany.mock.calls[0][0].where).toMatchObject({
        type: 'public_intl',
        country: 'EU',
        isActive: true,
      });
    });

    it('exposes inactive when includeInactive=true (no isActive filter)', async () => {
      prisma.donor.findMany.mockResolvedValue([]);
      prisma.donor.count.mockResolvedValue(0);
      await svc.findMany(baseQuery({ includeInactive: true }));
      expect(prisma.donor.findMany.mock.calls[0][0].where).not.toHaveProperty('isActive');
    });

    it('returns ONLY inactive when isActive=false', async () => {
      prisma.donor.findMany.mockResolvedValue([]);
      prisma.donor.count.mockResolvedValue(0);
      await svc.findMany(baseQuery({ isActive: false }));
      expect(prisma.donor.findMany.mock.calls[0][0].where.isActive).toBe(false);
    });

    it('builds case-insensitive OR clause for `q` over code/label/country', async () => {
      prisma.donor.findMany.mockResolvedValue([]);
      prisma.donor.count.mockResolvedValue(0);
      await svc.findMany(baseQuery({ q: 'gates' }));
      const where = prisma.donor.findMany.mock.calls[0][0].where;
      expect(where.OR).toEqual([
        { code: { contains: 'gates', mode: 'insensitive' } },
        { label: { contains: 'gates', mode: 'insensitive' } },
        { country: { contains: 'gates', mode: 'insensitive' } },
      ]);
    });

    it('respects sort field + order', async () => {
      prisma.donor.findMany.mockResolvedValue([]);
      prisma.donor.count.mockResolvedValue(0);
      await svc.findMany(baseQuery({ sort: 'createdAt', order: 'desc' }));
      expect(prisma.donor.findMany.mock.calls[0][0].orderBy).toEqual({ createdAt: 'desc' });
    });
  });

  // ------------------------------------------------------------------
  describe('findOne / findByCode', () => {
    it('returns donor + grantCount when present', async () => {
      prisma.donor.findUnique.mockResolvedValue({ ...fakeDonor, _count: { grants: 3 } });
      const res = await svc.findOne(fakeDonor.id);
      expect(res.grantCount).toBe(3);
      expect(res.id).toBe(fakeDonor.id);
      expect(res).not.toHaveProperty('_count');
    });

    it('findOne throws EntityNotFoundException on 404 with code BUSINESS.NOT_FOUND', async () => {
      prisma.donor.findUnique.mockResolvedValue(null);
      const action = svc.findOne('00000000-0000-0000-0000-000000000000');
      await expect(action).rejects.toBeInstanceOf(EntityNotFoundException);
      await expect(action).rejects.toMatchObject({ code: ErrorCode.BUSINESS.NOT_FOUND });
    });

    it('findByCode looks up by code, returns grantCount, 404 if missing', async () => {
      prisma.donor.findUnique.mockResolvedValueOnce({ ...fakeDonor, _count: { grants: 5 } });
      const res = await svc.findByCode('BMGF');
      expect(prisma.donor.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { code: 'BMGF' } }),
      );
      expect(res.grantCount).toBe(5);

      prisma.donor.findUnique.mockResolvedValueOnce(null);
      await expect(svc.findByCode('NOPE')).rejects.toBeInstanceOf(EntityNotFoundException);
    });
  });

  // ------------------------------------------------------------------
  describe('create', () => {
    const dto: CreateDonorDto = {
      code: 'NEW',
      label: 'New Donor',
      type: 'public_intl',
    } as CreateDonorDto;

    it('persists and returns the new donor', async () => {
      prisma.donor.create.mockResolvedValue(fakeDonor);
      const res = await svc.create(dto);
      expect(res).toBe(fakeDonor);
      expect(prisma.donor.create).toHaveBeenCalledWith({ data: dto });
    });

    it('maps P2002 → DuplicateCodeException (409 BUSINESS.DUPLICATE_CODE)', async () => {
      const prismaErr = new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: 'x',
      });
      prisma.donor.create.mockRejectedValue(prismaErr);
      const action = svc.create(dto);
      await expect(action).rejects.toBeInstanceOf(DuplicateCodeException);
      await expect(action).rejects.toMatchObject({ code: ErrorCode.BUSINESS.DUPLICATE_CODE });
    });
  });

  // ------------------------------------------------------------------
  describe('replace (PUT)', () => {
    const dto: CreateDonorDto = {
      code: 'BMGF',
      label: 'Bill & Melinda Gates Foundation',
      type: 'private_foundation',
    } as CreateDonorDto;

    it('updates an existing donor and nulls out absent optional fields', async () => {
      prisma.donor.findUnique.mockResolvedValue(fakeDonor);
      prisma.donor.update.mockResolvedValue(fakeDonor);

      await svc.replace(fakeDonor.id, dto);

      expect(prisma.donor.update).toHaveBeenCalledWith({
        where: { id: fakeDonor.id },
        data: {
          code: 'BMGF',
          label: 'Bill & Melinda Gates Foundation',
          type: 'private_foundation',
          country: null,
          contactEmail: null,
          reportingTemplateId: null,
        },
      });
    });

    it('throws EntityNotFoundException when target id is unknown', async () => {
      prisma.donor.findUnique.mockResolvedValue(null);
      await expect(svc.replace('xxx', dto)).rejects.toBeInstanceOf(EntityNotFoundException);
    });

    it('maps P2002 → DuplicateCodeException when new code conflicts', async () => {
      prisma.donor.findUnique.mockResolvedValue(fakeDonor);
      prisma.donor.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'x' }),
      );
      await expect(svc.replace(fakeDonor.id, dto)).rejects.toBeInstanceOf(DuplicateCodeException);
    });
  });

  // ------------------------------------------------------------------
  describe('update (PATCH)', () => {
    it('only sends provided fields to Prisma', async () => {
      prisma.donor.findUnique.mockResolvedValue(fakeDonor);
      prisma.donor.update.mockResolvedValue(fakeDonor);

      const dto: UpdateDonorDto = { label: 'New label' } as UpdateDonorDto;
      await svc.update(fakeDonor.id, dto);

      expect(prisma.donor.update).toHaveBeenCalledWith({
        where: { id: fakeDonor.id },
        data: { label: 'New label' },
      });
    });

    it('404 when id unknown', async () => {
      prisma.donor.findUnique.mockResolvedValue(null);
      await expect(svc.update('xxx', {} as UpdateDonorDto)).rejects.toBeInstanceOf(
        EntityNotFoundException,
      );
    });

    it('maps P2002 → DuplicateCodeException on code conflict', async () => {
      prisma.donor.findUnique.mockResolvedValue(fakeDonor);
      prisma.donor.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'x' }),
      );
      await expect(
        svc.update(fakeDonor.id, { code: 'OTHER' } as UpdateDonorDto),
      ).rejects.toBeInstanceOf(DuplicateCodeException);
    });
  });

  // ------------------------------------------------------------------
  describe('softDelete', () => {
    it('flips isActive to false on an active donor', async () => {
      prisma.donor.findUnique.mockResolvedValue({ ...fakeDonor, isActive: true });
      prisma.donor.update.mockResolvedValue({ ...fakeDonor, isActive: false });

      await svc.softDelete(fakeDonor.id);

      expect(prisma.donor.update).toHaveBeenCalledWith({
        where: { id: fakeDonor.id },
        data: { isActive: false },
      });
    });

    it('throws AlreadyInactiveException when called twice (idempotent guard)', async () => {
      prisma.donor.findUnique.mockResolvedValue({ ...fakeDonor, isActive: false });
      const action = svc.softDelete(fakeDonor.id);
      await expect(action).rejects.toBeInstanceOf(AlreadyInactiveException);
      await expect(action).rejects.toMatchObject({ code: ErrorCode.BUSINESS.ALREADY_INACTIVE });
    });

    it('404 when id unknown', async () => {
      prisma.donor.findUnique.mockResolvedValue(null);
      await expect(svc.softDelete('xxx')).rejects.toBeInstanceOf(EntityNotFoundException);
    });
  });

  // ------------------------------------------------------------------
  describe('restore', () => {
    it('flips isActive to true on an inactive donor', async () => {
      prisma.donor.findUnique.mockResolvedValue({ ...fakeDonor, isActive: false });
      prisma.donor.update.mockResolvedValue({ ...fakeDonor, isActive: true });

      await svc.restore(fakeDonor.id);

      expect(prisma.donor.update).toHaveBeenCalledWith({
        where: { id: fakeDonor.id },
        data: { isActive: true },
      });
    });

    it('throws AlreadyActiveException when called on an already-active donor', async () => {
      prisma.donor.findUnique.mockResolvedValue({ ...fakeDonor, isActive: true });
      const action = svc.restore(fakeDonor.id);
      await expect(action).rejects.toBeInstanceOf(AlreadyActiveException);
      await expect(action).rejects.toMatchObject({ code: ErrorCode.BUSINESS.ALREADY_ACTIVE });
    });

    it('404 when id unknown', async () => {
      prisma.donor.findUnique.mockResolvedValue(null);
      await expect(svc.restore('xxx')).rejects.toBeInstanceOf(EntityNotFoundException);
    });
  });

  // ------------------------------------------------------------------
  describe('buildWhere (static helper)', () => {
    it('default: isActive=true only', () => {
      expect(DonorService.buildWhere(baseQuery())).toEqual({ isActive: true });
    });
    it('includeInactive=true wins over isActive', () => {
      expect(DonorService.buildWhere(baseQuery({ includeInactive: true, isActive: false }))).toEqual(
        {},
      );
    });
    it('isActive=false alone', () => {
      expect(DonorService.buildWhere(baseQuery({ isActive: false }))).toEqual({ isActive: false });
    });
    it('combines type + country + q', () => {
      const where = DonorService.buildWhere(
        baseQuery({ type: 'public_intl', country: 'EU', q: 'foo' }),
      );
      expect(where).toMatchObject({ type: 'public_intl', country: 'EU', isActive: true });
      expect(where.OR).toHaveLength(3);
    });
  });
});

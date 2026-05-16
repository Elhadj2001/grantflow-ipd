import { Prisma } from '@prisma/client';
import type { GlAccount } from '@prisma/client';
import { GlAccountService } from '../gl-account.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  AlreadyActiveException,
  AlreadyInactiveException,
  DuplicateCodeException,
  EntityNotFoundException,
  GlAccountHasChildrenException,
  GlAccountHasEntriesException,
  InvalidClassPrefixException,
  InvalidGlAccountException,
} from '../../../common/exceptions/business.exception';
import type { CreateGlAccountDto } from '../dto/create-gl-account.dto';
import type { GlAccountQueryDto } from '../dto/gl-account-query.dto';

describe('GlAccountService', () => {
  let prisma: {
    glAccount: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    journalLine: { count: jest.Mock };
    $transaction: jest.Mock;
  };
  let svc: GlAccountService;

  const root: GlAccount = {
    id: 'r0000000-0000-0000-0000-000000000000',
    code: '601',
    label: 'Achats stockés',
    class: '6',
    parentCode: null,
    isMovement: false,
    isActive: true,
    syscebnlSpecific: false,
    description: null,
  };
  const child: GlAccount = {
    id: 'c0000000-0000-0000-0000-000000000000',
    code: '6011',
    label: 'Achats matières premières',
    class: '6',
    parentCode: '601',
    isMovement: true,
    isActive: true,
    syscebnlSpecific: false,
    description: null,
  };

  function dto(o: Partial<CreateGlAccountDto> = {}): CreateGlAccountDto {
    return {
      code: '6011',
      label: 'Achats matières premières',
      class: '6',
      isMovement: true,
      syscebnlSpecific: false,
      ...o,
    } as CreateGlAccountDto;
  }

  function baseQuery(o: Partial<GlAccountQueryDto> = {}): GlAccountQueryDto {
    return { page: 1, pageSize: 100, ...o } as GlAccountQueryDto;
  }

  beforeEach(() => {
    prisma = {
      glAccount: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      journalLine: { count: jest.fn().mockResolvedValue(0) },
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
    };
    svc = new GlAccountService(prisma as unknown as PrismaService);
  });

  describe('findMany — flat / tree', () => {
    it('flat paginates with class+code ordering', async () => {
      prisma.glAccount.findMany.mockResolvedValue([root, child]);
      prisma.glAccount.count.mockResolvedValue(2);
      const res = await svc.findMany(baseQuery());
      if (Array.isArray(res)) throw new Error('expected paginated');
      expect(res.total).toBe(2);
      const args = prisma.glAccount.findMany.mock.calls[0][0];
      expect(args.orderBy).toEqual([{ class: 'asc' }, { code: 'asc' }]);
    });

    it('tree assembles parent/child by parentCode', async () => {
      prisma.glAccount.findMany.mockResolvedValue([root, child]);
      const res = await svc.findMany(baseQuery({ asTree: true }));
      if (!Array.isArray(res)) throw new Error('expected tree');
      expect(res).toHaveLength(1);
      expect(res[0].code).toBe('601');
      expect(res[0].children[0].code).toBe('6011');
    });
  });

  describe('create — class prefix + parent validation', () => {
    it("rejects code that doesn't start with class", async () => {
      await expect(svc.create(dto({ code: '6011', class: '5' }))).rejects.toBeInstanceOf(
        InvalidClassPrefixException,
      );
    });

    it('rejects unknown parent', async () => {
      prisma.glAccount.findUnique.mockResolvedValue(null);
      await expect(svc.create(dto({ parentCode: '601' }))).rejects.toBeInstanceOf(
        InvalidGlAccountException,
      );
    });

    it('rejects parent of different class', async () => {
      prisma.glAccount.findUnique.mockResolvedValue({ ...root, class: '5' });
      await expect(svc.create(dto({ parentCode: '601' }))).rejects.toBeInstanceOf(
        InvalidClassPrefixException,
      );
    });

    it('creates when class prefix + parent class match', async () => {
      prisma.glAccount.findUnique.mockResolvedValue(root);
      prisma.glAccount.create.mockResolvedValue(child);
      const res = await svc.create(dto({ parentCode: '601' }));
      expect(res.code).toBe('6011');
    });

    it('maps P2002 to DuplicateCodeException', async () => {
      prisma.glAccount.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: '5' }),
      );
      await expect(svc.create(dto())).rejects.toBeInstanceOf(DuplicateCodeException);
    });
  });

  describe('softDelete — guards', () => {
    it('rejects when has children', async () => {
      prisma.glAccount.findUnique.mockResolvedValue(root);
      prisma.glAccount.count.mockResolvedValue(3);
      await expect(svc.softDelete(root.id)).rejects.toBeInstanceOf(GlAccountHasChildrenException);
    });

    it('rejects when has journal entries', async () => {
      prisma.glAccount.findUnique.mockResolvedValue(child);
      prisma.glAccount.count.mockResolvedValue(0);
      prisma.journalLine.count.mockResolvedValue(7);
      await expect(svc.softDelete(child.id)).rejects.toBeInstanceOf(GlAccountHasEntriesException);
    });

    it('succeeds when isolated', async () => {
      prisma.glAccount.findUnique.mockResolvedValue(child);
      prisma.glAccount.count.mockResolvedValue(0);
      prisma.glAccount.update.mockResolvedValue({ ...child, isActive: false });
      const res = await svc.softDelete(child.id);
      expect(res.isActive).toBe(false);
    });

    it('refuses when already inactive', async () => {
      prisma.glAccount.findUnique.mockResolvedValue({ ...child, isActive: false });
      await expect(svc.softDelete(child.id)).rejects.toBeInstanceOf(AlreadyInactiveException);
    });
  });

  describe('restore', () => {
    it('restores inactive → active', async () => {
      prisma.glAccount.findUnique.mockResolvedValue({ ...child, isActive: false });
      prisma.glAccount.update.mockResolvedValue(child);
      const res = await svc.restore(child.id);
      expect(res.isActive).toBe(true);
    });

    it('rejects already active', async () => {
      prisma.glAccount.findUnique.mockResolvedValue(child);
      await expect(svc.restore(child.id)).rejects.toBeInstanceOf(AlreadyActiveException);
    });
  });

  describe('update', () => {
    it('rejects class change that breaks code prefix', async () => {
      prisma.glAccount.findUnique.mockResolvedValue(child);
      await expect(svc.update(child.id, { class: '5' } as never)).rejects.toBeInstanceOf(
        InvalidClassPrefixException,
      );
    });

    it('throws 404 when id unknown', async () => {
      prisma.glAccount.findUnique.mockResolvedValue(null);
      await expect(svc.update('x', { label: 'Y' } as never)).rejects.toBeInstanceOf(
        EntityNotFoundException,
      );
    });
  });
});

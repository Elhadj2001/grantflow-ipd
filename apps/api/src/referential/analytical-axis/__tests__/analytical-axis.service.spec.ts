import { Prisma } from '@prisma/client';
import type { AnalyticalAxis } from '@prisma/client';
import { AnalyticalAxisService } from '../analytical-axis.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  AlreadyActiveException,
  AlreadyInactiveException,
  AxisCycleException,
  AxisHasChildrenException,
  AxisHasUsageException,
  AxisParentWrongTypeException,
  DuplicateCodeException,
  EntityNotFoundException,
} from '../../../common/exceptions/business.exception';
import type { CreateAnalyticalAxisDto } from '../dto/create-analytical-axis.dto';
import type { AnalyticalAxisQueryDto } from '../dto/analytical-axis-query.dto';

describe('AnalyticalAxisService', () => {
  let prisma: {
    analyticalAxis: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    purchaseRequest: { count: jest.Mock };
    journalLine: { count: jest.Mock };
    allocationTarget: { count: jest.Mock };
    $transaction: jest.Mock;
  };
  let svc: AnalyticalAxisService;

  const rootId = '11111111-1111-1111-1111-111111111111';
  const childId = '22222222-2222-2222-2222-222222222222';

  const root: AnalyticalAxis = {
    id: rootId,
    type: 'cost_center',
    code: 'LAB',
    label: 'Laboratoires',
    parentId: null,
    isActive: true,
    metadata: {} as Prisma.JsonValue,
  };

  const child: AnalyticalAxis = {
    id: childId,
    type: 'cost_center',
    code: 'LAB-VIRO',
    label: 'Virologie',
    parentId: rootId,
    isActive: true,
    metadata: {} as Prisma.JsonValue,
  };

  function dto(overrides: Partial<CreateAnalyticalAxisDto> = {}): CreateAnalyticalAxisDto {
    return {
      type: 'cost_center',
      code: 'NEW-AXIS',
      label: 'Some axis',
      ...overrides,
    } as CreateAnalyticalAxisDto;
  }

  function baseQuery(overrides: Partial<AnalyticalAxisQueryDto> = {}): AnalyticalAxisQueryDto {
    return {
      page: 1,
      pageSize: 100,
      ...overrides,
    } as AnalyticalAxisQueryDto;
  }

  beforeEach(() => {
    prisma = {
      analyticalAxis: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      purchaseRequest: { count: jest.fn().mockResolvedValue(0) },
      journalLine: { count: jest.fn().mockResolvedValue(0) },
      allocationTarget: { count: jest.fn().mockResolvedValue(0) },
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
    };
    svc = new AnalyticalAxisService(prisma as unknown as PrismaService);
  });

  // ------------------------------------------------------------------
  describe('findMany — flat', () => {
    it('paginates default, hides inactive', async () => {
      prisma.analyticalAxis.findMany.mockResolvedValue([root]);
      prisma.analyticalAxis.count.mockResolvedValue(1);
      const res = await svc.findMany(baseQuery());
      if (Array.isArray(res)) throw new Error('expected paginated, got tree');
      expect(res.total).toBe(1);
      const args = prisma.analyticalAxis.findMany.mock.calls[0][0];
      expect(args.where).toMatchObject({ isActive: true });
    });

    it('filters by type', async () => {
      prisma.analyticalAxis.findMany.mockResolvedValue([]);
      prisma.analyticalAxis.count.mockResolvedValue(0);
      await svc.findMany(baseQuery({ type: 'cost_center' }));
      const args = prisma.analyticalAxis.findMany.mock.calls[0][0];
      expect(args.where.type).toBe('cost_center');
    });

    it("parentId='null' filters root-level axes", async () => {
      prisma.analyticalAxis.findMany.mockResolvedValue([root]);
      prisma.analyticalAxis.count.mockResolvedValue(1);
      await svc.findMany(baseQuery({ parentId: 'null' }));
      const args = prisma.analyticalAxis.findMany.mock.calls[0][0];
      expect(args.where.parentId).toBeNull();
    });

    it('builds OR clause for q', async () => {
      prisma.analyticalAxis.findMany.mockResolvedValue([]);
      prisma.analyticalAxis.count.mockResolvedValue(0);
      await svc.findMany(baseQuery({ q: 'viro' }));
      const args = prisma.analyticalAxis.findMany.mock.calls[0][0];
      expect(args.where.OR).toHaveLength(2);
    });
  });

  // ------------------------------------------------------------------
  describe('findMany — tree', () => {
    it('assembles flat list into a 2-level tree', async () => {
      prisma.analyticalAxis.findMany.mockResolvedValue([root, child]);
      const res = await svc.findMany(baseQuery({ asTree: true }));
      if (!Array.isArray(res)) throw new Error('expected tree, got paginated');
      expect(res).toHaveLength(1);
      expect(res[0].id).toBe(rootId);
      expect(res[0].children).toHaveLength(1);
      expect(res[0].children[0].id).toBe(childId);
    });

    it('orphans (parent missing from page) become roots', async () => {
      // child without root in the page → root array
      prisma.analyticalAxis.findMany.mockResolvedValue([child]);
      const res = await svc.findMany(baseQuery({ asTree: true }));
      if (!Array.isArray(res)) throw new Error('expected tree, got paginated');
      expect(res).toHaveLength(1);
      expect(res[0].id).toBe(childId);
    });
  });

  // ------------------------------------------------------------------
  describe('findOne', () => {
    it('returns axis with childCount and computed path', async () => {
      prisma.analyticalAxis.findUnique
        .mockResolvedValueOnce({ ...child, _count: { children: 0 } })
        // computePath traversal: child.parentId → root
        .mockResolvedValueOnce({ code: 'LAB', parentId: null });
      const res = await svc.findOne(childId);
      expect(res.path).toBe('LAB/LAB-VIRO');
      expect(res.childCount).toBe(0);
    });

    it('throws 404 when missing', async () => {
      prisma.analyticalAxis.findUnique.mockResolvedValue(null);
      await expect(svc.findOne(rootId)).rejects.toBeInstanceOf(EntityNotFoundException);
    });
  });

  // ------------------------------------------------------------------
  describe('create — parent validation', () => {
    it('creates without parent', async () => {
      prisma.analyticalAxis.create.mockResolvedValue(root);
      const res = await svc.create(dto({ code: 'LAB', label: 'Laboratoires' }));
      expect(res).toEqual(root);
    });

    it('rejects parent of different type', async () => {
      prisma.analyticalAxis.findUnique.mockResolvedValue({
        ...root,
        type: 'activity',
      });
      await expect(
        svc.create(dto({ parentId: rootId })),
      ).rejects.toBeInstanceOf(AxisParentWrongTypeException);
    });

    it('rejects when parent does not exist', async () => {
      prisma.analyticalAxis.findUnique.mockResolvedValue(null);
      await expect(
        svc.create(dto({ parentId: rootId })),
      ).rejects.toBeInstanceOf(EntityNotFoundException);
    });

    it('creates when parent valid', async () => {
      prisma.analyticalAxis.findUnique.mockResolvedValue(root);
      prisma.analyticalAxis.create.mockResolvedValue(child);
      const res = await svc.create(dto({ parentId: rootId }));
      expect(res).toEqual(child);
    });

    it('maps P2002 to DuplicateCodeException', async () => {
      prisma.analyticalAxis.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: '5' }),
      );
      await expect(svc.create(dto())).rejects.toBeInstanceOf(DuplicateCodeException);
    });
  });

  // ------------------------------------------------------------------
  describe('update — cycle prevention', () => {
    it('rejects auto-reference (parentId === id)', async () => {
      prisma.analyticalAxis.findUnique
        .mockResolvedValueOnce(root) // ensureExists
        .mockResolvedValueOnce(root); // assertParentValid lookup
      await expect(
        svc.update(rootId, { parentId: rootId } as never),
      ).rejects.toBeInstanceOf(AxisCycleException);
    });

    it('rejects indirect cycle (target axis is grandparent of new parent)', async () => {
      // Graph: root → child. We attempt to set root.parentId = child,
      // which would create the cycle root → child → root.
      prisma.analyticalAxis.findUnique
        .mockResolvedValueOnce(root) // ensureExists(rootId)
        .mockResolvedValueOnce(child) // assertParentValid loads parent=child
        .mockResolvedValueOnce({ parentId: rootId }); // child.parent traversal hits rootId
      await expect(
        svc.update(rootId, { parentId: childId } as never),
      ).rejects.toBeInstanceOf(AxisCycleException);
    });

    it('rejects type change when axis has children', async () => {
      prisma.analyticalAxis.findUnique.mockResolvedValue(root);
      prisma.analyticalAxis.count.mockResolvedValue(2);
      await expect(
        svc.update(rootId, { type: 'activity' } as never),
      ).rejects.toBeInstanceOf(AxisHasChildrenException);
    });
  });

  // ------------------------------------------------------------------
  describe('softDelete', () => {
    it('switches to inactive when no children and no usage', async () => {
      prisma.analyticalAxis.findUnique.mockResolvedValue(child);
      prisma.analyticalAxis.count.mockResolvedValue(0);
      prisma.analyticalAxis.update.mockResolvedValue({ ...child, isActive: false });
      const res = await svc.softDelete(childId);
      expect(res.isActive).toBe(false);
    });

    it('rejects when active children exist', async () => {
      prisma.analyticalAxis.findUnique.mockResolvedValue(root);
      prisma.analyticalAxis.count.mockResolvedValue(2);
      await expect(svc.softDelete(rootId)).rejects.toBeInstanceOf(AxisHasChildrenException);
    });

    it('rejects when used by purchase request as cost center', async () => {
      prisma.analyticalAxis.findUnique.mockResolvedValue(child);
      prisma.analyticalAxis.count.mockResolvedValue(0);
      prisma.purchaseRequest.count.mockResolvedValueOnce(3).mockResolvedValueOnce(0);
      await expect(svc.softDelete(childId)).rejects.toBeInstanceOf(AxisHasUsageException);
    });

    it('rejects when already inactive', async () => {
      prisma.analyticalAxis.findUnique.mockResolvedValue({ ...child, isActive: false });
      await expect(svc.softDelete(childId)).rejects.toBeInstanceOf(AlreadyInactiveException);
    });
  });

  // ------------------------------------------------------------------
  describe('restore', () => {
    it('orphans the axis when parent inactive', async () => {
      prisma.analyticalAxis.findUnique
        .mockResolvedValueOnce({ ...child, isActive: false })
        .mockResolvedValueOnce({ isActive: false }); // parent inactive
      prisma.analyticalAxis.update.mockResolvedValue({
        ...child,
        isActive: true,
        parentId: null,
      });
      const res = await svc.restore(childId);
      expect(res.isActive).toBe(true);
      expect(res.parentId).toBeNull();
    });

    it('keeps parent when it is active', async () => {
      prisma.analyticalAxis.findUnique
        .mockResolvedValueOnce({ ...child, isActive: false })
        .mockResolvedValueOnce({ isActive: true });
      prisma.analyticalAxis.update.mockResolvedValue({ ...child, isActive: true });
      const res = await svc.restore(childId);
      expect(res.parentId).toBe(rootId);
    });

    it('rejects when already active', async () => {
      prisma.analyticalAxis.findUnique.mockResolvedValue(child);
      await expect(svc.restore(childId)).rejects.toBeInstanceOf(AlreadyActiveException);
    });
  });

  // ------------------------------------------------------------------
  describe('buildWhere helper', () => {
    it('default includes isActive=true', () => {
      expect(AnalyticalAxisService.buildWhere(baseQuery())).toMatchObject({ isActive: true });
    });

    it('includeInactive=true removes isActive filter', () => {
      const w = AnalyticalAxisService.buildWhere(baseQuery({ includeInactive: true }));
      expect(w.isActive).toBeUndefined();
    });
  });
});

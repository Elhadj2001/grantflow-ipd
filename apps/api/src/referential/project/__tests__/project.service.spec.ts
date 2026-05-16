import { Prisma } from '@prisma/client';
import type { Project } from '@prisma/client';
import { ProjectService } from '../project.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  AlreadyActiveException,
  AlreadyInactiveException,
  DuplicateCodeException,
  EntityNotFoundException,
  InvalidDateRangeException,
  ProjectHasActiveGrantsException,
} from '../../../common/exceptions/business.exception';
import { ErrorCode } from '../../../common/exceptions/error-codes';
import type { CreateProjectDto } from '../dto/create-project.dto';
import type { UpdateProjectDto } from '../dto/update-project.dto';
import type { ProjectQueryDto } from '../dto/project-query.dto';

describe('ProjectService', () => {
  let prisma: {
    project: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    grantAgreement: { count: jest.Mock };
    $transaction: jest.Mock;
  };
  let svc: ProjectService;

  const baseProject: Project = {
    id: '11111111-1111-1111-1111-111111111111',
    code: 'MADIBA-VAC-2024',
    title: 'Madiba vaccine accelerator',
    programId: null,
    piUserId: null,
    startDate: new Date('2024-01-01T00:00:00Z'),
    endDate: new Date('2026-12-31T00:00:00Z'),
    status: 'active',
    description: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
  };

  function baseQuery(overrides: Partial<ProjectQueryDto> = {}): ProjectQueryDto {
    return {
      page: 1,
      pageSize: 20,
      sort: 'code',
      order: 'asc',
      ...overrides,
    } as ProjectQueryDto;
  }

  beforeEach(() => {
    prisma = {
      project: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      grantAgreement: { count: jest.fn() },
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
    };
    svc = new ProjectService(prisma as unknown as PrismaService);
  });

  // ------------------------------------------------------------------
  describe('findMany', () => {
    it('paginates with defaults and no status filter (returns all)', async () => {
      prisma.project.findMany.mockResolvedValue([baseProject]);
      prisma.project.count.mockResolvedValue(1);

      const res = await svc.findMany(baseQuery());

      expect(res).toEqual({
        data: [baseProject],
        total: 1,
        page: 1,
        pageSize: 20,
        hasMore: false,
      });
    });

    it('hasMore=true when results overflow page', async () => {
      prisma.project.findMany.mockResolvedValue(Array(20).fill(baseProject));
      prisma.project.count.mockResolvedValue(45);

      const res = await svc.findMany(baseQuery({ page: 1, pageSize: 20 }));
      expect(res.hasMore).toBe(true);
    });

    it('applies isActive=true ⇒ status=active', async () => {
      prisma.project.findMany.mockResolvedValue([]);
      prisma.project.count.mockResolvedValue(0);
      await svc.findMany(baseQuery({ isActive: true }));
      const args = prisma.project.findMany.mock.calls[0][0];
      expect(args.where).toMatchObject({ status: 'active' });
    });

    it('applies isActive=false ⇒ status<>active', async () => {
      prisma.project.findMany.mockResolvedValue([]);
      prisma.project.count.mockResolvedValue(0);
      await svc.findMany(baseQuery({ isActive: false }));
      const args = prisma.project.findMany.mock.calls[0][0];
      expect(args.where).toMatchObject({ status: { not: 'active' } });
    });

    it('search q applies OR ILIKE on code+title', async () => {
      prisma.project.findMany.mockResolvedValue([]);
      prisma.project.count.mockResolvedValue(0);
      await svc.findMany(baseQuery({ q: 'madiba' }));
      const args = prisma.project.findMany.mock.calls[0][0];
      expect(args.where.OR).toHaveLength(2);
    });

    it('filters by programId, piUserId, status independently', async () => {
      prisma.project.findMany.mockResolvedValue([]);
      prisma.project.count.mockResolvedValue(0);
      await svc.findMany(
        baseQuery({
          programId: '22222222-2222-2222-2222-222222222222',
          piUserId: '33333333-3333-3333-3333-333333333333',
          status: 'suspended',
        }),
      );
      const args = prisma.project.findMany.mock.calls[0][0];
      expect(args.where).toMatchObject({
        programId: '22222222-2222-2222-2222-222222222222',
        piUserId: '33333333-3333-3333-3333-333333333333',
        status: 'suspended',
      });
    });

    it('applies sort and order to orderBy', async () => {
      prisma.project.findMany.mockResolvedValue([]);
      prisma.project.count.mockResolvedValue(0);
      await svc.findMany(baseQuery({ sort: 'startDate', order: 'desc' }));
      const args = prisma.project.findMany.mock.calls[0][0];
      expect(args.orderBy).toEqual({ startDate: 'desc' });
    });
  });

  // ------------------------------------------------------------------
  describe('findOne / findByCode', () => {
    it('findOne returns project with grantCount', async () => {
      prisma.project.findUnique.mockResolvedValue({
        ...baseProject,
        _count: { grants: 3 },
      });
      const res = await svc.findOne(baseProject.id);
      expect(res.grantCount).toBe(3);
      expect(res.code).toBe(baseProject.code);
    });

    it('findOne throws EntityNotFoundException on 404', async () => {
      prisma.project.findUnique.mockResolvedValue(null);
      await expect(svc.findOne(baseProject.id)).rejects.toBeInstanceOf(EntityNotFoundException);
    });

    it('findByCode returns project with grantCount', async () => {
      prisma.project.findUnique.mockResolvedValue({
        ...baseProject,
        _count: { grants: 0 },
      });
      const res = await svc.findByCode('MADIBA-VAC-2024');
      expect(res.grantCount).toBe(0);
    });

    it('findByCode 404', async () => {
      prisma.project.findUnique.mockResolvedValue(null);
      await expect(svc.findByCode('NOPE')).rejects.toMatchObject({
        code: ErrorCode.BUSINESS.NOT_FOUND,
      });
    });
  });

  // ------------------------------------------------------------------
  describe('create', () => {
    const dto: CreateProjectDto = {
      code: 'NEW-CODE',
      title: 'Some new project',
      startDate: '2026-01-01',
      endDate: '2027-12-31',
      status: 'active',
    } as CreateProjectDto;

    it('maps dates and returns prisma result', async () => {
      prisma.project.create.mockResolvedValue(baseProject);
      const res = await svc.create(dto);
      expect(res).toEqual(baseProject);
      const data = prisma.project.create.mock.calls[0][0].data;
      expect(data.startDate).toEqual(new Date('2026-01-01'));
      expect(data.endDate).toEqual(new Date('2027-12-31'));
      expect(data.programId).toBeNull();
      expect(data.piUserId).toBeNull();
    });

    it('maps P2002 to DuplicateCodeException', async () => {
      prisma.project.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('unique violation', {
          code: 'P2002',
          clientVersion: '5.0.0',
        }),
      );
      await expect(svc.create(dto)).rejects.toBeInstanceOf(DuplicateCodeException);
    });
  });

  // ------------------------------------------------------------------
  describe('replace / update', () => {
    const createDto: CreateProjectDto = {
      code: 'NEW-CODE',
      title: 'Replaced project',
      startDate: '2026-01-01',
      status: 'active',
    } as CreateProjectDto;

    it('replace returns updated project', async () => {
      prisma.project.findUnique.mockResolvedValue(baseProject);
      prisma.project.update.mockResolvedValue({ ...baseProject, title: 'Replaced project' });
      const res = await svc.replace(baseProject.id, createDto);
      expect(res.title).toBe('Replaced project');
    });

    it('replace throws EntityNotFoundException when id unknown', async () => {
      prisma.project.findUnique.mockResolvedValue(null);
      await expect(svc.replace(baseProject.id, createDto)).rejects.toBeInstanceOf(
        EntityNotFoundException,
      );
    });

    it('update only sends provided fields', async () => {
      prisma.project.findUnique.mockResolvedValue(baseProject);
      prisma.project.update.mockResolvedValue({ ...baseProject, title: 'NewT' });
      const dto: UpdateProjectDto = { title: 'NewT' } as UpdateProjectDto;
      await svc.update(baseProject.id, dto);
      const args = prisma.project.update.mock.calls[0][0];
      expect(args.data).toEqual({ title: 'NewT' });
    });

    it('update rejects when endDate <= startDate (post-merge)', async () => {
      prisma.project.findUnique.mockResolvedValue(baseProject);
      const dto: UpdateProjectDto = { endDate: '2023-12-31' } as UpdateProjectDto;
      await expect(svc.update(baseProject.id, dto)).rejects.toBeInstanceOf(
        InvalidDateRangeException,
      );
    });

    it('update supports disconnect via null on programId/piUserId', async () => {
      prisma.project.findUnique.mockResolvedValue(baseProject);
      prisma.project.update.mockResolvedValue(baseProject);
      const dto: UpdateProjectDto = { programId: null, piUserId: null } as UpdateProjectDto;
      await svc.update(baseProject.id, dto);
      const args = prisma.project.update.mock.calls[0][0];
      expect(args.data.program).toEqual({ disconnect: true });
      expect(args.data.pi).toEqual({ disconnect: true });
    });
  });

  // ------------------------------------------------------------------
  describe('softDelete', () => {
    it('switches status to closed when no active grants', async () => {
      prisma.project.findUnique.mockResolvedValue(baseProject);
      prisma.grantAgreement.count.mockResolvedValue(0);
      prisma.project.update.mockResolvedValue({ ...baseProject, status: 'closed' });
      const res = await svc.softDelete(baseProject.id);
      expect(res.status).toBe('closed');
    });

    it('throws ProjectHasActiveGrantsException when grants are not closed', async () => {
      prisma.project.findUnique.mockResolvedValue(baseProject);
      prisma.grantAgreement.count.mockResolvedValue(2);
      await expect(svc.softDelete(baseProject.id)).rejects.toBeInstanceOf(
        ProjectHasActiveGrantsException,
      );
    });

    it('throws AlreadyInactiveException when project already closed', async () => {
      prisma.project.findUnique.mockResolvedValue({ ...baseProject, status: 'closed' });
      await expect(svc.softDelete(baseProject.id)).rejects.toBeInstanceOf(AlreadyInactiveException);
    });

    it('throws EntityNotFoundException when id unknown', async () => {
      prisma.project.findUnique.mockResolvedValue(null);
      await expect(svc.softDelete(baseProject.id)).rejects.toBeInstanceOf(EntityNotFoundException);
    });
  });

  // ------------------------------------------------------------------
  describe('restore', () => {
    it('restores status to active', async () => {
      prisma.project.findUnique.mockResolvedValue({ ...baseProject, status: 'closed' });
      prisma.project.update.mockResolvedValue({ ...baseProject, status: 'active' });
      const res = await svc.restore(baseProject.id);
      expect(res.status).toBe('active');
    });

    it('throws AlreadyActiveException when status != closed', async () => {
      prisma.project.findUnique.mockResolvedValue(baseProject);
      await expect(svc.restore(baseProject.id)).rejects.toBeInstanceOf(AlreadyActiveException);
    });

    it('throws EntityNotFoundException when id unknown', async () => {
      prisma.project.findUnique.mockResolvedValue(null);
      await expect(svc.restore(baseProject.id)).rejects.toBeInstanceOf(EntityNotFoundException);
    });
  });

  // ------------------------------------------------------------------
  describe('buildWhere', () => {
    it('returns empty object for default query', () => {
      expect(ProjectService.buildWhere(baseQuery())).toEqual({});
    });

    it('includes programId and piUserId when provided', () => {
      const w = ProjectService.buildWhere(
        baseQuery({ programId: 'p-1', piUserId: 'u-1' }),
      );
      expect(w.programId).toBe('p-1');
      expect(w.piUserId).toBe('u-1');
    });

    it('isActive=true overrides absence of status', () => {
      const w = ProjectService.buildWhere(baseQuery({ isActive: true }));
      expect(w.status).toBe('active');
    });

    it('q wraps OR clauses on code and title', () => {
      const w = ProjectService.buildWhere(baseQuery({ q: 'foo' }));
      expect(w.OR).toEqual([
        { code: { contains: 'foo', mode: 'insensitive' } },
        { title: { contains: 'foo', mode: 'insensitive' } },
      ]);
    });
  });
});

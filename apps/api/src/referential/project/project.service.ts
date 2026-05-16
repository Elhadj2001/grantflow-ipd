import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Project } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AlreadyActiveException,
  AlreadyInactiveException,
  DuplicateCodeException,
  EntityNotFoundException,
  InvalidDateRangeException,
  ProjectHasActiveGrantsException,
} from '../../common/exceptions/business.exception';
import type { CreateProjectDto } from './dto/create-project.dto';
import type { UpdateProjectDto } from './dto/update-project.dto';
import type { ProjectQueryDto } from './dto/project-query.dto';

const ENTITY_NAME = 'Project';
const PG_UNIQUE_VIOLATION = 'P2002';

/**
 * Sémantique soft-delete : `status='closed'` (cf. CLAUDE.md §2).
 * On NE supprime jamais physiquement un projet — la traçabilité des
 * imputations analytiques en dépend.
 */
const CLOSED_STATUS = 'closed';
const ACTIVE_STATUS = 'active';

export interface PaginatedProjects {
  data: Project[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface ProjectWithGrantCount extends Project {
  grantCount: number;
}

@Injectable()
export class ProjectService {
  private readonly logger = new Logger(ProjectService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ------------------------------------------------------------------
  // Read
  // ------------------------------------------------------------------

  async findMany(query: ProjectQueryDto): Promise<PaginatedProjects> {
    const where = ProjectService.buildWhere(query);
    const orderBy: Prisma.ProjectOrderByWithRelationInput = { [query.sort]: query.order };
    const skip = (query.page - 1) * query.pageSize;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.project.findMany({ where, orderBy, skip, take: query.pageSize }),
      this.prisma.project.count({ where }),
    ]);

    return {
      data,
      total,
      page: query.page,
      pageSize: query.pageSize,
      hasMore: skip + data.length < total,
    };
  }

  async findOne(id: string): Promise<ProjectWithGrantCount> {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: { _count: { select: { grants: true } } },
    });
    if (!project) throw new EntityNotFoundException(ENTITY_NAME, { id });

    const { _count, ...rest } = project;
    return { ...rest, grantCount: _count.grants };
  }

  async findByCode(code: string): Promise<ProjectWithGrantCount> {
    const project = await this.prisma.project.findUnique({
      where: { code },
      include: { _count: { select: { grants: true } } },
    });
    if (!project) throw new EntityNotFoundException(ENTITY_NAME, { code });

    const { _count, ...rest } = project;
    return { ...rest, grantCount: _count.grants };
  }

  // ------------------------------------------------------------------
  // Write
  // ------------------------------------------------------------------

  async create(dto: CreateProjectDto): Promise<Project> {
    try {
      return await this.prisma.project.create({
        data: {
          code: dto.code,
          title: dto.title,
          programId: dto.programId ?? null,
          piUserId: dto.piUserId ?? null,
          startDate: new Date(dto.startDate),
          endDate: dto.endDate ? new Date(dto.endDate) : null,
          status: dto.status,
          description: dto.description ?? null,
        },
      });
    } catch (e) {
      this.handlePrismaWriteError(e, dto.code);
    }
  }

  async replace(id: string, dto: CreateProjectDto): Promise<Project> {
    await this.ensureExists(id);
    try {
      return await this.prisma.project.update({
        where: { id },
        data: {
          code: dto.code,
          title: dto.title,
          programId: dto.programId ?? null,
          piUserId: dto.piUserId ?? null,
          startDate: new Date(dto.startDate),
          endDate: dto.endDate ? new Date(dto.endDate) : null,
          status: dto.status,
          description: dto.description ?? null,
        },
      });
    } catch (e) {
      this.handlePrismaWriteError(e, dto.code);
    }
  }

  async update(id: string, dto: UpdateProjectDto): Promise<Project> {
    const existing = await this.ensureExists(id);

    // Vérification de cohérence des dates si l'une des deux change.
    const nextStart = dto.startDate ? new Date(dto.startDate) : existing.startDate;
    const nextEnd = dto.endDate === undefined
      ? existing.endDate
      : dto.endDate === null
        ? null
        : new Date(dto.endDate);
    if (nextEnd && nextEnd <= nextStart) {
      throw new InvalidDateRangeException(
        nextStart.toISOString().slice(0, 10),
        nextEnd.toISOString().slice(0, 10),
      );
    }

    const data: Prisma.ProjectUpdateInput = {};
    if (dto.code !== undefined) data.code = dto.code;
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.programId !== undefined) {
      data.program = dto.programId === null
        ? { disconnect: true }
        : { connect: { id: dto.programId } };
    }
    if (dto.piUserId !== undefined) {
      data.pi = dto.piUserId === null
        ? { disconnect: true }
        : { connect: { id: dto.piUserId } };
    }
    if (dto.startDate !== undefined) data.startDate = new Date(dto.startDate);
    if (dto.endDate !== undefined) {
      data.endDate = dto.endDate === null ? null : new Date(dto.endDate);
    }
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.description !== undefined) data.description = dto.description;

    try {
      return await this.prisma.project.update({ where: { id }, data });
    } catch (e) {
      this.handlePrismaWriteError(e, dto.code ?? '(unchanged)');
    }
  }

  /**
   * Soft delete = `status='closed'`. On refuse si au moins un grant
   * lié est encore actif (`status` IN ('draft','active','suspended')).
   */
  async softDelete(id: string): Promise<Project> {
    const project = await this.ensureExists(id);
    if (project.status === CLOSED_STATUS) {
      throw new AlreadyInactiveException(ENTITY_NAME, id);
    }

    const activeGrantCount = await this.prisma.grantAgreement.count({
      where: { projectId: id, status: { not: 'closed' } },
    });
    if (activeGrantCount > 0) {
      throw new ProjectHasActiveGrantsException(id, activeGrantCount);
    }

    return this.prisma.project.update({
      where: { id },
      data: { status: CLOSED_STATUS },
    });
  }

  async restore(id: string): Promise<Project> {
    const project = await this.ensureExists(id);
    if (project.status !== CLOSED_STATUS) {
      throw new AlreadyActiveException(ENTITY_NAME, id);
    }
    return this.prisma.project.update({
      where: { id },
      data: { status: ACTIVE_STATUS },
    });
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  private async ensureExists(id: string): Promise<Project> {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) throw new EntityNotFoundException(ENTITY_NAME, { id });
    return project;
  }

  private handlePrismaWriteError(e: unknown, code: string): never {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === PG_UNIQUE_VIOLATION) {
      throw new DuplicateCodeException(ENTITY_NAME, code);
    }
    this.logger.error({ err: e, code }, 'project write error (rethrow)');
    throw e instanceof Error ? e : new Error(String(e));
  }

  static buildWhere(query: ProjectQueryDto): Prisma.ProjectWhereInput {
    const where: Prisma.ProjectWhereInput = {};

    if (query.programId) where.programId = query.programId;
    if (query.piUserId) where.piUserId = query.piUserId;
    if (query.status) where.status = query.status;

    // `isActive=true` ⇒ status='active' ; `isActive=false` ⇒ status<>'active'.
    if (typeof query.isActive === 'boolean') {
      where.status = query.isActive
        ? ACTIVE_STATUS
        : { not: ACTIVE_STATUS };
    }

    if (query.q) {
      const needle = query.q.trim();
      where.OR = [
        { code: { contains: needle, mode: 'insensitive' } },
        { title: { contains: needle, mode: 'insensitive' } },
      ];
    }

    return where;
  }
}

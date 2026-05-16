import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AnalyticalAxis } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AlreadyActiveException,
  AlreadyInactiveException,
  AxisCycleException,
  AxisHasChildrenException,
  AxisHasUsageException,
  AxisParentWrongTypeException,
  DuplicateCodeException,
  EntityNotFoundException,
} from '../../common/exceptions/business.exception';
import type { CreateAnalyticalAxisDto } from './dto/create-analytical-axis.dto';
import type { UpdateAnalyticalAxisDto } from './dto/update-analytical-axis.dto';
import type { AnalyticalAxisQueryDto } from './dto/analytical-axis-query.dto';

const ENTITY_NAME = 'AnalyticalAxis';
const PG_UNIQUE_VIOLATION = 'P2002';

export interface PaginatedAnalyticalAxes {
  data: AnalyticalAxis[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface AnalyticalAxisDetail extends AnalyticalAxis {
  childCount: number;
  path: string;
}

export interface AnalyticalAxisTreeNode extends AnalyticalAxis {
  children: AnalyticalAxisTreeNode[];
}

@Injectable()
export class AnalyticalAxisService {
  private readonly logger = new Logger(AnalyticalAxisService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ------------------------------------------------------------------
  // Read
  // ------------------------------------------------------------------

  /**
   * Si `asTree=true` : on retourne UN niveau racine avec ses enfants
   * (récursion en TS). Sinon : liste paginée plate, identique au pattern
   * Donor.
   */
  async findMany(
    query: AnalyticalAxisQueryDto,
  ): Promise<PaginatedAnalyticalAxes | AnalyticalAxisTreeNode[]> {
    if (query.asTree === true) {
      return this.buildTree(query);
    }
    return this.findManyFlat(query);
  }

  private async findManyFlat(query: AnalyticalAxisQueryDto): Promise<PaginatedAnalyticalAxes> {
    const where = AnalyticalAxisService.buildWhere(query);
    const skip = (query.page - 1) * query.pageSize;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.analyticalAxis.findMany({
        where,
        orderBy: [{ type: 'asc' }, { code: 'asc' }],
        skip,
        take: query.pageSize,
      }),
      this.prisma.analyticalAxis.count({ where }),
    ]);

    return {
      data,
      total,
      page: query.page,
      pageSize: query.pageSize,
      hasMore: skip + data.length < total,
    };
  }

  /**
   * Construction de l'arbre côté TS : on lit TOUS les axes filtrés en
   * une requête, on construit une Map id→node, puis on raccroche
   * chaque enfant à son parent. O(n).
   */
  private async buildTree(query: AnalyticalAxisQueryDto): Promise<AnalyticalAxisTreeNode[]> {
    const where = AnalyticalAxisService.buildWhere(query);
    const flat = await this.prisma.analyticalAxis.findMany({
      where,
      orderBy: [{ type: 'asc' }, { code: 'asc' }],
    });

    const byId = new Map<string, AnalyticalAxisTreeNode>();
    flat.forEach((a) => byId.set(a.id, { ...a, children: [] }));

    const roots: AnalyticalAxisTreeNode[] = [];
    flat.forEach((a) => {
      const node = byId.get(a.id);
      if (!node) return;
      if (a.parentId && byId.has(a.parentId)) {
        byId.get(a.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    });

    return roots;
  }

  async findOne(id: string): Promise<AnalyticalAxisDetail> {
    const axis = await this.prisma.analyticalAxis.findUnique({
      where: { id },
      include: { _count: { select: { children: { where: { isActive: true } } } } },
    });
    if (!axis) throw new EntityNotFoundException(ENTITY_NAME, { id });

    const path = await this.computePath(axis);
    const { _count, ...rest } = axis;
    return { ...rest, childCount: _count.children, path };
  }

  async findByCode(type: string, code: string): Promise<AnalyticalAxisDetail> {
    if (!this.isKnownType(type)) {
      throw new EntityNotFoundException(ENTITY_NAME, { type, code });
    }
    const axis = await this.prisma.analyticalAxis.findUnique({
      where: { type_code: { type: type as Prisma.AnalyticalAxisWhereInput['type'] as never, code } },
      include: { _count: { select: { children: { where: { isActive: true } } } } },
    });
    if (!axis) throw new EntityNotFoundException(ENTITY_NAME, { type, code });

    const path = await this.computePath(axis);
    const { _count, ...rest } = axis;
    return { ...rest, childCount: _count.children, path };
  }

  // ------------------------------------------------------------------
  // Write
  // ------------------------------------------------------------------

  async create(dto: CreateAnalyticalAxisDto): Promise<AnalyticalAxis> {
    if (dto.parentId) {
      await this.assertParentValid(dto.parentId, dto.type);
    }
    try {
      return await this.prisma.analyticalAxis.create({
        data: {
          type: dto.type,
          code: dto.code,
          label: dto.label,
          parentId: dto.parentId ?? null,
          metadata: (dto.metadata ?? {}) as Prisma.InputJsonValue,
        },
      });
    } catch (e) {
      this.handlePrismaWriteError(e, dto.code);
    }
  }

  async replace(id: string, dto: CreateAnalyticalAxisDto): Promise<AnalyticalAxis> {
    const existing = await this.ensureExists(id);
    if (dto.parentId) {
      await this.assertParentValid(dto.parentId, dto.type, id);
    }
    if (dto.type !== existing.type) {
      await this.assertNoChildren(id, 'type change');
    }
    try {
      return await this.prisma.analyticalAxis.update({
        where: { id },
        data: {
          type: dto.type,
          code: dto.code,
          label: dto.label,
          parentId: dto.parentId ?? null,
          metadata: (dto.metadata ?? {}) as Prisma.InputJsonValue,
        },
      });
    } catch (e) {
      this.handlePrismaWriteError(e, dto.code);
    }
  }

  async update(id: string, dto: UpdateAnalyticalAxisDto): Promise<AnalyticalAxis> {
    const existing = await this.ensureExists(id);

    if (dto.parentId !== undefined && dto.parentId !== null) {
      const nextType = dto.type ?? existing.type;
      await this.assertParentValid(dto.parentId, nextType, id);
    }
    if (dto.type !== undefined && dto.type !== existing.type) {
      await this.assertNoChildren(id, 'type change');
    }

    const data: Prisma.AnalyticalAxisUpdateInput = {};
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.code !== undefined) data.code = dto.code;
    if (dto.label !== undefined) data.label = dto.label;
    if (dto.parentId !== undefined) {
      data.parent = dto.parentId === null
        ? { disconnect: true }
        : { connect: { id: dto.parentId } };
    }
    if (dto.metadata !== undefined) {
      data.metadata = (dto.metadata ?? {}) as Prisma.InputJsonValue;
    }

    try {
      return await this.prisma.analyticalAxis.update({ where: { id }, data });
    } catch (e) {
      this.handlePrismaWriteError(e, dto.code ?? existing.code);
    }
  }

  async softDelete(id: string): Promise<AnalyticalAxis> {
    const axis = await this.ensureExists(id);
    if (!axis.isActive) throw new AlreadyInactiveException(ENTITY_NAME, id);

    // Garde-fou 1 : enfants actifs.
    const activeChildCount = await this.prisma.analyticalAxis.count({
      where: { parentId: id, isActive: true },
    });
    if (activeChildCount > 0) {
      throw new AxisHasChildrenException(id, activeChildCount);
    }

    // Garde-fou 2 : références en aval (PR, BC, écritures).
    await this.assertNoUsage(id);

    return this.prisma.analyticalAxis.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async restore(id: string): Promise<AnalyticalAxis> {
    const axis = await this.ensureExists(id);
    if (axis.isActive) throw new AlreadyActiveException(ENTITY_NAME, id);

    // Le parent doit toujours être actif sinon l'axe restauré orpheline
    // la hiérarchie ; on remonte parentId=null silencieusement.
    if (axis.parentId) {
      const parent = await this.prisma.analyticalAxis.findUnique({
        where: { id: axis.parentId },
        select: { isActive: true },
      });
      if (!parent || !parent.isActive) {
        return this.prisma.analyticalAxis.update({
          where: { id },
          data: { isActive: true, parentId: null },
        });
      }
    }

    return this.prisma.analyticalAxis.update({ where: { id }, data: { isActive: true } });
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  private async ensureExists(id: string): Promise<AnalyticalAxis> {
    const axis = await this.prisma.analyticalAxis.findUnique({ where: { id } });
    if (!axis) throw new EntityNotFoundException(ENTITY_NAME, { id });
    return axis;
  }

  /**
   * Vérifie qu'un parent est valide :
   *   - existe et est actif
   *   - du même type que l'axe
   *   - n'engendre pas de cycle (si on est en update : `axisIdBeingModified`).
   */
  private async assertParentValid(
    parentId: string,
    axisType: string,
    axisIdBeingModified?: string,
  ): Promise<void> {
    if (axisIdBeingModified && parentId === axisIdBeingModified) {
      throw new AxisCycleException(axisIdBeingModified, parentId);
    }

    const parent = await this.prisma.analyticalAxis.findUnique({ where: { id: parentId } });
    if (!parent) throw new EntityNotFoundException('AnalyticalAxis (parent)', { id: parentId });

    if (parent.type !== axisType) {
      throw new AxisParentWrongTypeException(axisType, parent.type);
    }

    // Cycle indirect : remonter la chaîne des ancêtres et vérifier
    // que `axisIdBeingModified` n'y figure pas.
    if (axisIdBeingModified) {
      let cursor: string | null = parent.parentId;
      const visited = new Set<string>([parent.id]);
      while (cursor) {
        if (cursor === axisIdBeingModified) {
          throw new AxisCycleException(axisIdBeingModified, parentId);
        }
        if (visited.has(cursor)) break; // safety net
        visited.add(cursor);
        const next: { parentId: string | null } | null = await this.prisma.analyticalAxis.findUnique({
          where: { id: cursor },
          select: { parentId: true },
        });
        cursor = next?.parentId ?? null;
      }
    }
  }

  private async assertNoChildren(id: string, reason: string): Promise<void> {
    const count = await this.prisma.analyticalAxis.count({
      where: { parentId: id, isActive: true },
    });
    if (count > 0) {
      this.logger.warn({ axisId: id, count, reason }, 'axis has active children — rejected');
      throw new AxisHasChildrenException(id, count);
    }
  }

  private async assertNoUsage(axisId: string): Promise<void> {
    const [prCostCenter, prActivity, jlCostCenter, jlActivity, allocTargets] = await Promise.all([
      this.prisma.purchaseRequest.count({ where: { costCenterId: axisId } }),
      this.prisma.purchaseRequest.count({ where: { activityId: axisId } }),
      this.prisma.journalLine.count({ where: { costCenterId: axisId } }),
      this.prisma.journalLine.count({ where: { activityId: axisId } }),
      this.prisma.allocationTarget.count({ where: { costCenterId: axisId } }),
    ]);

    const totalUsage = prCostCenter + prActivity + jlCostCenter + jlActivity + allocTargets;
    if (totalUsage > 0) {
      throw new AxisHasUsageException(axisId, {
        purchaseRequestsAsCostCenter: prCostCenter,
        purchaseRequestsAsActivity: prActivity,
        journalLinesAsCostCenter: jlCostCenter,
        journalLinesAsActivity: jlActivity,
        allocationTargets: allocTargets,
      });
    }
  }

  /**
   * Remonte la chaîne parent → racine et concatène les codes :
   * `LAB/LAB-VIRO/LAB-VIRO-EBOLA`. Bornée à 32 niveaux (safety).
   */
  private async computePath(axis: AnalyticalAxis): Promise<string> {
    const codes: string[] = [axis.code];
    let cursor: string | null = axis.parentId;
    const visited = new Set<string>([axis.id]);
    let depth = 0;

    while (cursor && depth < 32) {
      if (visited.has(cursor)) break;
      visited.add(cursor);
      const parent: { code: string; parentId: string | null } | null = await this.prisma.analyticalAxis.findUnique({
        where: { id: cursor },
        select: { code: true, parentId: true },
      });
      if (!parent) break;
      codes.unshift(parent.code);
      cursor = parent.parentId;
      depth += 1;
    }
    return codes.join('/');
  }

  private isKnownType(value: string): boolean {
    return ['project', 'donor', 'grant', 'program', 'cost_center', 'activity', 'geo'].includes(value);
  }

  private handlePrismaWriteError(e: unknown, code: string): never {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === PG_UNIQUE_VIOLATION) {
      throw new DuplicateCodeException(ENTITY_NAME, code);
    }
    this.logger.error({ err: e, code }, 'analytical-axis write error (rethrow)');
    throw e instanceof Error ? e : new Error(String(e));
  }

  static buildWhere(query: AnalyticalAxisQueryDto): Prisma.AnalyticalAxisWhereInput {
    const where: Prisma.AnalyticalAxisWhereInput = {};

    if (query.type) where.type = query.type;

    if (query.parentId === 'null') {
      where.parentId = null;
    } else if (typeof query.parentId === 'string') {
      where.parentId = query.parentId;
    }

    if (query.includeInactive === true) {
      // no-op
    } else if (typeof query.isActive === 'boolean') {
      where.isActive = query.isActive;
    } else {
      where.isActive = true;
    }

    if (query.q) {
      const needle = query.q.trim();
      where.OR = [
        { code: { contains: needle, mode: 'insensitive' } },
        { label: { contains: needle, mode: 'insensitive' } },
      ];
    }

    return where;
  }
}

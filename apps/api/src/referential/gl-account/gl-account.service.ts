import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { GlAccount } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AlreadyActiveException,
  AlreadyInactiveException,
  DuplicateCodeException,
  EntityNotFoundException,
  GlAccountHasChildrenException,
  GlAccountHasEntriesException,
  InvalidClassPrefixException,
  InvalidGlAccountException,
} from '../../common/exceptions/business.exception';
import type { CreateGlAccountDto } from './dto/create-gl-account.dto';
import type { UpdateGlAccountDto } from './dto/update-gl-account.dto';
import type { GlAccountQueryDto } from './dto/gl-account-query.dto';

const ENTITY_NAME = 'GlAccount';
const PG_UNIQUE_VIOLATION = 'P2002';

export interface PaginatedGlAccounts {
  data: GlAccount[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface GlAccountTreeNode extends GlAccount {
  children: GlAccountTreeNode[];
}

@Injectable()
export class GlAccountService {
  private readonly logger = new Logger(GlAccountService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ------------------------------------------------------------------
  // Read
  // ------------------------------------------------------------------

  async findMany(
    query: GlAccountQueryDto,
  ): Promise<PaginatedGlAccounts | GlAccountTreeNode[]> {
    if (query.asTree === true) {
      return this.buildTree(query);
    }
    return this.findManyFlat(query);
  }

  private async findManyFlat(query: GlAccountQueryDto): Promise<PaginatedGlAccounts> {
    const where = GlAccountService.buildWhere(query);
    const skip = (query.page - 1) * query.pageSize;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.glAccount.findMany({
        where,
        orderBy: [{ class: 'asc' }, { code: 'asc' }],
        skip,
        take: query.pageSize,
      }),
      this.prisma.glAccount.count({ where }),
    ]);

    return {
      data,
      total,
      page: query.page,
      pageSize: query.pageSize,
      hasMore: skip + data.length < total,
    };
  }

  private async buildTree(query: GlAccountQueryDto): Promise<GlAccountTreeNode[]> {
    const where = GlAccountService.buildWhere(query);
    const flat = await this.prisma.glAccount.findMany({
      where,
      orderBy: [{ class: 'asc' }, { code: 'asc' }],
    });

    const byCode = new Map<string, GlAccountTreeNode>();
    flat.forEach((a) => byCode.set(a.code, { ...a, children: [] }));

    const roots: GlAccountTreeNode[] = [];
    flat.forEach((a) => {
      const node = byCode.get(a.code);
      if (!node) return;
      if (a.parentCode && byCode.has(a.parentCode)) {
        byCode.get(a.parentCode)!.children.push(node);
      } else {
        roots.push(node);
      }
    });

    return roots;
  }

  async findOne(id: string): Promise<GlAccount> {
    const acc = await this.prisma.glAccount.findUnique({ where: { id } });
    if (!acc) throw new EntityNotFoundException(ENTITY_NAME, { id });
    return acc;
  }

  async findByCode(code: string): Promise<GlAccount> {
    const acc = await this.prisma.glAccount.findUnique({ where: { code } });
    if (!acc) throw new EntityNotFoundException(ENTITY_NAME, { code });
    return acc;
  }

  // ------------------------------------------------------------------
  // Write
  // ------------------------------------------------------------------

  async create(dto: CreateGlAccountDto): Promise<GlAccount> {
    if (!dto.code.startsWith(dto.class)) {
      throw new InvalidClassPrefixException(dto.code, dto.class);
    }
    if (dto.parentCode) {
      await this.assertParentValid(dto.parentCode, dto.class);
    }

    try {
      return await this.prisma.glAccount.create({
        data: {
          code: dto.code,
          label: dto.label,
          class: dto.class,
          parentCode: dto.parentCode ?? null,
          isMovement: dto.isMovement,
          syscebnlSpecific: dto.syscebnlSpecific,
          description: dto.description ?? null,
        },
      });
    } catch (e) {
      this.handlePrismaWriteError(e, dto.code);
    }
  }

  async update(id: string, dto: UpdateGlAccountDto): Promise<GlAccount> {
    const existing = await this.ensureExists(id);

    // Si on change la classe : code doit toujours commencer par la nouvelle.
    if (dto.class !== undefined && !existing.code.startsWith(dto.class)) {
      throw new InvalidClassPrefixException(existing.code, dto.class);
    }

    if (dto.parentCode !== undefined && dto.parentCode !== null) {
      const nextClass = dto.class ?? existing.class;
      await this.assertParentValid(dto.parentCode, nextClass);
    }

    const data: Prisma.GlAccountUpdateInput = {};
    if (dto.label !== undefined) data.label = dto.label;
    if (dto.class !== undefined) data.class = dto.class;
    if (dto.parentCode !== undefined) {
      data.parentCode = dto.parentCode;
    }
    if (dto.isMovement !== undefined) data.isMovement = dto.isMovement;
    if (dto.syscebnlSpecific !== undefined) data.syscebnlSpecific = dto.syscebnlSpecific;
    if (dto.description !== undefined) data.description = dto.description;

    return this.prisma.glAccount.update({ where: { id }, data });
  }

  async softDelete(id: string): Promise<GlAccount> {
    const acc = await this.ensureExists(id);
    if (!acc.isActive) throw new AlreadyInactiveException(ENTITY_NAME, id);

    // Garde-fou 1 : sous-comptes actifs.
    const childCount = await this.prisma.glAccount.count({
      where: { parentCode: acc.code, isActive: true },
    });
    if (childCount > 0) {
      throw new GlAccountHasChildrenException(acc.code, childCount);
    }

    // Garde-fou 2 : écritures comptables (journalLine) — sacro-saint.
    const jlCount = await this.prisma.journalLine.count({ where: { accountCode: acc.code } });
    if (jlCount > 0) {
      throw new GlAccountHasEntriesException(acc.code, jlCount);
    }

    return this.prisma.glAccount.update({ where: { id }, data: { isActive: false } });
  }

  async restore(id: string): Promise<GlAccount> {
    const acc = await this.ensureExists(id);
    if (acc.isActive) throw new AlreadyActiveException(ENTITY_NAME, id);
    return this.prisma.glAccount.update({ where: { id }, data: { isActive: true } });
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  private async ensureExists(id: string): Promise<GlAccount> {
    const acc = await this.prisma.glAccount.findUnique({ where: { id } });
    if (!acc) throw new EntityNotFoundException(ENTITY_NAME, { id });
    return acc;
  }

  /**
   * Vérifie qu'un parent existe, est actif, et appartient à la même
   * classe (sinon la balance générale agrégerait des classes mélangées).
   */
  private async assertParentValid(parentCode: string, childClass: string): Promise<void> {
    const parent = await this.prisma.glAccount.findUnique({ where: { code: parentCode } });
    if (!parent) throw new InvalidGlAccountException(parentCode);
    if (parent.class !== childClass) {
      throw new InvalidClassPrefixException(
        `parent.class="${parent.class}"`,
        childClass,
      );
    }
  }

  private handlePrismaWriteError(e: unknown, code: string): never {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === PG_UNIQUE_VIOLATION) {
      throw new DuplicateCodeException(ENTITY_NAME, code);
    }
    this.logger.error({ err: e, code }, 'gl-account write error (rethrow)');
    throw e instanceof Error ? e : new Error(String(e));
  }

  static buildWhere(query: GlAccountQueryDto): Prisma.GlAccountWhereInput {
    const where: Prisma.GlAccountWhereInput = {};

    if (query.class) where.class = query.class;
    if (typeof query.isMovement === 'boolean') where.isMovement = query.isMovement;
    if (typeof query.syscebnlSpecific === 'boolean') where.syscebnlSpecific = query.syscebnlSpecific;

    if (query.parentCode === 'null') {
      where.parentCode = null;
    } else if (typeof query.parentCode === 'string') {
      where.parentCode = query.parentCode;
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

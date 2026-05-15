import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Donor } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AlreadyActiveException,
  AlreadyInactiveException,
  DuplicateCodeException,
  EntityNotFoundException,
} from '../../common/exceptions/business.exception';
import type { CreateDonorDto } from './dto/create-donor.dto';
import type { UpdateDonorDto } from './dto/update-donor.dto';
import type { DonorQueryDto } from './dto/donor-query.dto';

const ENTITY_NAME = 'Donor';

/** Code Postgres pour `unique_violation`. */
const PG_UNIQUE_VIOLATION = 'P2002';

export interface PaginatedDonors {
  data: Donor[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface DonorWithGrantCount extends Donor {
  grantCount: number;
}

/**
 * CRUD bailleurs.
 *
 * Règles :
 *  - `code` unique côté DB → mapping `P2002` → `DuplicateCodeException` (409).
 *  - DELETE = soft delete (`isActive=false`), pas de purge.
 *  - GET liste filtre par défaut sur `isActive=true` (param `includeInactive=true`
 *    pour TOUT voir, `isActive=false` pour ne voir que les inactifs).
 *  - Search `q` : ILIKE sur code / label / country (pg_trgm peut accélérer
 *    plus tard — ILIKE %q% suffit au volume actuel).
 */
@Injectable()
export class DonorService {
  private readonly logger = new Logger(DonorService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ------------------------------------------------------------------
  // Read
  // ------------------------------------------------------------------

  async findMany(query: DonorQueryDto): Promise<PaginatedDonors> {
    const where = DonorService.buildWhere(query);
    const orderBy: Prisma.DonorOrderByWithRelationInput = { [query.sort]: query.order };
    const skip = (query.page - 1) * query.pageSize;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.donor.findMany({
        where,
        orderBy,
        skip,
        take: query.pageSize,
      }),
      this.prisma.donor.count({ where }),
    ]);

    return {
      data,
      total,
      page: query.page,
      pageSize: query.pageSize,
      hasMore: skip + data.length < total,
    };
  }

  async findOne(id: string): Promise<DonorWithGrantCount> {
    const donor = await this.prisma.donor.findUnique({
      where: { id },
      include: { _count: { select: { grants: true } } },
    });
    if (!donor) throw new EntityNotFoundException(ENTITY_NAME, { id });

    const { _count, ...rest } = donor;
    return { ...rest, grantCount: _count.grants };
  }

  async findByCode(code: string): Promise<DonorWithGrantCount> {
    const donor = await this.prisma.donor.findUnique({
      where: { code },
      include: { _count: { select: { grants: true } } },
    });
    if (!donor) throw new EntityNotFoundException(ENTITY_NAME, { code });

    const { _count, ...rest } = donor;
    return { ...rest, grantCount: _count.grants };
  }

  // ------------------------------------------------------------------
  // Write
  // ------------------------------------------------------------------

  async create(dto: CreateDonorDto): Promise<Donor> {
    try {
      return await this.prisma.donor.create({ data: dto });
    } catch (e) {
      this.handlePrismaWriteError(e, dto.code);
    }
  }

  /**
   * PUT — remplace tous les champs du Donor par le payload. Les champs
   * optionnels absents passent à `null`.
   */
  async replace(id: string, dto: CreateDonorDto): Promise<Donor> {
    await this.ensureExists(id);
    try {
      return await this.prisma.donor.update({
        where: { id },
        data: {
          code: dto.code,
          label: dto.label,
          type: dto.type,
          country: dto.country ?? null,
          contactEmail: dto.contactEmail ?? null,
          reportingTemplateId: dto.reportingTemplateId ?? null,
        },
      });
    } catch (e) {
      this.handlePrismaWriteError(e, dto.code);
    }
  }

  /** PATCH — ne touche que les champs fournis. */
  async update(id: string, dto: UpdateDonorDto): Promise<Donor> {
    await this.ensureExists(id);
    try {
      return await this.prisma.donor.update({ where: { id }, data: dto });
    } catch (e) {
      this.handlePrismaWriteError(e, dto.code ?? '(unchanged)');
    }
  }

  async softDelete(id: string): Promise<Donor> {
    const donor = await this.ensureExists(id);
    if (!donor.isActive) throw new AlreadyInactiveException(ENTITY_NAME, id);
    return this.prisma.donor.update({ where: { id }, data: { isActive: false } });
  }

  async restore(id: string): Promise<Donor> {
    const donor = await this.ensureExists(id);
    if (donor.isActive) throw new AlreadyActiveException(ENTITY_NAME, id);
    return this.prisma.donor.update({ where: { id }, data: { isActive: true } });
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  private async ensureExists(id: string): Promise<Donor> {
    const donor = await this.prisma.donor.findUnique({ where: { id } });
    if (!donor) throw new EntityNotFoundException(ENTITY_NAME, { id });
    return donor;
  }

  /**
   * Convertit les `PrismaClientKnownRequestError` côté écriture en
   * exceptions métier typées. Toujours `throw` — type retour `never`.
   */
  private handlePrismaWriteError(e: unknown, code: string): never {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === PG_UNIQUE_VIOLATION) {
      throw new DuplicateCodeException(ENTITY_NAME, code);
    }
    this.logger.error({ err: e, code }, 'donor write error (rethrow)');
    throw e instanceof Error ? e : new Error(String(e));
  }

  static buildWhere(query: DonorQueryDto): Prisma.DonorWhereInput {
    const where: Prisma.DonorWhereInput = {};

    if (query.type) where.type = query.type;
    if (query.country) where.country = query.country;

    // Filtre isActive — règles :
    //   - includeInactive=true  → pas de filtre du tout
    //   - isActive fourni       → exact match
    //   - sinon                 → isActive=true (défaut sécurisé)
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
        { country: { contains: needle, mode: 'insensitive' } },
      ];
    }

    return where;
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { TaxCode } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AlreadyActiveException,
  AlreadyInactiveException,
  DuplicateCodeException,
  EntityNotFoundException,
  InvalidGlAccountException,
  TaxCodeHasUsageException,
} from '../../common/exceptions/business.exception';
import type { CreateTaxCodeDto } from './dto/create-tax-code.dto';
import type { UpdateTaxCodeDto } from './dto/update-tax-code.dto';
import type { TaxCodeQueryDto } from './dto/tax-code-query.dto';

const ENTITY_NAME = 'TaxCode';
const PG_UNIQUE_VIOLATION = 'P2002';

export interface PaginatedTaxCodes {
  data: TaxCode[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

@Injectable()
export class TaxCodeService {
  private readonly logger = new Logger(TaxCodeService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ------------------------------------------------------------------
  // Read
  // ------------------------------------------------------------------

  async findMany(query: TaxCodeQueryDto): Promise<PaginatedTaxCodes> {
    const where = TaxCodeService.buildWhere(query);
    const orderBy: Prisma.TaxCodeOrderByWithRelationInput = { [query.sort]: query.order };
    const skip = (query.page - 1) * query.pageSize;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.taxCode.findMany({ where, orderBy, skip, take: query.pageSize }),
      this.prisma.taxCode.count({ where }),
    ]);

    return {
      data,
      total,
      page: query.page,
      pageSize: query.pageSize,
      hasMore: skip + data.length < total,
    };
  }

  async findOne(id: string): Promise<TaxCode> {
    const tax = await this.prisma.taxCode.findUnique({ where: { id } });
    if (!tax) throw new EntityNotFoundException(ENTITY_NAME, { id });
    return tax;
  }

  async findByCode(code: string): Promise<TaxCode> {
    const tax = await this.prisma.taxCode.findUnique({ where: { code } });
    if (!tax) throw new EntityNotFoundException(ENTITY_NAME, { code });
    return tax;
  }

  // ------------------------------------------------------------------
  // Write
  // ------------------------------------------------------------------

  async create(dto: CreateTaxCodeDto): Promise<TaxCode> {
    if (dto.accountCode) await this.assertGlAccountExists(dto.accountCode);
    try {
      return await this.prisma.taxCode.create({
        data: {
          code: dto.code,
          label: dto.label,
          rate: new Prisma.Decimal(dto.rate),
          accountCode: dto.accountCode ?? null,
        },
      });
    } catch (e) {
      this.handlePrismaWriteError(e, dto.code);
    }
  }

  async replace(id: string, dto: CreateTaxCodeDto): Promise<TaxCode> {
    await this.ensureExists(id);
    if (dto.accountCode) await this.assertGlAccountExists(dto.accountCode);
    try {
      return await this.prisma.taxCode.update({
        where: { id },
        data: {
          code: dto.code,
          label: dto.label,
          rate: new Prisma.Decimal(dto.rate),
          accountCode: dto.accountCode ?? null,
        },
      });
    } catch (e) {
      this.handlePrismaWriteError(e, dto.code);
    }
  }

  async update(id: string, dto: UpdateTaxCodeDto): Promise<TaxCode> {
    await this.ensureExists(id);
    if (dto.accountCode) await this.assertGlAccountExists(dto.accountCode);

    const data: Prisma.TaxCodeUpdateInput = {};
    if (dto.code !== undefined) data.code = dto.code;
    if (dto.label !== undefined) data.label = dto.label;
    if (dto.rate !== undefined) data.rate = new Prisma.Decimal(dto.rate);
    if (dto.accountCode !== undefined) {
      data.account = dto.accountCode === null
        ? { disconnect: true }
        : { connect: { code: dto.accountCode } };
    }

    try {
      return await this.prisma.taxCode.update({ where: { id }, data });
    } catch (e) {
      this.handlePrismaWriteError(e, dto.code ?? '(unchanged)');
    }
  }

  async softDelete(id: string): Promise<TaxCode> {
    const tax = await this.ensureExists(id);
    if (!tax.isActive) throw new AlreadyInactiveException(ENTITY_NAME, id);

    // On bloque la désactivation si le code TVA est référencé n'importe où
    // (BC, factures). Sans ça, les recalculs de TVA passeraient sur un
    // code archivé ou changé.
    const [poLines, invoiceLines] = await Promise.all([
      this.prisma.purchaseOrderLine.count({ where: { taxCodeId: id } }),
      this.prisma.invoiceLine.count({ where: { taxCodeId: id } }),
    ]);
    if (poLines + invoiceLines > 0) {
      throw new TaxCodeHasUsageException(id, {
        purchaseOrderLines: poLines,
        invoiceLines,
      });
    }

    return this.prisma.taxCode.update({ where: { id }, data: { isActive: false } });
  }

  async restore(id: string): Promise<TaxCode> {
    const tax = await this.ensureExists(id);
    if (tax.isActive) throw new AlreadyActiveException(ENTITY_NAME, id);
    return this.prisma.taxCode.update({ where: { id }, data: { isActive: true } });
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  private async ensureExists(id: string): Promise<TaxCode> {
    const tax = await this.prisma.taxCode.findUnique({ where: { id } });
    if (!tax) throw new EntityNotFoundException(ENTITY_NAME, { id });
    return tax;
  }

  private async assertGlAccountExists(code: string): Promise<void> {
    const acc = await this.prisma.glAccount.findUnique({
      where: { code },
      select: { code: true },
    });
    if (!acc) throw new InvalidGlAccountException(code);
  }

  private handlePrismaWriteError(e: unknown, code: string): never {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === PG_UNIQUE_VIOLATION) {
      throw new DuplicateCodeException(ENTITY_NAME, code);
    }
    this.logger.error({ err: e, code }, 'tax-code write error (rethrow)');
    throw e instanceof Error ? e : new Error(String(e));
  }

  static buildWhere(query: TaxCodeQueryDto): Prisma.TaxCodeWhereInput {
    const where: Prisma.TaxCodeWhereInput = {};

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

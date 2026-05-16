import { Injectable, Logger } from '@nestjs/common';
import { Prisma, PrStatus } from '@prisma/client';
import type { CashBox } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AlreadyActiveException,
  AlreadyInactiveException,
  DuplicateCodeException,
  EntityNotFoundException,
} from '../../common/exceptions/business.exception';
import type { CreateCashBoxDto } from './dto/create-cash-box.dto';
import type { UpdateCashBoxDto } from './dto/update-cash-box.dto';
import type { CashBoxQueryDto } from './dto/cash-box-query.dto';

const ENTITY_NAME = 'CashBox';
const PG_UNIQUE_VIOLATION = 'P2002';

/** Statuts cash actifs qui pèsent sur le compteur du jour. */
const ACTIVE_CASH_STATUSES: PrStatus[] = [
  PrStatus.draft,
  PrStatus.pending_pi,
  PrStatus.pending_cg,
  PrStatus.pending_daf,
  PrStatus.approved,
];

export interface PaginatedCashBoxes {
  data: CashBox[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface CashBoxWithCount extends CashBox {
  prCount: number;
}

export interface CashBoxBalance {
  cashBoxId: string;
  currency: string;
  currentBalance: number;
  ceiling: number;
  perRequestMax: number;
  perDayUserMax: number;
  todayConsumed: number;
}

/**
 * CRUD caisses + solde temps réel. Le décrément/crédit du solde est fait
 * dans `ApprovalWorkflowService` (à l'approbation / au settle) — ce service
 * ne fait que de la lecture/écriture de l'enveloppe.
 */
@Injectable()
export class CashBoxService {
  private readonly logger = new Logger(CashBoxService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ------------------------------------------------------------------
  // Read
  // ------------------------------------------------------------------

  async findMany(query: CashBoxQueryDto): Promise<PaginatedCashBoxes> {
    const where = CashBoxService.buildWhere(query);
    const orderBy: Prisma.CashBoxOrderByWithRelationInput = { [query.sort]: query.order };
    const skip = (query.page - 1) * query.pageSize;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.cashBox.findMany({ where, orderBy, skip, take: query.pageSize }),
      this.prisma.cashBox.count({ where }),
    ]);

    return {
      data,
      total,
      page: query.page,
      pageSize: query.pageSize,
      hasMore: skip + data.length < total,
    };
  }

  async findOne(id: string): Promise<CashBoxWithCount> {
    const cashBox = await this.prisma.cashBox.findUnique({
      where: { id },
      include: { _count: { select: { purchaseRequests: true } } },
    });
    if (!cashBox) throw new EntityNotFoundException(ENTITY_NAME, { id });
    const { _count, ...rest } = cashBox;
    return { ...rest, prCount: _count.purchaseRequests };
  }

  /**
   * Solde temps réel : `currentBalance` (déjà décrémenté à l'approbation)
   * + somme des DA cash de la journée (tous demandeurs confondus) pour
   * surveiller la consommation quotidienne.
   */
  async getBalance(id: string): Promise<CashBoxBalance> {
    const cashBox = await this.prisma.cashBox.findUnique({ where: { id } });
    if (!cashBox) throw new EntityNotFoundException(ENTITY_NAME, { id });

    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date();
    end.setUTCHours(23, 59, 59, 999);

    const agg = await this.prisma.purchaseRequest.aggregate({
      _sum: { totalAmount: true },
      where: {
        cashBoxId: id,
        requestType: { in: ['petty_cash', 'cash_advance'] },
        status: { in: ACTIVE_CASH_STATUSES },
        requestedAt: { gte: start, lte: end },
      },
    });

    return {
      cashBoxId: cashBox.id,
      currency: cashBox.currency,
      currentBalance: Number(cashBox.currentBalance),
      ceiling: Number(cashBox.ceiling),
      perRequestMax: Number(cashBox.perRequestMax),
      perDayUserMax: Number(cashBox.perDayUserMax),
      todayConsumed: Number(agg._sum?.totalAmount ?? 0),
    };
  }

  // ------------------------------------------------------------------
  // Write
  // ------------------------------------------------------------------

  async create(dto: CreateCashBoxDto): Promise<CashBox> {
    try {
      return await this.prisma.cashBox.create({ data: dto });
    } catch (e) {
      this.handlePrismaWriteError(e, dto.code);
    }
  }

  async replace(id: string, dto: CreateCashBoxDto): Promise<CashBox> {
    await this.ensureExists(id);
    try {
      return await this.prisma.cashBox.update({
        where: { id },
        data: {
          code: dto.code,
          label: dto.label,
          custodianUserId: dto.custodianUserId ?? null,
          currency: dto.currency,
          currentBalance: dto.currentBalance,
          ceiling: dto.ceiling,
          perRequestMax: dto.perRequestMax,
          perDayUserMax: dto.perDayUserMax,
        },
      });
    } catch (e) {
      this.handlePrismaWriteError(e, dto.code);
    }
  }

  async update(id: string, dto: UpdateCashBoxDto): Promise<CashBox> {
    await this.ensureExists(id);
    try {
      return await this.prisma.cashBox.update({ where: { id }, data: dto });
    } catch (e) {
      this.handlePrismaWriteError(e, dto.code ?? '(unchanged)');
    }
  }

  async softDelete(id: string): Promise<CashBox> {
    const cb = await this.ensureExists(id);
    if (!cb.isActive) throw new AlreadyInactiveException(ENTITY_NAME, id);
    return this.prisma.cashBox.update({ where: { id }, data: { isActive: false } });
  }

  async restore(id: string): Promise<CashBox> {
    const cb = await this.ensureExists(id);
    if (cb.isActive) throw new AlreadyActiveException(ENTITY_NAME, id);
    return this.prisma.cashBox.update({ where: { id }, data: { isActive: true } });
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  private async ensureExists(id: string): Promise<CashBox> {
    const cb = await this.prisma.cashBox.findUnique({ where: { id } });
    if (!cb) throw new EntityNotFoundException(ENTITY_NAME, { id });
    return cb;
  }

  private handlePrismaWriteError(e: unknown, code: string): never {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === PG_UNIQUE_VIOLATION) {
      throw new DuplicateCodeException(ENTITY_NAME, code);
    }
    this.logger.error({ err: e, code }, 'cash-box write error (rethrow)');
    throw e instanceof Error ? e : new Error(String(e));
  }

  static buildWhere(query: CashBoxQueryDto): Prisma.CashBoxWhereInput {
    const where: Prisma.CashBoxWhereInput = {};

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

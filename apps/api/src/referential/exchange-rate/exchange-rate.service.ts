import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ExchangeRate } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  EntityNotFoundException,
  ExchangeRateNotFoundException,
  FixedRateExistsException,
  ForbiddenRoleException,
  ImmutableFixedRateException,
  SameCurrencyException,
} from '../../common/exceptions/business.exception';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';
import type { Role } from '../../auth/types/roles';
import type { CreateExchangeRateDto } from './dto/create-exchange-rate.dto';
import type { UpdateExchangeRateDto } from './dto/update-exchange-rate.dto';
import type {
  ExchangeRateLookupDto,
  ExchangeRateQueryDto,
} from './dto/exchange-rate-query.dto';

const ENTITY_NAME = 'ExchangeRate';
const SUPER_ADMIN: Role = 'SUPER_ADMIN';

export interface PaginatedExchangeRates {
  data: ExchangeRate[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface ExchangeRateLookupResult extends ExchangeRate {
  /** True si on a dû remonter dans le temps faute de taux à la date exacte. */
  isFallback: boolean;
}

@Injectable()
export class ExchangeRateService {
  private readonly logger = new Logger(ExchangeRateService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ------------------------------------------------------------------
  // Read
  // ------------------------------------------------------------------

  async findMany(query: ExchangeRateQueryDto): Promise<PaginatedExchangeRates> {
    const where = ExchangeRateService.buildWhere(query);
    const skip = (query.page - 1) * query.pageSize;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.exchangeRate.findMany({
        where,
        orderBy: [{ rateDate: 'desc' }, { fromCurrency: 'asc' }],
        skip,
        take: query.pageSize,
      }),
      this.prisma.exchangeRate.count({ where }),
    ]);

    return {
      data,
      total,
      page: query.page,
      pageSize: query.pageSize,
      hasMore: skip + data.length < total,
    };
  }

  async findOne(id: string): Promise<ExchangeRate> {
    const rate = await this.prisma.exchangeRate.findUnique({ where: { id } });
    if (!rate) throw new EntityNotFoundException(ENTITY_NAME, { id });
    return rate;
  }

  /**
   * Lookup principal pour les calculs métiers (overhead XOF, conversions
   * de factures, etc.).
   *
   * Règles :
   *   1. Si une parité fixe `is_fixed=true` existe pour (from,to), on la
   *      retourne IMMÉDIATEMENT — la date passée en paramètre est ignorée
   *      car la parité ne dépend pas du temps (EUR↔XOF BCEAO).
   *   2. Sinon on cherche le taux le plus récent ≤ `date` (par défaut today).
   *   3. Si rien : `ExchangeRateNotFoundException` (404).
   */
  async lookup(dto: ExchangeRateLookupDto): Promise<ExchangeRateLookupResult> {
    if (dto.from === dto.to) throw new SameCurrencyException(dto.from);

    const fixed = await this.prisma.exchangeRate.findFirst({
      where: { fromCurrency: dto.from, toCurrency: dto.to, isFixed: true },
    });
    if (fixed) {
      return { ...fixed, isFallback: false };
    }

    const targetDate = dto.date ? new Date(dto.date) : new Date();
    const variable = await this.prisma.exchangeRate.findFirst({
      where: {
        fromCurrency: dto.from,
        toCurrency: dto.to,
        rateDate: { lte: targetDate },
      },
      orderBy: { rateDate: 'desc' },
    });
    if (!variable) throw new ExchangeRateNotFoundException(dto.from, dto.to, dto.date);

    const isFallback = variable.rateDate.toISOString().slice(0, 10) !== (dto.date ?? '');
    return { ...variable, isFallback };
  }

  // ------------------------------------------------------------------
  // Write
  // ------------------------------------------------------------------

  /**
   * Création d'un taux. Garde-fous :
   *   - `from === to` interdit (couvert par le schéma Zod, doublé ici par
   *     sécurité).
   *   - `isFixed=true` réservé à SUPER_ADMIN (ajout exceptionnel d'une
   *     nouvelle parité fixe).
   *   - Si une parité fixe existe déjà pour (from,to), on refuse l'ajout
   *     d'un taux variable (`FIXED_RATE_EXISTS`).
   */
  async create(user: AuthenticatedUser, dto: CreateExchangeRateDto): Promise<ExchangeRate> {
    if (dto.fromCurrency === dto.toCurrency) {
      throw new SameCurrencyException(dto.fromCurrency);
    }

    if (dto.isFixed === true && !user.roles.includes(SUPER_ADMIN)) {
      throw new ForbiddenRoleException([SUPER_ADMIN], user.roles);
    }

    if (dto.isFixed !== true) {
      // Refuser l'ajout d'un taux variable sur une paire qui a une parité fixe.
      const existingFixed = await this.prisma.exchangeRate.findFirst({
        where: { fromCurrency: dto.fromCurrency, toCurrency: dto.toCurrency, isFixed: true },
      });
      if (existingFixed) {
        throw new FixedRateExistsException(dto.fromCurrency, dto.toCurrency);
      }
    }

    try {
      return await this.prisma.exchangeRate.create({
        data: {
          fromCurrency: dto.fromCurrency,
          toCurrency: dto.toCurrency,
          rate: new Prisma.Decimal(dto.rate),
          rateDate: new Date(dto.rateDate),
          source: dto.source ?? null,
          isFixed: dto.isFixed,
        },
      });
    } catch (e) {
      // P2002 ici signifie un doublon (from, to, date) — pas un DUPLICATE_CODE.
      this.logger.error({ err: e }, 'exchange-rate create error');
      throw e instanceof Error ? e : new Error(String(e));
    }
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateExchangeRateDto,
  ): Promise<ExchangeRate> {
    const existing = await this.ensureExists(id);
    if (existing.isFixed && !user.roles.includes(SUPER_ADMIN)) {
      throw new ImmutableFixedRateException(id, 'update');
    }

    const data: Prisma.ExchangeRateUpdateInput = {};
    if (dto.rate !== undefined) data.rate = new Prisma.Decimal(dto.rate);
    if (dto.source !== undefined) data.source = dto.source;

    return this.prisma.exchangeRate.update({ where: { id }, data });
  }

  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    const existing = await this.ensureExists(id);
    if (existing.isFixed && !user.roles.includes(SUPER_ADMIN)) {
      throw new ImmutableFixedRateException(id, 'delete');
    }
    await this.prisma.exchangeRate.delete({ where: { id } });
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  private async ensureExists(id: string): Promise<ExchangeRate> {
    const rate = await this.prisma.exchangeRate.findUnique({ where: { id } });
    if (!rate) throw new EntityNotFoundException(ENTITY_NAME, { id });
    return rate;
  }

  static buildWhere(query: ExchangeRateQueryDto): Prisma.ExchangeRateWhereInput {
    const where: Prisma.ExchangeRateWhereInput = {};

    if (query.from) where.fromCurrency = query.from;
    if (query.to) where.toCurrency = query.to;
    if (typeof query.isFixed === 'boolean') where.isFixed = query.isFixed;

    if (query.fromDate || query.toDate) {
      where.rateDate = {};
      if (query.fromDate) where.rateDate.gte = new Date(query.fromDate);
      if (query.toDate) where.rateDate.lte = new Date(query.toDate);
    }

    // Cas particulier P2002 — laissé au caller, on ne marshalle que les filtres.
    if (where.rateDate && Object.keys(where.rateDate).length === 0) {
      delete where.rateDate;
    }

    return where;
  }
}

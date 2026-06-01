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

/**
 * Fix `fix-approval-workflow-currency-conversion` — taux indicatifs de
 * SECOURS uniquement pour la démo et le routage par seuil. La vérité
 * comptable reste la table `ref.exchange_rate` (parité fixe EUR/XOF +
 * taux variables BCEAO publiés). Ces valeurs ne sont utilisées QUE si
 * la BD n'a pas (encore) de taux pour la paire — typiquement après un
 * reset, ou pour les devises USD/GBP/CHF que personne n'a saisies.
 *
 * À ajuster avec le contrôle de gestion avant prod. Le seul taux
 * autoritaire reste EUR↔XOF (parité fixe BCEAO 655,957) qui est seedée
 * en BD avec `is_fixed=true` et ne tombe JAMAIS dans ce fallback.
 */
const FALLBACK_INDICATIVE_TO_XOF: Readonly<Record<string, number>> = {
  USD: 600,
  GBP: 800,
  CHF: 700,
};

export interface XofConversionResult {
  /** Montant équivalent en XOF (= amount * rate). */
  xofAmount: number;
  /** Taux appliqué (1 si la devise source EST XOF). */
  rate: number;
  /** True si on n'a pas trouvé de taux à la date demandée et qu'on est remonté dans le temps. */
  isFallback: boolean;
  /** True si on a basculé sur le fallback hardcodé (BD vide pour cette devise). */
  isIndicativeFallback: boolean;
}

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

  /**
   * Fix `fix-approval-workflow-currency-conversion` — convertit un montant
   * en XOF pour les comparaisons aux seuils métier (routage validation,
   * contrôle budgétaire). Distincte de `lookup` car elle :
   *   - applique le no-op si la devise source EST déjà XOF (pas de
   *     `SameCurrencyException`),
   *   - retombe sur un taux indicatif documenté (cf. constante
   *     `FALLBACK_INDICATIVE_TO_XOF`) si la BD ne connaît pas la devise,
   *     pour éviter qu'une DA bloque sur un référentiel incomplet —
   *     marqué `isIndicativeFallback=true` dans le retour pour audit.
   *
   * ⚠️ Cette méthode NE DOIT PAS être utilisée pour les écritures
   * comptables (utiliser `lookup` qui lève si pas de taux). Elle est
   * dédiée aux décisions opérationnelles (routage, plafond) où une
   * approximation indicative vaut mieux qu'un blocage.
   */
  async convertToXof(
    amount: number,
    currency: string,
    date?: string,
  ): Promise<XofConversionResult> {
    if (currency === 'XOF') {
      return { xofAmount: amount, rate: 1, isFallback: false, isIndicativeFallback: false };
    }
    try {
      const lookup = await this.lookup({ from: currency, to: 'XOF', date });
      const rate = Number(lookup.rate);
      return {
        xofAmount: amount * rate,
        rate,
        isFallback: lookup.isFallback,
        isIndicativeFallback: false,
      };
    } catch (err) {
      const fallback = FALLBACK_INDICATIVE_TO_XOF[currency];
      if (fallback !== undefined) {
        this.logger.warn(
          { currency, amount, rate: fallback },
          'no DB rate for currency, using FALLBACK_INDICATIVE_TO_XOF for routing decision',
        );
        return {
          xofAmount: amount * fallback,
          rate: fallback,
          isFallback: true,
          isIndicativeFallback: true,
        };
      }
      // Devise vraiment inconnue (ni en BD ni en fallback) — on remonte
      // l'exception pour que le caller décide (rejet ou bloque routage).
      throw err;
    }
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

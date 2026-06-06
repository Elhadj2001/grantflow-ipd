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
  UnknownCurrencyException,
} from '../../common/exceptions/business.exception';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';
import type { Role } from '../../auth/types/roles';
import { FX_BCEAO_EUR_XOF, FALLBACK_INDICATIVE_TO_XOF } from './uemoa.constants';
import type { CreateExchangeRateDto } from './dto/create-exchange-rate.dto';
import type { UpdateExchangeRateDto } from './dto/update-exchange-rate.dto';
import type {
  ExchangeRateLookupDto,
  ExchangeRateQueryDto,
} from './dto/exchange-rate-query.dto';

const ENTITY_NAME = 'ExchangeRate';
const SUPER_ADMIN: Role = 'SUPER_ADMIN';

/**
 * Résultat d'une conversion vers XOF (devise fonctionnelle SYSCEBNL).
 * Sprint S1 / US-004 (ADR-005) — forme stable consommée par les seuils
 * d'approbation, le contrôle budgétaire, le posting comptable.
 */
export interface XofConversionResult {
  /** Montant équivalent en XOF — ENTIER (le XOF n'a pas de sous-unité). */
  xofAmount: number;
  /** Taux de change appliqué pour la conversion (1 si la devise EST XOF). */
  fxRate: number;
  /** Date du taux appliqué (rate_date BD pour un taux variable, jour courant sinon). */
  fxRateDate: Date;
  /**
   * True si le taux utilisé est un fallback indicatif (USD/GBP/CHF sans
   * entrée `ref.exchange_rate`), À VALIDER par le contrôle de gestion avant prod.
   */
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
   * Primitive comptable STRICTE de résolution de taux (overhead XOF,
   * conversions de factures dans les vues SYSCEBNL strictes, etc.).
   *
   * Règles :
   *   1. Si une parité fixe `is_fixed=true` existe pour (from,to), on la
   *      retourne IMMÉDIATEMENT — la date passée en paramètre est ignorée
   *      car la parité ne dépend pas du temps (EUR↔XOF BCEAO).
   *   2. Sinon on cherche le taux le plus récent ≤ `date` (par défaut today).
   *   3. Si rien : `ExchangeRateNotFoundException` (404).
   *
   * ⚠️ DIFFÉRENCE avec `convertToXof` : `lookup` LÈVE si aucun taux n'existe
   * (aucun fallback) — c'est volontaire pour les écritures comptables qui ne
   * doivent jamais s'appuyer sur une approximation. Pour les décisions
   * OPÉRATIONNELLES (routage d'approbation, contrôle de plafond) où un
   * blocage serait pire qu'une approximation, utiliser `convertToXof`.
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
   * SOURCE UNIQUE de toute conversion OPÉRATIONNELLE vers XOF (devise
   * fonctionnelle SYSCEBNL) — sprint S1 / US-004, conformément à ADR-005.
   *
   * Utilisée par : routage par seuil d'approbation, contrôle budgétaire,
   * limites de caisse, alimentation des colonnes `*_xof` / `fx_rate` /
   * `fx_rate_date` (US-001). Tout code applicatif qui a besoin d'un
   * équivalent XOF DOIT passer par ici (pas de conversion ad hoc).
   *
   * Comportement par devise :
   *   - **XOF** : no-op (xofAmount = round(amount), fxRate = 1, date = jour).
   *     Le XOF n'a pas de sous-unité (parité BCEAO + SYSCEBNL en franc
   *     entier) → on arrondit pour neutraliser d'éventuelles décimales Decimal.
   *   - **EUR** : parité fixe BCEAO immuable `1 EUR = 655,957 XOF`
   *     (cf. `uemoa.constants`). Indépendante de la date → fxRateDate = jour
   *     (ou la date fournie). Jamais de fallback indicatif.
   *   - **USD / GBP / CHF / autres** : lookup du taux le plus récent ≤ date
   *     dans `ref.exchange_rate`. Si trouvé → fxRate + fxRateDate = rate_date BD.
   *     Si absent MAIS devise présente dans `FALLBACK_INDICATIVE_TO_XOF` →
   *     taux indicatif (`isIndicativeFallback = true`, À VALIDER PAR LE CG).
   *   - **devise inconnue** (ni gérée nativement, ni en BD, ni en fallback)
   *     → `UnknownCurrencyException` (400).
   *
   * Différence avec `lookup` : `lookup` est la primitive comptable STRICTE
   * (lève si pas de taux, aucun fallback). `convertToXof` est opérationnelle
   * (fallback toléré, tracé) — voir JSDoc de `lookup`.
   *
   * Audit trail (US-006, ISA 230) : chaque appel émet un log structuré
   * `event: 'fx_conversion'` ; un warn `fx_indicative_fallback_used` est émis
   * en plus quand le fallback indicatif est utilisé.
   *
   * @param amount   Montant source (number ou Prisma.Decimal).
   * @param currency Devise ISO-4217 du montant.
   * @param date     Date de valorisation (défaut : jour courant).
   */
  async convertToXof(
    amount: number | Prisma.Decimal,
    currency: string,
    date?: Date,
  ): Promise<XofConversionResult> {
    const value = Number(amount);
    const effectiveDate = date ?? new Date();
    let result: XofConversionResult;

    if (currency === 'XOF') {
      // 1. XOF : no-op (franc entier).
      result = {
        xofAmount: Math.round(value),
        fxRate: 1,
        fxRateDate: effectiveDate,
        isIndicativeFallback: false,
      };
    } else if (currency === 'EUR') {
      // 2. EUR : parité fixe BCEAO immuable (jamais de fallback / lookup).
      result = {
        xofAmount: Math.round(value * FX_BCEAO_EUR_XOF),
        fxRate: FX_BCEAO_EUR_XOF,
        fxRateDate: effectiveDate,
        isIndicativeFallback: false,
      };
    } else {
      // 3. Autres devises : taux BD (ref.exchange_rate), le plus récent ≤ date.
      try {
        const lookup = await this.lookup({
          from: currency,
          to: 'XOF',
          date: ExchangeRateService.toIsoDate(effectiveDate),
        });
        const fxRate = Number(lookup.rate);
        result = {
          xofAmount: Math.round(value * fxRate),
          fxRate,
          fxRateDate: lookup.rateDate,
          isIndicativeFallback: false,
        };
      } catch {
        // 4. Pas de taux BD : fallback indicatif si la devise est connue, sinon rejet.
        const fallback = FALLBACK_INDICATIVE_TO_XOF[currency];
        if (fallback === undefined) {
          throw new UnknownCurrencyException(currency);
        }
        result = {
          xofAmount: Math.round(value * fallback),
          fxRate: fallback,
          fxRateDate: effectiveDate,
          isIndicativeFallback: true,
        };
      }
    }

    // US-006 (ADR-005 / ISA 230) — audit trail : log Pino structuré SYSTÉMATIQUE
    // (audit > bruit). Pas de PII : uniquement des montants techniques.
    const rawAmount = typeof amount === 'object' ? amount.toString() : amount;
    this.logger.log(
      {
        event: 'fx_conversion',
        currency,
        rawAmount,
        xofAmount: result.xofAmount,
        fxRate: result.fxRate,
        fxRateDate: result.fxRateDate.toISOString().slice(0, 10),
        isIndicativeFallback: result.isIndicativeFallback,
      },
      `FX convert ${rawAmount} ${currency} → ${result.xofAmount} XOF (rate ${result.fxRate})`,
    );

    // Warning supplémentaire si on a dû recourir au fallback indicatif : le CG
    // doit alimenter ref.exchange_rate avant la production.
    if (result.isIndicativeFallback) {
      this.logger.warn(
        { event: 'fx_indicative_fallback_used', currency, xofAmount: result.xofAmount },
        `Indicative fallback used for ${currency} — CG must seed ref.exchange_rate before production`,
      );
    }

    return result;
  }

  /** Formate une Date en `YYYY-MM-DD` pour `lookup` (qui attend une string ISO). */
  private static toIsoDate(d: Date): string {
    return d.toISOString().slice(0, 10);
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

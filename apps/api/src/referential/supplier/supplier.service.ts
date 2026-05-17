import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Supplier } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AlreadyActiveException,
  AlreadyInactiveException,
  DuplicateCodeException,
  EntityNotFoundException,
  SupplierHasActivePosException,
} from '../../common/exceptions/business.exception';
import type { CreateSupplierDto } from './dto/create-supplier.dto';
import type { UpdateSupplierDto } from './dto/update-supplier.dto';
import type { SupplierQueryDto } from './dto/supplier-query.dto';

const ENTITY_NAME = 'Supplier';
const PG_UNIQUE_VIOLATION = 'P2002';

/**
 * Seuil de similarité pg_trgm. 0.20 = match relâché (3-4 trigrammes
 * communs sur un nom de 8-12 caractères). Si trop large à l'usage,
 * remonter à 0.30 sans recompiler le client.
 */
const TRGM_THRESHOLD = 0.2;

/**
 * Statuts PO considérés "ouverts" — un fournisseur ne peut être désactivé
 * tant qu'au moins un BC est dans l'un de ces états (cf. CLAUDE.md §2 règle 6).
 */
const OPEN_PO_STATUSES = [
  'draft',
  'sent',
  'acknowledged',
  'partially_received',
  'received',
  'invoiced',
] as const;

export interface PaginatedSuppliers {
  data: Supplier[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface SupplierWithPoCount extends Supplier {
  poCount: number;
}

/**
 * Forme d'une ligne renvoyée par la recherche trigramme. `similarity`
 * est utile au front pour afficher un score, on l'inclut dans le payload.
 */
type TrgmRow = Supplier & { similarity: number };

@Injectable()
export class SupplierService {
  private readonly logger = new Logger(SupplierService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ------------------------------------------------------------------
  // Read
  // ------------------------------------------------------------------

  async findMany(query: SupplierQueryDto): Promise<PaginatedSuppliers> {
    if (query.q) {
      return this.searchByTrigram(query);
    }
    return this.findManyStandard(query);
  }

  private async findManyStandard(query: SupplierQueryDto): Promise<PaginatedSuppliers> {
    const where = SupplierService.buildWhere(query);
    const orderBy: Prisma.SupplierOrderByWithRelationInput = { [query.sort]: query.order };
    const skip = (query.page - 1) * query.pageSize;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.supplier.findMany({ where, orderBy, skip, take: query.pageSize }),
      this.prisma.supplier.count({ where }),
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
   * Recherche full-text via `pg_trgm`. Filtres complémentaires (country,
   * currency, isActive) appliqués en SQL. Pagination AFTER scoring.
   * Fallback ILIKE si l'extension n'est pas dispo (CI bare DB).
   */
  private async searchByTrigram(query: SupplierQueryDto): Promise<PaginatedSuppliers> {
    const needle = (query.q ?? '').trim();
    const skip = (query.page - 1) * query.pageSize;
    const take = query.pageSize;

    // Le where additionnel doit être interpolable safely. Tous les
    // booléens et enums passent par Prisma.sql avec $N pour éviter
    // l'injection.
    const isActiveFilter = SupplierService.computeIsActiveFilterForRaw(query);
    const countryFilter = query.country ?? null;
    const currencyFilter = query.currency ?? null;

    try {
      // Aliases camelCase explicites — `$queryRaw` ne traverse pas le
      // mapping Prisma, donc sans alias les colonnes ressortent en
      // snake_case et le payload diverge des autres endpoints.
      const rows = await this.prisma.$queryRaw<TrgmRow[]>`
        SELECT
          s.id,
          s.code,
          s.name,
          s.vat_number       AS "vatNumber",
          s.address,
          s.country,
          s.iban,
          s.bic,
          s.bank_name        AS "bankName",
          s.payment_terms_days AS "paymentTermsDays",
          s.currency_default AS "currencyDefault",
          s.risk_score       AS "riskScore",
          s.is_active        AS "isActive",
          s.created_at       AS "createdAt",
          similarity(s.name, ${needle}) AS similarity
        FROM ref.supplier s
        WHERE similarity(s.name, ${needle}) > ${TRGM_THRESHOLD}
          AND (${isActiveFilter}::boolean IS NULL OR s.is_active = ${isActiveFilter})
          AND (${countryFilter}::text IS NULL OR s.country = ${countryFilter})
          AND (${currencyFilter}::text IS NULL OR s.currency_default = ${currencyFilter})
        ORDER BY similarity DESC, s.name ASC
        LIMIT ${take} OFFSET ${skip}
      `;
      const countRow = await this.prisma.$queryRaw<Array<{ total: bigint }>>`
        SELECT COUNT(*)::bigint AS total
        FROM ref.supplier s
        WHERE similarity(s.name, ${needle}) > ${TRGM_THRESHOLD}
          AND (${isActiveFilter}::boolean IS NULL OR s.is_active = ${isActiveFilter})
          AND (${countryFilter}::text IS NULL OR s.country = ${countryFilter})
          AND (${currencyFilter}::text IS NULL OR s.currency_default = ${currencyFilter})
      `;
      const total = Number(countRow[0]?.total ?? 0n);
      return {
        data: rows.map(({ similarity: _s, ...rest }) => rest as Supplier),
        total,
        page: query.page,
        pageSize: query.pageSize,
        hasMore: skip + rows.length < total,
      };
    } catch (e) {
      this.logger.warn({ err: e }, 'pg_trgm unavailable, falling back to ILIKE search');
      return this.findManyStandard({
        ...query,
        // `q` consommé via le where standard.
      });
    }
  }

  async findOne(id: string): Promise<SupplierWithPoCount> {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id },
      include: { _count: { select: { purchaseOrders: true } } },
    });
    if (!supplier) throw new EntityNotFoundException(ENTITY_NAME, { id });
    const { _count, ...rest } = supplier;
    return { ...rest, poCount: _count.purchaseOrders };
  }

  async findByCode(code: string): Promise<SupplierWithPoCount> {
    const supplier = await this.prisma.supplier.findUnique({
      where: { code },
      include: { _count: { select: { purchaseOrders: true } } },
    });
    if (!supplier) throw new EntityNotFoundException(ENTITY_NAME, { code });
    const { _count, ...rest } = supplier;
    return { ...rest, poCount: _count.purchaseOrders };
  }

  // ------------------------------------------------------------------
  // Write
  // ------------------------------------------------------------------

  async create(dto: CreateSupplierDto): Promise<Supplier> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const supplier = await tx.supplier.create({ data: { ...dto } });
        if (supplier.iban) {
          await tx.supplierIbanHistory.create({
            data: {
              supplierId: supplier.id,
              iban: supplier.iban,
              bic: supplier.bic,
              bankName: supplier.bankName,
              changeReason: 'INITIAL',
            },
          });
        }
        return supplier;
      });
    } catch (e) {
      this.handlePrismaWriteError(e, dto.code);
    }
  }

  async replace(id: string, dto: CreateSupplierDto): Promise<Supplier> {
    const existing = await this.ensureExists(id);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const updated = await tx.supplier.update({
          where: { id },
          data: {
            code: dto.code,
            name: dto.name,
            vatNumber: dto.vatNumber ?? null,
            address: dto.address ?? null,
            country: dto.country ?? null,
            iban: dto.iban ?? null,
            bic: dto.bic ?? null,
            bankName: dto.bankName ?? null,
            paymentTermsDays: dto.paymentTermsDays,
            currencyDefault: dto.currencyDefault,
            riskScore: dto.riskScore,
          },
        });
        await this.recordIbanChangeIfNeeded(tx, existing, updated, 'REPLACE');
        return updated;
      });
    } catch (e) {
      this.handlePrismaWriteError(e, dto.code);
    }
  }

  async update(id: string, dto: UpdateSupplierDto): Promise<Supplier> {
    const existing = await this.ensureExists(id);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const updated = await tx.supplier.update({ where: { id }, data: dto });
        await this.recordIbanChangeIfNeeded(tx, existing, updated, 'PATCH');
        return updated;
      });
    } catch (e) {
      this.handlePrismaWriteError(e, dto.code ?? '(unchanged)');
    }
  }

  /**
   * Si l'IBAN a changé entre `before` et `after`, clôt la ligne courante
   * du history (effective_to=now()) et insère une nouvelle ligne. Permet
   * à IbanFraudService de détecter les changements récents au prepare.
   */
  private async recordIbanChangeIfNeeded(
    tx: Prisma.TransactionClient,
    before: Supplier,
    after: Supplier,
    reason: string,
  ): Promise<void> {
    const ibanChanged = (before.iban ?? null) !== (after.iban ?? null);
    const bicChanged = (before.bic ?? null) !== (after.bic ?? null);
    const bankChanged = (before.bankName ?? null) !== (after.bankName ?? null);
    if (!ibanChanged && !bicChanged && !bankChanged) return;

    const now = new Date();
    // 1) Clôture la ligne courante si elle existe
    await tx.supplierIbanHistory.updateMany({
      where: { supplierId: after.id, effectiveTo: null },
      data: { effectiveTo: now },
    });
    // 2) Insère la nouvelle ligne courante (si IBAN ou banque renseignée)
    if (after.iban || after.bankName) {
      await tx.supplierIbanHistory.create({
        data: {
          supplierId: after.id,
          iban: after.iban,
          bic: after.bic,
          bankName: after.bankName,
          effectiveFrom: now,
          changeReason: reason,
        },
      });
    }
  }

  async softDelete(id: string): Promise<Supplier> {
    const supplier = await this.ensureExists(id);
    if (!supplier.isActive) throw new AlreadyInactiveException(ENTITY_NAME, id);

    const openPoCount = await this.prisma.purchaseOrder.count({
      where: {
        supplierId: id,
        status: { in: [...OPEN_PO_STATUSES] },
      },
    });
    if (openPoCount > 0) {
      throw new SupplierHasActivePosException(id, openPoCount);
    }

    return this.prisma.supplier.update({ where: { id }, data: { isActive: false } });
  }

  async restore(id: string): Promise<Supplier> {
    const supplier = await this.ensureExists(id);
    if (supplier.isActive) throw new AlreadyActiveException(ENTITY_NAME, id);
    return this.prisma.supplier.update({ where: { id }, data: { isActive: true } });
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  private async ensureExists(id: string): Promise<Supplier> {
    const supplier = await this.prisma.supplier.findUnique({ where: { id } });
    if (!supplier) throw new EntityNotFoundException(ENTITY_NAME, { id });
    return supplier;
  }

  private handlePrismaWriteError(e: unknown, code: string): never {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === PG_UNIQUE_VIOLATION) {
      throw new DuplicateCodeException(ENTITY_NAME, code);
    }
    this.logger.error({ err: e, code }, 'supplier write error (rethrow)');
    throw e instanceof Error ? e : new Error(String(e));
  }

  /**
   * Sémantique isActive identique à Donor :
   *   - includeInactive=true → null (pas de filtre)
   *   - isActive fourni      → bool
   *   - sinon                → true (défaut sécurisé)
   */
  static computeIsActiveFilter(query: SupplierQueryDto): boolean | undefined {
    if (query.includeInactive === true) return undefined;
    if (typeof query.isActive === 'boolean') return query.isActive;
    return true;
  }

  /**
   * Variante pour `$queryRaw` : on ne peut pas passer `undefined` à Postgres,
   * donc on renvoie `null` qui sera traité par la clause SQL `IS NULL`.
   */
  static computeIsActiveFilterForRaw(query: SupplierQueryDto): boolean | null {
    const v = SupplierService.computeIsActiveFilter(query);
    return v === undefined ? null : v;
  }

  static buildWhere(query: SupplierQueryDto): Prisma.SupplierWhereInput {
    const where: Prisma.SupplierWhereInput = {};

    if (query.country) where.country = query.country;
    if (query.currency) where.currencyDefault = query.currency;

    const activeFilter = SupplierService.computeIsActiveFilter(query);
    if (activeFilter !== undefined) where.isActive = activeFilter;

    if (query.q) {
      const needle = query.q.trim();
      where.OR = [
        { code: { contains: needle, mode: 'insensitive' } },
        { name: { contains: needle, mode: 'insensitive' } },
        { country: { contains: needle, mode: 'insensitive' } },
      ];
    }

    return where;
  }
}

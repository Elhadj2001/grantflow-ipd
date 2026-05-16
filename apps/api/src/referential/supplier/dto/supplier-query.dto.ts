import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { SUPPLIER_CURRENCIES } from './create-supplier.dto';

export const SUPPLIER_SORT_FIELDS = ['code', 'name', 'createdAt', 'riskScore'] as const;
export type SupplierSortField = (typeof SUPPLIER_SORT_FIELDS)[number];

const coerceBool = z
  .union([z.literal('true'), z.literal('false'), z.boolean()])
  .transform((v) => (typeof v === 'boolean' ? v : v === 'true'));

const coerceInt = (min: number, max: number, def: number) =>
  z
    .union([z.string().regex(/^\d+$/), z.number().int()])
    .transform((v) => (typeof v === 'number' ? v : parseInt(v, 10)))
    .pipe(z.number().int().min(min).max(max))
    .default(def);

export const SupplierQuerySchema = z
  .object({
    /**
     * Recherche full-text. Si présente, on bascule sur `pg_trgm` :
     * la pagination est appliquée APRÈS le scoring (cf. service).
     */
    q: z.string().min(1).max(128).optional(),
    country: z.string().min(2).max(64).optional(),
    currency: z.enum(SUPPLIER_CURRENCIES).optional(),
    isActive: coerceBool.optional(),
    includeInactive: coerceBool.optional(),
    page: coerceInt(1, 10_000, 1),
    pageSize: coerceInt(1, 100, 20),
    sort: z.enum(SUPPLIER_SORT_FIELDS).default('name'),
    order: z.enum(['asc', 'desc']).default('asc'),
  })
  .strict();

export class SupplierQueryDto extends createZodDto(SupplierQuerySchema) {}

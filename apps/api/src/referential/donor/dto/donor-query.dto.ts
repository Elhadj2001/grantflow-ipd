import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/**
 * Champs de tri autorisés. Restreint à une union close pour empêcher
 * un client de trier sur n'importe quelle colonne (risque injection
 * + perf sur colonnes non-indexées).
 */
export const DONOR_SORT_FIELDS = ['code', 'label', 'createdAt'] as const;
export type DonorSortField = (typeof DONOR_SORT_FIELDS)[number];

const DONOR_TYPES = [
  'public_intl',
  'private_foundation',
  'bilateral',
  'multilateral',
  'government',
  'own_funds',
] as const;

/**
 * Helpers Zod : les query params sont toujours `string`. On coerce les
 * booléens et entiers via préprocesseurs explicites pour éviter les
 * surprises de `Boolean("false") === true`.
 */
const coerceBool = z
  .union([z.literal('true'), z.literal('false'), z.boolean()])
  .transform((v) => (typeof v === 'boolean' ? v : v === 'true'));

const coerceInt = (min: number, max: number, def: number) =>
  z
    .union([z.string().regex(/^\d+$/), z.number().int()])
    .transform((v) => (typeof v === 'number' ? v : parseInt(v, 10)))
    .pipe(z.number().int().min(min).max(max))
    .default(def);

export const DonorQuerySchema = z
  .object({
    q: z.string().min(1).max(128).optional(),
    type: z.enum(DONOR_TYPES).optional(),
    country: z.string().min(2).max(64).optional(),
    isActive: coerceBool.optional(),
    includeInactive: coerceBool.optional(),
    page: coerceInt(1, 10_000, 1),
    pageSize: coerceInt(1, 100, 20),
    sort: z.enum(DONOR_SORT_FIELDS).default('label'),
    order: z.enum(['asc', 'desc']).default('asc'),
  })
  .strict();

export class DonorQueryDto extends createZodDto(DonorQuerySchema) {}

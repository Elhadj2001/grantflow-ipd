import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const CASH_BOX_SORT_FIELDS = ['code', 'label', 'currentBalance', 'createdAt'] as const;
export type CashBoxSortField = (typeof CASH_BOX_SORT_FIELDS)[number];

const coerceBool = z
  .union([z.literal('true'), z.literal('false'), z.boolean()])
  .transform((v) => (typeof v === 'boolean' ? v : v === 'true'));

const coerceInt = (min: number, max: number, def: number) =>
  z
    .union([z.string().regex(/^\d+$/), z.number().int()])
    .transform((v) => (typeof v === 'number' ? v : parseInt(v, 10)))
    .pipe(z.number().int().min(min).max(max))
    .default(def);

export const CashBoxQuerySchema = z
  .object({
    q: z.string().min(1).max(128).optional(),
    isActive: coerceBool.optional(),
    includeInactive: coerceBool.optional(),
    page: coerceInt(1, 10_000, 1),
    pageSize: coerceInt(1, 100, 20),
    sort: z.enum(CASH_BOX_SORT_FIELDS).default('label'),
    order: z.enum(['asc', 'desc']).default('asc'),
  })
  .strict();

export class CashBoxQueryDto extends createZodDto(CashBoxQuerySchema) {}

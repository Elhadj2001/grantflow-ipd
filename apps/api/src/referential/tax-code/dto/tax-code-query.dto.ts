import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const TAX_CODE_SORT_FIELDS = ['code', 'label', 'rate'] as const;
export type TaxCodeSortField = (typeof TAX_CODE_SORT_FIELDS)[number];

const coerceBool = z
  .union([z.literal('true'), z.literal('false'), z.boolean()])
  .transform((v) => (typeof v === 'boolean' ? v : v === 'true'));

const coerceInt = (min: number, max: number, def: number) =>
  z
    .union([z.string().regex(/^\d+$/), z.number().int()])
    .transform((v) => (typeof v === 'number' ? v : parseInt(v, 10)))
    .pipe(z.number().int().min(min).max(max))
    .default(def);

export const TaxCodeQuerySchema = z
  .object({
    q: z.string().min(1).max(128).optional(),
    isActive: coerceBool.optional(),
    includeInactive: coerceBool.optional(),
    page: coerceInt(1, 10_000, 1),
    pageSize: coerceInt(1, 100, 50),
    sort: z.enum(TAX_CODE_SORT_FIELDS).default('code'),
    order: z.enum(['asc', 'desc']).default('asc'),
  })
  .strict();

export class TaxCodeQueryDto extends createZodDto(TaxCodeQuerySchema) {}

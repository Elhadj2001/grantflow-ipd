import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { GRANT_STATUSES, SUPPORTED_CURRENCIES } from './create-grant.dto';

export const GRANT_SORT_FIELDS = [
  'reference',
  'amount',
  'startDate',
  'endDate',
  'createdAt',
] as const;
export type GrantSortField = (typeof GRANT_SORT_FIELDS)[number];

const coerceInt = (min: number, max: number, def: number) =>
  z
    .union([z.string().regex(/^\d+$/), z.number().int()])
    .transform((v) => (typeof v === 'number' ? v : parseInt(v, 10)))
    .pipe(z.number().int().min(min).max(max))
    .default(def);

const ISO_DATE = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/);

export const GrantQuerySchema = z
  .object({
    q: z.string().min(1).max(128).optional(),
    donorId: z.string().uuid().optional(),
    projectId: z.string().uuid().optional(),
    status: z.enum(GRANT_STATUSES).optional(),
    currency: z.enum(SUPPORTED_CURRENCIES).optional(),
    /** Bornes inclusives sur startDate/endDate, format ISO. */
    startsAfter: ISO_DATE.optional(),
    endsBefore: ISO_DATE.optional(),
    page: coerceInt(1, 10_000, 1),
    pageSize: coerceInt(1, 100, 20),
    sort: z.enum(GRANT_SORT_FIELDS).default('reference'),
    order: z.enum(['asc', 'desc']).default('asc'),
  })
  .strict();

export class GrantQueryDto extends createZodDto(GrantQuerySchema) {}

import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { PoStatus } from '@prisma/client';

export const PO_SORT_FIELDS = ['createdAt', 'orderDate', 'poNumber', 'totalTtc'] as const;

const coerceInt = (min: number, max: number, def: number) =>
  z
    .union([z.string().regex(/^\d+$/), z.number().int()])
    .transform((v) => (typeof v === 'number' ? v : parseInt(v, 10)))
    .pipe(z.number().int().min(min).max(max))
    .default(def);

export const PoQuerySchema = z
  .object({
    q: z.string().min(1).max(128).optional(),
    status: z.nativeEnum(PoStatus).optional(),
    supplierId: z.string().uuid().optional(),
    fromDate: z.string().optional(),
    toDate: z.string().optional(),
    page: coerceInt(1, 10_000, 1),
    pageSize: coerceInt(1, 100, 20),
    sort: z.enum(PO_SORT_FIELDS).default('createdAt'),
    order: z.enum(['asc', 'desc']).default('desc'),
  })
  .strict();

export class PoQueryDto extends createZodDto(PoQuerySchema) {}

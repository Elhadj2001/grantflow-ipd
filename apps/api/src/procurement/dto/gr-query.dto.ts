import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { GrStatus } from '@prisma/client';

export const GR_SORT_FIELDS = ['createdAt', 'receiptDate', 'grNumber'] as const;

const coerceInt = (min: number, max: number, def: number) =>
  z
    .union([z.string().regex(/^\d+$/), z.number().int()])
    .transform((v) => (typeof v === 'number' ? v : parseInt(v, 10)))
    .pipe(z.number().int().min(min).max(max))
    .default(def);

export const GrQuerySchema = z
  .object({
    q: z.string().min(1).max(128).optional(),
    status: z.nativeEnum(GrStatus).optional(),
    poId: z.string().uuid().optional(),
    fromDate: z.string().optional(),
    toDate: z.string().optional(),
    page: coerceInt(1, 10_000, 1),
    pageSize: coerceInt(1, 100, 20),
    sort: z.enum(GR_SORT_FIELDS).default('createdAt'),
    order: z.enum(['asc', 'desc']).default('desc'),
  })
  .strict();

export class GrQueryDto extends createZodDto(GrQuerySchema) {}

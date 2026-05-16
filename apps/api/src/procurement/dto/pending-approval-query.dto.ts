import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

const coerceBool = z
  .union([z.literal('true'), z.literal('false'), z.boolean()])
  .transform((v) => (typeof v === 'boolean' ? v : v === 'true'));

const coerceInt = (min: number, max: number, def: number) =>
  z
    .union([z.string().regex(/^\d+$/), z.number().int()])
    .transform((v) => (typeof v === 'number' ? v : parseInt(v, 10)))
    .pipe(z.number().int().min(min).max(max))
    .default(def);

const ISO_DATE = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be ISO 8601 YYYY-MM-DD');

export const PendingApprovalQuerySchema = z
  .object({
    projectId: z.string().uuid().optional(),
    fromDate: ISO_DATE.optional(),
    toDate: ISO_DATE.optional(),
    /** Restreint aux DA dont `neededBy ≤ today + 7d`. */
    urgent: coerceBool.optional(),
    page: coerceInt(1, 10_000, 1),
    pageSize: coerceInt(1, 100, 20),
  })
  .strict();

export class PendingApprovalQueryDto extends createZodDto(PendingApprovalQuerySchema) {}

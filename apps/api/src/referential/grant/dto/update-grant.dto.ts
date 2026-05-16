import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { GRANT_STATUSES, SUPPORTED_CURRENCIES } from './create-grant.dto';

const ISO_DATE = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be ISO 8601 YYYY-MM-DD');

const DECIMAL_STR = z.union([
  z.number().positive(),
  z.string().regex(/^\d+(\.\d{1,4})?$/, 'Must be a positive decimal'),
]);

export const UpdateGrantSchema = z
  .object({
    reference: z
      .string()
      .regex(/^[A-Z0-9][A-Z0-9/_-]{3,63}$/, 'Reference must match regex')
      .optional(),
    donorId: z.string().uuid().optional(),
    projectId: z.string().uuid().optional(),
    amount: DECIMAL_STR.optional(),
    currency: z.enum(SUPPORTED_CURRENCIES).optional(),
    overheadRate: z
      .union([z.number(), z.string().regex(/^\d+(\.\d{1,4})?$/)])
      .transform((v) => (typeof v === 'number' ? v : parseFloat(v)))
      .pipe(z.number().min(0).max(0.5))
      .optional(),
    startDate: ISO_DATE.optional(),
    endDate: ISO_DATE.optional(),
    status: z.enum(GRANT_STATUSES).optional(),
    signedAt: ISO_DATE.nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .strict();

export class UpdateGrantDto extends createZodDto(UpdateGrantSchema) {}

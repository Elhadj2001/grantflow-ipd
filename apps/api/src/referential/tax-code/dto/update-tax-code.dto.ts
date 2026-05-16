import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

const DECIMAL_RATE = z.union([
  z.number().min(0).max(1),
  z.string().regex(/^0(\.\d{1,4})?$|^1(\.0{1,4})?$/, 'Rate must be in [0, 1]'),
]);

export const UpdateTaxCodeSchema = z
  .object({
    code: z
      .string()
      .regex(/^[A-Z0-9][A-Z0-9-]{1,31}$/, 'Code must match regex')
      .optional(),
    label: z.string().min(3).max(255).optional(),
    rate: DECIMAL_RATE.optional(),
    accountCode: z.string().min(2).max(16).nullable().optional(),
  })
  .strict();

export class UpdateTaxCodeDto extends createZodDto(UpdateTaxCodeSchema) {}

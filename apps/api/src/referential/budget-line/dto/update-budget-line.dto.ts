import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

const DECIMAL_STR = z.union([
  z.number().positive(),
  z.string().regex(/^\d+(\.\d{1,4})?$/, 'Must be a positive decimal'),
]);

export const UpdateBudgetLineSchema = z
  .object({
    code: z
      .string()
      .regex(/^[A-Z0-9][A-Z0-9-]{1,31}$/, 'Code must match regex')
      .optional(),
    label: z.string().min(3).max(255).optional(),
    budgetedAmount: DECIMAL_STR.optional(),
    defaultAccount: z.string().max(16).nullable().optional(),
    isOverheadEligible: z.boolean().optional(),
  })
  .strict();

export class UpdateBudgetLineDto extends createZodDto(UpdateBudgetLineSchema) {}

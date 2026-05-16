import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/**
 * Code de ligne budgétaire : 2-32 caractères, MAJ/chiffres/tirets.
 * Exemple seed : L01, L02-DEP, ADM-2024.
 */
const CODE_REGEX = /^[A-Z0-9][A-Z0-9-]{1,31}$/;

const DECIMAL_STR = z.union([
  z.number().nonnegative(),
  z.string().regex(/^\d+(\.\d{1,4})?$/, 'Must be a positive decimal'),
]);

export const CreateBudgetLineSchema = z
  .object({
    code: z.string().regex(CODE_REGEX, 'Code must match /^[A-Z0-9][A-Z0-9-]{1,31}$/'),
    label: z.string().min(3).max(255),
    budgetedAmount: DECIMAL_STR.refine(
      (v) => {
        const n = typeof v === 'number' ? v : parseFloat(v);
        return n > 0;
      },
      { message: 'budgetedAmount must be strictly positive' },
    ),
    defaultAccount: z.string().max(16).optional(),
    isOverheadEligible: z.boolean().default(true),
  })
  .strict();

export class CreateBudgetLineDto extends createZodDto(CreateBudgetLineSchema) {}

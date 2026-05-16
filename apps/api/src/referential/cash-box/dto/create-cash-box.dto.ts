import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/**
 * Convention `code` : MAJUSCULES + chiffres + tirets, 2-32 chars.
 * Aligné sur les autres référentiels (Donor, Supplier, etc.).
 */
const CODE_REGEX = /^[A-Z0-9][A-Z0-9-]{1,31}$/;

export const CreateCashBoxSchema = z
  .object({
    code: z.string().regex(CODE_REGEX, 'Code must match /^[A-Z0-9][A-Z0-9-]{1,31}$/'),
    label: z.string().min(2).max(255),
    custodianUserId: z.string().uuid().optional(),
    currency: z.string().length(3).default('XOF'),
    /**
     * Soldes & plafonds : `currentBalance` peut être posé à la création
     * (provisionnement initial). Les CHECK DB garantissent `> 0` ou `>= 0`.
     */
    currentBalance: z.number().nonnegative().default(0),
    ceiling: z.number().positive().default(500_000),
    perRequestMax: z.number().positive().default(100_000),
    perDayUserMax: z.number().positive().default(200_000),
  })
  .strict();

export class CreateCashBoxDto extends createZodDto(CreateCashBoxSchema) {}

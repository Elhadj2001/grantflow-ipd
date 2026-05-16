import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/**
 * Codes TVA standard sénégalais : TVA18, TVA10, TVA0, TVA18-DEDUC, EXEMPT.
 * Convention : MAJUSCULES + chiffres + tirets, 2-32 caractères.
 */
const CODE_REGEX = /^[A-Z0-9][A-Z0-9-]{1,31}$/;

const DECIMAL_RATE = z.union([
  z.number().min(0).max(1),
  z.string().regex(/^0(\.\d{1,4})?$|^1(\.0{1,4})?$/, 'Rate must be in [0, 1]'),
]);

export const CreateTaxCodeSchema = z
  .object({
    code: z.string().regex(CODE_REGEX, 'Code must match /^[A-Z0-9][A-Z0-9-]{1,31}$/'),
    label: z.string().min(3).max(255),
    /**
     * Taux décimal entre 0 et 1 (TVA 18 % → 0.18). On garde la même
     * précision que la colonne `NUMERIC(6,4)`.
     */
    rate: DECIMAL_RATE,
    /** FK optionnelle vers `ref.gl_account.code` (ex: 4456 pour TVA déductible). */
    accountCode: z.string().min(2).max(16).optional(),
  })
  .strict();

export class CreateTaxCodeDto extends createZodDto(CreateTaxCodeSchema) {}

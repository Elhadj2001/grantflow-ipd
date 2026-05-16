import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/** ISO 4217 — 3 lettres MAJ. On laisse libre car on ne gère pas les codes obsolètes. */
const CURRENCY_REGEX = /^[A-Z]{3}$/;

const ISO_DATE = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be ISO 8601 YYYY-MM-DD');

const POSITIVE_DECIMAL = z.union([
  z.number().positive(),
  z.string().regex(/^\d+(\.\d{1,8})?$/, 'Rate must be a positive decimal'),
]);

export const CreateExchangeRateSchema = z
  .object({
    fromCurrency: z.string().regex(CURRENCY_REGEX, 'fromCurrency must be ISO 4217 (3 upper letters)'),
    toCurrency: z.string().regex(CURRENCY_REGEX, 'toCurrency must be ISO 4217 (3 upper letters)'),
    rate: POSITIVE_DECIMAL,
    rateDate: ISO_DATE,
    source: z.string().max(64).optional(),
    /**
     * `isFixed` — drapeau BCEAO. Visible côté DTO mais le service rejette
     * si l'utilisateur n'est pas SUPER_ADMIN (cas d'ajout d'une nouvelle
     * parité fixe UEMOA, opération extraordinaire).
     */
    isFixed: z.boolean().default(false),
  })
  .strict()
  .refine((v) => v.fromCurrency !== v.toCurrency, {
    message: 'fromCurrency and toCurrency must differ',
    path: ['toCurrency'],
  });

export class CreateExchangeRateDto extends createZodDto(CreateExchangeRateSchema) {}

import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/**
 * Convention référence convention bailleur : MAJUSCULES/chiffres/tirets/slash,
 * min 4 caractères, max 64. Exemples seeds : BMGF-2023-117, EDCTP3-2024-09.
 */
const REFERENCE_REGEX = /^[A-Z0-9][A-Z0-9/_-]{3,63}$/;

export const GRANT_STATUSES = ['draft', 'active', 'suspended', 'closed'] as const;
export type GrantStatusLiteral = (typeof GRANT_STATUSES)[number];

/**
 * Devises supportées. Liste fermée pour éviter qu'un humain saisisse
 * un code non aligné sur la table `ref.exchange_rate` (sinon les
 * conversions XOF échoueraient à l'exécution).
 */
export const SUPPORTED_CURRENCIES = ['XOF', 'EUR', 'USD', 'GBP', 'CHF'] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

const ISO_DATE = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be ISO 8601 YYYY-MM-DD');

const DECIMAL_STR = z.union([
  z.number().positive(),
  z.string().regex(/^\d+(\.\d{1,4})?$/, 'Must be a positive decimal'),
]);

export const CreateGrantSchema = z
  .object({
    reference: z.string().regex(REFERENCE_REGEX, 'Reference must match /^[A-Z0-9][A-Z0-9/_-]{3,63}$/'),
    donorId: z.string().uuid(),
    projectId: z.string().uuid(),
    amount: DECIMAL_STR,
    currency: z.enum(SUPPORTED_CURRENCIES),
    /** Taux d'overhead 0..0.5 (max 50%). Au-delà : revue conformité. */
    overheadRate: z
      .union([z.number(), z.string().regex(/^\d+(\.\d{1,4})?$/)])
      .transform((v) => (typeof v === 'number' ? v : parseFloat(v)))
      .pipe(z.number().min(0).max(0.5))
      .default(0),
    startDate: ISO_DATE,
    endDate: ISO_DATE,
    status: z.enum(GRANT_STATUSES).default('draft'),
    // Fix create-grant-nullable : un formulaire web envoie volontiers
    // `null` pour des champs vides (vs `undefined` côté JSON serialization).
    // `.nullish()` accepte `null` ET `undefined` — symétrique à
    // update-grant.dto.ts qui utilise déjà `.nullable().optional()`.
    signedAt: ISO_DATE.nullish(),
    notes: z.string().max(2000).nullish(),
  })
  .strict()
  .refine((v) => v.endDate > v.startDate, {
    message: 'endDate must be strictly after startDate',
    path: ['endDate'],
  });

export class CreateGrantDto extends createZodDto(CreateGrantSchema) {}

import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

const POSITIVE_DECIMAL = z.union([
  z.number().positive(),
  z.string().regex(/^\d+(\.\d{1,8})?$/, 'Rate must be a positive decimal'),
]);

/**
 * Update partiel. On NE permet pas de changer les couples devises ni la date
 * (sinon on créerait un doublon caché sur la contrainte unique). Pour
 * remplacer un taux par un autre, il faut DELETE + POST.
 */
export const UpdateExchangeRateSchema = z
  .object({
    rate: POSITIVE_DECIMAL.optional(),
    source: z.string().max(64).nullable().optional(),
  })
  .strict();

export class UpdateExchangeRateDto extends createZodDto(UpdateExchangeRateSchema) {}

import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/**
 * Clôture d'une période fiscale. `acknowledgeWarnings` est l'override
 * DAF pour passer outre les BLOCKING findings — `reason` devient alors
 * obligatoire (≥ 5 caractères, journalisé dans period_close_event).
 */
export const ClosePeriodSchema = z
  .object({
    acknowledgeWarnings: z.boolean().optional().default(false),
    reason: z.string().max(2000).optional(),
  })
  .strict();
export class ClosePeriodDto extends createZodDto(ClosePeriodSchema) {}

/** Ré-ouverture d'une période close. Reason obligatoire (DAF only). */
export const ReopenPeriodSchema = z
  .object({
    reason: z.string().min(5).max(2000),
  })
  .strict();
export class ReopenPeriodDto extends createZodDto(ReopenPeriodSchema) {}

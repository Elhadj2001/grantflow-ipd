import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/**
 * Conventions code projet : MAJUSCULES + chiffres + tirets, min 3.
 * Aligné sur les seeds existants (MADIBA-VAC-2024, PALU-DAKAR-2026, etc.).
 */
const CODE_REGEX = /^[A-Z][A-Z0-9-]{2,63}$/;

export const PROJECT_STATUSES = ['active', 'suspended', 'closed'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/**
 * Date ISO `YYYY-MM-DD`. On préfère un schéma string + regex à `z.coerce.date`
 * pour rester transparent côté Swagger et conserver la chaîne exacte en cas
 * d'erreur de validation.
 */
const ISO_DATE = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be ISO 8601 YYYY-MM-DD');

export const CreateProjectSchema = z
  .object({
    code: z.string().regex(CODE_REGEX, 'Code must match /^[A-Z][A-Z0-9-]{2,63}$/'),
    title: z.string().min(5).max(255),
    programId: z.string().uuid().optional(),
    piUserId: z.string().uuid().optional(),
    startDate: ISO_DATE,
    endDate: ISO_DATE.optional(),
    status: z.enum(PROJECT_STATUSES).default('active'),
    description: z.string().max(2000).optional(),
  })
  .strict()
  .refine(
    (v) => !v.endDate || v.endDate > v.startDate,
    { message: 'endDate must be strictly after startDate', path: ['endDate'] },
  );

export class CreateProjectDto extends createZodDto(CreateProjectSchema) {}

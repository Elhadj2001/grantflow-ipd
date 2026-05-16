import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { PROJECT_STATUSES } from './create-project.dto';

const ISO_DATE = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be ISO 8601 YYYY-MM-DD');

/**
 * PATCH — tous les champs optionnels. La cohérence
 * startDate < endDate est vérifiée au niveau service (besoin
 * d'éventuellement lire la valeur courante en BD).
 */
export const UpdateProjectSchema = z
  .object({
    code: z
      .string()
      .regex(/^[A-Z][A-Z0-9-]{2,63}$/, 'Code must match /^[A-Z][A-Z0-9-]{2,63}$/')
      .optional(),
    title: z.string().min(5).max(255).optional(),
    programId: z.string().uuid().nullable().optional(),
    piUserId: z.string().uuid().nullable().optional(),
    startDate: ISO_DATE.optional(),
    endDate: ISO_DATE.nullable().optional(),
    status: z.enum(PROJECT_STATUSES).optional(),
    description: z.string().max(2000).nullable().optional(),
  })
  .strict();

export class UpdateProjectDto extends createZodDto(UpdateProjectSchema) {}

import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const NOTE_TECHNIQUE_STATUSES = [
  'draft',
  'pending_daf',
  'validated_daf',
  'active',
  'superseded',
] as const;

/** Filtres optionnels de liste des Notes Techniques. */
export const NoteTechniqueQuerySchema = z
  .object({
    grantId: z.string().uuid().optional(),
    status: z.enum(NOTE_TECHNIQUE_STATUSES).optional(),
  })
  .strict();

export class NoteTechniqueQueryDto extends createZodDto(NoteTechniqueQuerySchema) {}

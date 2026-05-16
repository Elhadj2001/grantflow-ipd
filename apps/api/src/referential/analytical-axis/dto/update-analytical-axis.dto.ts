import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { AXIS_TYPES } from './create-analytical-axis.dto';

const MAX_METADATA_BYTES = 16 * 1024;

export const UpdateAnalyticalAxisSchema = z
  .object({
    /**
     * `type` modifiable mais on rejette plus tard si l'axe a des
     * enfants — sinon on casserait la cohérence mono-type de l'arbre.
     */
    type: z.enum(AXIS_TYPES).optional(),
    code: z
      .string()
      .regex(/^[A-Z0-9][A-Z0-9_-]{1,31}$/, 'Code must match regex')
      .optional(),
    label: z.string().min(3).max(255).optional(),
    parentId: z.string().uuid().nullable().optional(),
    metadata: z
      .record(z.unknown())
      .refine(
        (v) => Buffer.byteLength(JSON.stringify(v), 'utf8') <= MAX_METADATA_BYTES,
        { message: `metadata payload exceeds ${MAX_METADATA_BYTES} bytes` },
      )
      .nullable()
      .optional(),
  })
  .strict();

export class UpdateAnalyticalAxisDto extends createZodDto(UpdateAnalyticalAxisSchema) {}

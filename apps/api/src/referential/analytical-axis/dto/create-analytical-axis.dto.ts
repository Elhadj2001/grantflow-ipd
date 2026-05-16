import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/**
 * Types d'axes — alignés sur l'enum Postgres `ref.axis_type`. La liste
 * doit rester identique : tout ajout passe d'abord par le DDL.
 */
export const AXIS_TYPES = [
  'project',
  'donor',
  'grant',
  'program',
  'cost_center',
  'activity',
  'geo',
] as const;
export type AxisTypeLiteral = (typeof AXIS_TYPES)[number];

/** Conventions code axe : 2-32 caractères, MAJ/chiffres/tirets/underscore. */
const CODE_REGEX = /^[A-Z0-9][A-Z0-9_-]{1,31}$/;

/** Garde-fou anti-bloat : ≤ 16 KB de JSON dans `metadata`. */
const MAX_METADATA_BYTES = 16 * 1024;

export const CreateAnalyticalAxisSchema = z
  .object({
    type: z.enum(AXIS_TYPES),
    code: z.string().regex(CODE_REGEX, 'Code must match /^[A-Z0-9][A-Z0-9_-]{1,31}$/'),
    label: z.string().min(3).max(255),
    parentId: z.string().uuid().optional(),
    /**
     * `metadata` : JSON libre côté front (couleurs, icônes, étiquettes
     * supplémentaires). On limite la taille pour éviter qu'un import
     * sauvage charge des fichiers entiers en BD.
     */
    metadata: z
      .record(z.unknown())
      .refine(
        (v) => Buffer.byteLength(JSON.stringify(v), 'utf8') <= MAX_METADATA_BYTES,
        { message: `metadata payload exceeds ${MAX_METADATA_BYTES} bytes` },
      )
      .optional(),
  })
  .strict();

export class CreateAnalyticalAxisDto extends createZodDto(CreateAnalyticalAxisSchema) {}

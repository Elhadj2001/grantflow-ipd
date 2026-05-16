import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { AXIS_TYPES } from './create-analytical-axis.dto';

const coerceBool = z
  .union([z.literal('true'), z.literal('false'), z.boolean()])
  .transform((v) => (typeof v === 'boolean' ? v : v === 'true'));

const coerceInt = (min: number, max: number, def: number) =>
  z
    .union([z.string().regex(/^\d+$/), z.number().int()])
    .transform((v) => (typeof v === 'number' ? v : parseInt(v, 10)))
    .pipe(z.number().int().min(min).max(max))
    .default(def);

export const AnalyticalAxisQuerySchema = z
  .object({
    type: z.enum(AXIS_TYPES).optional(),
    parentId: z.union([z.string().uuid(), z.literal('null')]).optional(),
    isActive: coerceBool.optional(),
    includeInactive: coerceBool.optional(),
    q: z.string().min(1).max(128).optional(),
    /**
     * Si vrai, retourne l'arbre hiérarchique (avec `children[]`) en
     * un seul payload. La pagination est ignorée dans ce mode car
     * un arbre paginé n'a pas de sens — usage front "select tree".
     */
    asTree: coerceBool.optional(),
    page: coerceInt(1, 10_000, 1),
    pageSize: coerceInt(1, 500, 100),
  })
  .strict();

export class AnalyticalAxisQueryDto extends createZodDto(AnalyticalAxisQuerySchema) {}

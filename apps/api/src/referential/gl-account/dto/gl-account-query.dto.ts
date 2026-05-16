import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ACCOUNT_CLASSES } from './create-gl-account.dto';

const coerceBool = z
  .union([z.literal('true'), z.literal('false'), z.boolean()])
  .transform((v) => (typeof v === 'boolean' ? v : v === 'true'));

const coerceInt = (min: number, max: number, def: number) =>
  z
    .union([z.string().regex(/^\d+$/), z.number().int()])
    .transform((v) => (typeof v === 'number' ? v : parseInt(v, 10)))
    .pipe(z.number().int().min(min).max(max))
    .default(def);

export const GlAccountQuerySchema = z
  .object({
    q: z.string().min(1).max(128).optional(),
    class: z.enum(ACCOUNT_CLASSES).optional(),
    parentCode: z.union([z.string().regex(/^[1-9][0-9]{0,7}$/), z.literal('null')]).optional(),
    isMovement: coerceBool.optional(),
    isActive: coerceBool.optional(),
    includeInactive: coerceBool.optional(),
    syscebnlSpecific: coerceBool.optional(),
    asTree: coerceBool.optional(),
    page: coerceInt(1, 10_000, 1),
    pageSize: coerceInt(1, 500, 100),
  })
  .strict();

export class GlAccountQueryDto extends createZodDto(GlAccountQuerySchema) {}

import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ACCOUNT_CLASSES } from './create-gl-account.dto';

/**
 * PATCH GL account — le `code` n'est PAS modifiable (clé métier publique
 * exposée dans la balance générale). Pour renommer un compte, créer un
 * nouveau code + migrer les écritures, ou bien laisser le DDL.
 */
export const UpdateGlAccountSchema = z
  .object({
    label: z.string().min(3).max(255).optional(),
    class: z.enum(ACCOUNT_CLASSES).optional(),
    parentCode: z
      .string()
      .regex(/^[1-9][0-9]{0,7}$/)
      .nullable()
      .optional(),
    isMovement: z.boolean().optional(),
    syscebnlSpecific: z.boolean().optional(),
    description: z.string().max(1024).nullable().optional(),
  })
  .strict();

export class UpdateGlAccountDto extends createZodDto(UpdateGlAccountSchema) {}

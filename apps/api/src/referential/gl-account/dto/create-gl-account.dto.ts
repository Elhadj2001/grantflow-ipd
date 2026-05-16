import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/**
 * SYSCEBNL/OHADA — classes comptables 1..9.
 *   1 = Capitaux et financement durable (Bénévolat compris pour OHANA)
 *   2 = Immobilisations
 *   3 = Stocks
 *   4 = Tiers (clients, fournisseurs, État)
 *   5 = Trésorerie
 *   6 = Charges
 *   7 = Produits
 *   8 = Comptabilité spéciale (engagements, abandons)
 *   9 = Comptabilité analytique
 */
export const ACCOUNT_CLASSES = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;
export type AccountClass = (typeof ACCOUNT_CLASSES)[number];

/**
 * Code SYSCEBNL : commence par le chiffre de classe, longueur 1-8.
 * Exemples : `1`, `10`, `101`, `6011`, `4456` (TVA déductible).
 */
const CODE_REGEX = /^[1-9][0-9]{0,7}$/;

export const CreateGlAccountSchema = z
  .object({
    code: z.string().regex(CODE_REGEX, 'Code must match /^[1-9][0-9]{0,7}$/'),
    label: z.string().min(3).max(255),
    class: z.enum(ACCOUNT_CLASSES),
    parentCode: z
      .string()
      .regex(CODE_REGEX, 'parentCode must match /^[1-9][0-9]{0,7}$/')
      .optional(),
    /**
     * `isMovement` : true = compte mouvementé (sur lequel on enregistre
     * des écritures). false = compte de regroupement (ne reçoit que des
     * totaux dans la balance).
     */
    isMovement: z.boolean().default(true),
    /**
     * `syscebnlSpecific` : compte spécifique au plan SYSCEBNL des OBNL
     * (ex: classe 1 fonds dédiés). Sert au filtrage rapports.
     */
    syscebnlSpecific: z.boolean().default(false),
    description: z.string().max(1024).optional(),
  })
  .strict()
  .refine((v) => v.code.startsWith(v.class), {
    message: 'code must start with the declared class',
    path: ['code'],
  });

export class CreateGlAccountDto extends createZodDto(CreateGlAccountSchema) {}

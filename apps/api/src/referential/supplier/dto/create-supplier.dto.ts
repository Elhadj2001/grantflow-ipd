import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { BIC_REGEX, isValidIban } from '../iban-bic.util';

/** Conventions code fournisseur : 2-32 caractères, MAJ/chiffres/tirets/underscore. */
const CODE_REGEX = /^[A-Z0-9][A-Z0-9_-]{1,31}$/;

export const SUPPLIER_CURRENCIES = ['XOF', 'EUR', 'USD', 'GBP', 'CHF'] as const;
export type SupplierCurrency = (typeof SUPPLIER_CURRENCIES)[number];

export const CreateSupplierSchema = z
  .object({
    code: z.string().regex(CODE_REGEX, 'Code must match /^[A-Z0-9][A-Z0-9_-]{1,31}$/'),
    name: z.string().min(3).max(255),
    /** vatNumber : format dépend du pays ; on ne valide que la longueur. */
    vatNumber: z.string().min(2).max(64).optional(),
    address: z.string().max(512).optional(),
    /** country : code ISO-2 ou nom libre court. */
    country: z.string().min(2).max(64).optional(),
    /**
     * IBAN ISO 13616. Le checksum mod 97 est vérifié par `iban-bic.util.ts` ;
     * on accepte la chaîne avec ou sans espaces (normalisation côté front).
     */
    iban: z
      .string()
      .transform((v) => v.replace(/\s+/g, '').toUpperCase())
      .refine((v) => isValidIban(v), {
        message: 'Invalid IBAN (ISO 13616 checksum failed)',
      })
      .optional(),
    bic: z
      .string()
      .transform((v) => v.replace(/\s+/g, '').toUpperCase())
      .refine((v) => BIC_REGEX.test(v), { message: 'Invalid BIC (ISO 9362)' })
      .optional(),
    bankName: z.string().max(255).optional(),
    paymentTermsDays: z.number().int().min(0).max(120).default(30),
    currencyDefault: z.enum(SUPPLIER_CURRENCIES).default('XOF'),
    riskScore: z.number().int().min(0).max(100).default(0),
  })
  .strict();

export class CreateSupplierDto extends createZodDto(CreateSupplierSchema) {}

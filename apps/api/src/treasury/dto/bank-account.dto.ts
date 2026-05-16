import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { BIC_REGEX, isValidIban } from '../../referential/supplier/iban-bic.util';

/** Code bank account : 2-32 caractères, MAJ/chiffres/tirets/underscore. */
const CODE_REGEX = /^[A-Z0-9][A-Z0-9_-]{1,31}$/;

export const BANK_CURRENCIES = ['XOF', 'EUR', 'USD', 'GBP', 'CHF'] as const;
export type BankCurrency = (typeof BANK_CURRENCIES)[number];

/**
 * Pour `accountNumber` on accepte aussi bien un IBAN qu'un n° interne BCEAO.
 * Si la chaîne ressemble à un IBAN (commence par 2 lettres pays + 2 chiffres),
 * on valide le checksum ; sinon on accepte tel quel (compte CFA interne).
 */
const accountNumberSchema = z
  .string()
  .min(4)
  .max(64)
  .transform((v) => v.replace(/\s+/g, '').toUpperCase())
  .refine((v) => !/^[A-Z]{2}[0-9]{2}/.test(v) || isValidIban(v), {
    message: 'Invalid IBAN format (ISO 13616 checksum failed)',
  });

export const CreateBankAccountSchema = z
  .object({
    code: z.string().regex(CODE_REGEX),
    label: z.string().min(3).max(255),
    accountNumber: accountNumberSchema,
    bic: z
      .string()
      .transform((v) => v.replace(/\s+/g, '').toUpperCase())
      .refine((v) => BIC_REGEX.test(v), { message: 'Invalid BIC (ISO 9362)' })
      .optional(),
    bankName: z.string().min(2).max(255),
    currency: z.enum(BANK_CURRENCIES).default('XOF'),
    /** Doit être un compte SYSCEBNL de classe 5 (banque/caisse). */
    glAccountCode: z.string().min(1).max(16),
  })
  .strict();
export class CreateBankAccountDto extends createZodDto(CreateBankAccountSchema) {}

export const UpdateBankAccountSchema = CreateBankAccountSchema.partial().strict();
export class UpdateBankAccountDto extends createZodDto(UpdateBankAccountSchema) {}

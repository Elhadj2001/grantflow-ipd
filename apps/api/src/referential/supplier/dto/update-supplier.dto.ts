import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { BIC_REGEX, isValidIban } from '../iban-bic.util';
import { SUPPLIER_CURRENCIES } from './create-supplier.dto';

export const UpdateSupplierSchema = z
  .object({
    code: z
      .string()
      .regex(/^[A-Z0-9][A-Z0-9_-]{1,31}$/, 'Code must match regex')
      .optional(),
    name: z.string().min(3).max(255).optional(),
    vatNumber: z.string().min(2).max(64).nullable().optional(),
    address: z.string().max(512).nullable().optional(),
    country: z.string().min(2).max(64).nullable().optional(),
    iban: z
      .string()
      .transform((v) => v.replace(/\s+/g, '').toUpperCase())
      .refine((v) => isValidIban(v), { message: 'Invalid IBAN' })
      .nullable()
      .optional(),
    bic: z
      .string()
      .transform((v) => v.replace(/\s+/g, '').toUpperCase())
      .refine((v) => BIC_REGEX.test(v), { message: 'Invalid BIC' })
      .nullable()
      .optional(),
    bankName: z.string().max(255).nullable().optional(),
    paymentTermsDays: z.number().int().min(0).max(120).optional(),
    currencyDefault: z.enum(SUPPLIER_CURRENCIES).optional(),
    riskScore: z.number().int().min(0).max(100).optional(),
  })
  .strict();

export class UpdateSupplierDto extends createZodDto(UpdateSupplierSchema) {}

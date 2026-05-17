import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

const TEMPLATE_CODE_REGEX = /^[A-Z0-9][A-Z0-9_-]{1,63}$/;
export const REPORT_CURRENCIES = ['XOF', 'EUR', 'USD', 'GBP', 'CHF'] as const;

export const CreateDonorTemplateSchema = z
  .object({
    code: z.string().regex(TEMPLATE_CODE_REGEX),
    name: z.string().min(3).max(255),
    donorId: z.string().uuid().nullable().optional(),
    currency: z.enum(REPORT_CURRENCIES).default('XOF'),
    format: z.record(z.unknown()).default({}),
    /** Categories à créer en même temps (optionnel). */
    categories: z
      .array(
        z.object({
          code: z.string().min(1).max(64),
          label: z.string().min(1).max(255),
          parentCode: z.string().optional(),
          sortOrder: z.number().int().min(0).max(9999).default(0),
        }),
      )
      .max(100)
      .default([]),
  })
  .strict();
export class CreateDonorTemplateDto extends createZodDto(CreateDonorTemplateSchema) {}

export const AddMappingsSchema = z
  .object({
    mappings: z
      .array(
        z.object({
          glAccountCode: z.string().min(1).max(16),
          categoryCode: z.string().min(1).max(64),
          sign: z.union([z.literal(-1), z.literal(1)]).default(1),
        }),
      )
      .min(1)
      .max(500),
  })
  .strict();
export class AddMappingsDto extends createZodDto(AddMappingsSchema) {}

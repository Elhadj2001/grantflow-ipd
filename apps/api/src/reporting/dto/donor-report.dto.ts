import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

const uuid = z.string().uuid();

export const CreateDonorReportSchema = z
  .object({
    grantId: uuid,
    templateId: uuid,
    periodStart: z.coerce.date(),
    periodEnd: z.coerce.date(),
    notes: z.string().max(2000).optional(),
  })
  .strict();
export class CreateDonorReportDto extends createZodDto(CreateDonorReportSchema) {}

export const SendDonorReportSchema = z
  .object({
    /** Référence d'envoi externe (numéro de courrier, ticket bailleur). */
    externalReference: z.string().max(255).optional(),
    notes: z.string().max(1000).optional(),
  })
  .strict();
export class SendDonorReportDto extends createZodDto(SendDonorReportSchema) {}

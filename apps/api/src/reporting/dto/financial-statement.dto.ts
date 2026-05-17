import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const StatementTypeSchema = z.enum(['TER', 'BILAN', 'RESULTAT']);
export type StatementTypeInput = z.infer<typeof StatementTypeSchema>;

export const CreateFinancialStatementSchema = z
  .object({
    periodId: z.string().uuid(),
    type: StatementTypeSchema,
  })
  .strict();
export class CreateFinancialStatementDto extends createZodDto(CreateFinancialStatementSchema) {}

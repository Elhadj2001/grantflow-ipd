import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/**
 * Création d'une Note Technique (ADR-006). Toujours créée en `draft` :
 * le statut N'EST PAS dans le DTO (le workflow GO→DAF→activation est
 * l'objet de Sprint S5). `ownFundsContributionXof` en XOF (entier).
 */
export const CreateNoteTechniqueSchema = z
  .object({
    grantId: z.string().uuid(),
    budgetCode: z.string().min(1).max(64),
    reportingFinalDate: z.coerce.date(),
    reportingIntermediateDates: z.array(z.coerce.date()).optional().default([]),
    ownFundsContributionXof: z.number().int().min(0).optional().default(0),
    ownFundsContributionCurrency: z.string().length(3).optional(),
    overheadRuleId: z.string().uuid().optional(),
    singleActorAuthorized: z.boolean().optional().default(false),
    singleActorJustification: z.string().optional(),
    notes: z.string().optional(),
  })
  .strict();

export class CreateNoteTechniqueDto extends createZodDto(CreateNoteTechniqueSchema) {}

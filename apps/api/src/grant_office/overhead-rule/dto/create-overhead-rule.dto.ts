import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/**
 * Création d'une règle d'overhead (ADR-006). `defaultRate` est un taux
 * fractionnaire ∈ [0, 1] (0.15 = 15 %). Les flags `appliesTo*` indiquent
 * sur quelles catégories de dépense l'overhead s'applique.
 */
export const CreateOverheadRuleSchema = z
  .object({
    name: z.string().min(1).max(128),
    defaultRate: z.number().min(0).max(1),
    appliesToSubcontracting: z.boolean().optional().default(true),
    appliesToEquipment: z.boolean().optional().default(true),
    appliesToPersonnel: z.boolean().optional().default(true),
    appliesToMissions: z.boolean().optional().default(true),
    appliesToConsumables: z.boolean().optional().default(true),
  })
  .strict();

export class CreateOverheadRuleDto extends createZodDto(CreateOverheadRuleSchema) {}

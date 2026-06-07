import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/**
 * Corps de la requête de rejet DAF d'une Note Technique (US-052, ADR-006).
 * Le motif (≥ 20 caractères) est obligatoire pour tracer la demande de
 * correction — il est journalisé par le service (aucune colonne dédiée au
 * DDL US-030). La validation structurelle est faite ici par Zod (→ 400) ;
 * la cohérence métier (≥ 20) est doublée côté service (US-051).
 */
export const RejectNoteTechniqueSchema = z.object({
  reason: z
    .string()
    .min(20, 'Le motif de rejet doit contenir au moins 20 caractères.')
    .max(2000, 'Le motif de rejet ne doit pas dépasser 2000 caractères.'),
});

export class RejectNoteTechniqueDto extends createZodDto(RejectNoteTechniqueSchema) {}

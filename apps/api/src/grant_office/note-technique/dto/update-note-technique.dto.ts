import { createZodDto } from 'nestjs-zod';
import { CreateNoteTechniqueSchema } from './create-note-technique.dto';

/**
 * Mise à jour partielle d'une Note Technique en `draft`. `grantId` n'est
 * pas modifiable (rattachement convention figé) ; le statut non plus
 * (transitions = Sprint S5).
 */
export const UpdateNoteTechniqueSchema = CreateNoteTechniqueSchema.omit({ grantId: true }).partial();

export class UpdateNoteTechniqueDto extends createZodDto(UpdateNoteTechniqueSchema) {}

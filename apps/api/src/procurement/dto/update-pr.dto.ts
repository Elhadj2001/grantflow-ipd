import { createZodDto } from 'nestjs-zod';
import { CreatePurchaseRequestObjectSchema } from './create-pr.dto';

/**
 * PATCH — tous les champs optionnels. La couche service vérifie en plus
 * que la DA est en `draft` ET appartient bien à l'utilisateur (sauf SUPER_ADMIN).
 *
 * Pour replacer la liste des lignes, on passe `lines` complète — le service
 * fait un `deleteMany` + `createMany` dans une transaction.
 *
 * NB : on dérive du schéma "objet" non-raffiné car `.partial()` n'est pas
 * disponible sur `ZodEffects` (résultat du superRefine de create).
 */
export const UpdatePurchaseRequestSchema = CreatePurchaseRequestObjectSchema.partial();

export class UpdatePurchaseRequestDto extends createZodDto(UpdatePurchaseRequestSchema) {}

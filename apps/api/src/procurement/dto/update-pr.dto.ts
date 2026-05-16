import { createZodDto } from 'nestjs-zod';
import { CreatePurchaseRequestSchema } from './create-pr.dto';

/**
 * PATCH — tous les champs optionnels. La couche service vérifie en plus
 * que la DA est en `draft` ET appartient bien à l'utilisateur (sauf SUPER_ADMIN).
 *
 * Pour replacer la liste des lignes, on passe `lines` complète — le service
 * fait un `deleteMany` + `createMany` dans une transaction.
 */
export const UpdatePurchaseRequestSchema = CreatePurchaseRequestSchema.partial();

export class UpdatePurchaseRequestDto extends createZodDto(UpdatePurchaseRequestSchema) {}

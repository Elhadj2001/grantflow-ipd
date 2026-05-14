import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/**
 * DTO de création d'une Demande d'Achat.
 *
 * Règles métier validées ici (forme), les règles de droits et de budget
 * sont vérifiées côté service (PurchaseRequestService.create).
 */
export const CreatePurchaseRequestSchema = z.object({
  neededBy: z.coerce.date().optional(),
  description: z.string().min(5, 'La description doit faire au moins 5 caractères.'),

  projectId: z.string().uuid(),
  grantId: z.string().uuid(),
  costCenterId: z.string().uuid().optional(),
  activityId: z.string().uuid().optional(),

  currency: z.string().length(3).default('XOF'),

  lines: z.array(z.object({
    description: z.string().min(2),
    quantity: z.number().positive(),
    unit: z.string().min(1).default('unit'),
    unitPrice: z.number().nonnegative(),
    budgetLineId: z.string().uuid(),
  })).min(1, 'Au moins une ligne est requise.'),
});

export class CreatePurchaseRequestDto extends createZodDto(CreatePurchaseRequestSchema) {}

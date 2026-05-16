import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/** Aligné sur enum Postgres `procurement.pr_type`. */
export const PR_REQUEST_TYPES = ['standard', 'petty_cash', 'cash_advance'] as const;
export type PrRequestTypeLiteral = (typeof PR_REQUEST_TYPES)[number];

/**
 * DTO de création d'une Demande d'Achat.
 *
 * Règles métier validées ici (forme), les règles de droits et de budget
 * sont vérifiées côté service (PurchaseRequestService.create).
 */
/**
 * Forme "objet" du schéma — exportée pour permettre aux autres DTO (update)
 * d'appeler `.partial()` dessus (impossible sur `ZodEffects` retourné par
 * `superRefine`).
 */
export const CreatePurchaseRequestObjectSchema = z.object({
  neededBy: z.coerce.date().optional(),
  description: z.string().min(5, 'La description doit faire au moins 5 caractères.'),

  projectId: z.string().uuid(),
  grantId: z.string().uuid(),
  costCenterId: z.string().uuid().optional(),
  activityId: z.string().uuid().optional(),

  currency: z.string().length(3).default('XOF'),

  /**
   * Type de DA :
   *  - 'standard'     : workflow PI→CG→DAF (sprint 2.2)
   *  - 'petty_cash'   : 1 étape CAISSIER (sprint 2.3)
   *  - 'cash_advance' : PI → CAISSIER puis settle (sprint 2.3)
   */
  requestType: z.enum(PR_REQUEST_TYPES).default('standard'),

  /**
   * Caisse — OBLIGATOIRE si requestType ∈ {petty_cash, cash_advance}.
   * Le contrôle de présence est dans le `superRefine` ci-dessous : on
   * préfère une 400 Zod uniforme qu'un mélange Zod + service.
   */
  cashBoxId: z.string().uuid().optional(),

  lines: z
    .array(
      z.object({
        description: z.string().min(2),
        quantity: z.number().positive(),
        unit: z.string().min(1).default('unit'),
        unitPrice: z.number().nonnegative(),
        budgetLineId: z.string().uuid(),
      }),
    )
    .min(1, 'Au moins une ligne est requise.'),
});

export const CreatePurchaseRequestSchema = CreatePurchaseRequestObjectSchema.superRefine(
  (val, ctx) => {
    if (
      (val.requestType === 'petty_cash' || val.requestType === 'cash_advance') &&
      !val.cashBoxId
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cashBoxId'],
        message: `cashBoxId is required for request_type "${val.requestType}"`,
      });
    }
  },
);

export class CreatePurchaseRequestDto extends createZodDto(CreatePurchaseRequestSchema) {}

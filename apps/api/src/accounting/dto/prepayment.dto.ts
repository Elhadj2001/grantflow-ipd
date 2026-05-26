import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/**
 * DTO de constatation de régularisation (CCA/PCA) à la clôture.
 *
 * Sprint F5b-a Lot 3 — contrairement aux FNP qui se détectent
 * automatiquement (GR sans facture), les régularisations exigent
 * une saisie explicite par le comptable / CG : c'est lui qui sait
 * quelle facture déjà comptabilisée concerne en partie l'exercice
 * suivant (CCA), ou quel produit reçu doit être reporté (PCA).
 *
 * On accepte une liste — un run = N régularisations groupées dans
 * un seul appel pour fiabiliser l'audit (vs N appels séparés).
 */

export const PrepaymentDirectionSchema = z.enum(['CCA', 'PCA']);
export type PrepaymentDirection = z.infer<typeof PrepaymentDirectionSchema>;

const uuid = z.string().uuid();

/**
 * Une régularisation unitaire.
 *
 *  - CCA : charge constatée d'avance → Débit 476, Crédit `accountCode` (compte de charge)
 *  - PCA : produit constaté d'avance → Débit `accountCode` (compte de produit), Crédit 477
 *
 * `accountCode` est le compte de charge (CCA) ou de produit (PCA) à
 * neutraliser. La validation finale (préfixe 6x / 7x) est faite côté
 * service après lookup.
 */
export const PrepaymentEntrySchema = z
  .object({
    direction: PrepaymentDirectionSchema,
    accountCode: z.string().min(1).max(16),
    amount: z.number().positive().max(1e15),
    grantId: uuid.optional(),
    budgetLineId: uuid.optional(),
    projectId: uuid.optional(),
    costCenterId: uuid.optional(),
    activityId: uuid.optional(),
    /** Libellé court (ex. "Loyer Q1 2027 prépayé"). */
    label: z.string().min(3).max(255),
    /** Référence facture / contrat / OD source — traçabilité audit. */
    sourceReference: z.string().max(64).optional(),
  })
  .strict();
export type PrepaymentEntryInput = z.infer<typeof PrepaymentEntrySchema>;

export const RunPrepaymentsSchema = z
  .object({
    entries: z.array(PrepaymentEntrySchema).min(1).max(100),
  })
  .strict();
export class RunPrepaymentsDto extends createZodDto(RunPrepaymentsSchema) {}

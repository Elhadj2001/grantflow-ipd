import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/**
 * Payload de création d'un BC à partir d'UNE seule DA.
 * Le service vérifie ensuite que la DA est approved et non déjà liée
 * à un BC actif.
 */
export const CreatePoFromPrSchema = z
  .object({
    supplierId: z.string().uuid(),
    incoterm: z.string().min(2).max(32).optional(),
    deliveryAddress: z.string().min(2).max(500).optional(),
    expectedDate: z.coerce.date().optional(),
  })
  .strict();

export class CreatePoFromPrDto extends createZodDto(CreatePoFromPrSchema) {}

/**
 * Payload de consolidation : N DAs → 1 BC.
 *
 * Règles applicatives (vérifiées dans le service) :
 *  - prIds non vide
 *  - toutes les DAs en status='approved'
 *  - toutes du même type (standard uniquement — pas de petty_cash dans un BC)
 *  - même devise
 *  - même supplier visé
 */
export const CreatePoFromMultiplePrsSchema = z
  .object({
    prIds: z.array(z.string().uuid()).min(1, 'Au moins une DA est requise.'),
    supplierId: z.string().uuid(),
    incoterm: z.string().min(2).max(32).optional(),
    deliveryAddress: z.string().min(2).max(500).optional(),
    expectedDate: z.coerce.date().optional(),
  })
  .strict();

export class CreatePoFromMultiplePrsDto extends createZodDto(CreatePoFromMultiplePrsSchema) {}

/**
 * PATCH BC (draft uniquement). Les lignes ne sont pas modifiables ici :
 * pour retoucher les lignes, il faut annuler le BC et en recréer un
 * (préserve la cohérence engagement / réception / facture).
 */
export const UpdatePoSchema = z
  .object({
    incoterm: z.string().min(2).max(32).nullable().optional(),
    deliveryAddress: z.string().min(2).max(500).nullable().optional(),
    expectedDate: z.coerce.date().nullable().optional(),
  })
  .strict();

export class UpdatePoDto extends createZodDto(UpdatePoSchema) {}

export const AcknowledgePoSchema = z
  .object({
    ackRef: z.string().min(1).max(128),
  })
  .strict();

export class AcknowledgePoDto extends createZodDto(AcknowledgePoSchema) {}

export const CancelPoSchema = z
  .object({
    reason: z.string().min(5).max(500),
  })
  .strict();

export class CancelPoDto extends createZodDto(CancelPoSchema) {}

/**
 * Sprint F-INVOICE-SIM — payload du simulateur de facture (mode démo).
 *   - 'download' : renvoie le PDF (l'utilisateur le re-upload → OCR).
 *   - 'inject'   : crée directement une Invoice `captured`.
 */
export const SimulateInvoiceSchema = z
  .object({
    mode: z.enum(['download', 'inject']),
  })
  .strict();

export class SimulateInvoiceDto extends createZodDto(SimulateInvoiceSchema) {}

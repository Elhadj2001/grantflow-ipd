import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/**
 * Création d'un GR à partir d'un PO sent / acknowledged / partially_received.
 * Les lignes sont recopiées du PO avec quantity = 0 — le magasinier saisit
 * ensuite les quantités réellement reçues via PATCH /lines.
 */
export const CreateGrFromPoSchema = z
  .object({
    receiptDate: z.coerce.date().optional(),
    deliveryNoteRef: z.string().min(1).max(128).optional(),
    notes: z.string().max(2000).optional(),
    /**
     * Si true, le module exigera batch + expiry sur les lignes reçues
     * et refusera le `complete` si une ligne a cold_chain_ok=false.
     * Typique pour les réactifs biomédicaux et les vaccins.
     */
    coldChainRequired: z.boolean().optional(),
  })
  .strict();

export class CreateGrFromPoDto extends createZodDto(CreateGrFromPoSchema) {}

/** PATCH header GR (draft uniquement). */
export const UpdateGrSchema = z
  .object({
    receiptDate: z.coerce.date().optional(),
    deliveryNoteRef: z.string().min(1).max(128).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
    coldChainRequired: z.boolean().optional(),
  })
  .strict();

export class UpdateGrDto extends createZodDto(UpdateGrSchema) {}

/**
 * Mise à jour des lignes — payload unitaire répété dans un tableau.
 * `lineId` désigne l'id de la goods_receipt_line (créée par createFromPo).
 *
 * Champs optionnels : ne sont écrasés que s'ils sont fournis (PATCH partiel).
 * `quantity` peut être 0 (ligne non reçue) ou strictement positive (jusqu'à
 * la quantity commandée moins l'historique déjà reçu sur d'autres GR).
 */
export const UpdateGrLineSchema = z
  .object({
    lineId: z.string().uuid(),
    quantity: z.number().nonnegative().optional(),
    batchNumber: z.string().min(1).max(64).nullable().optional(),
    expiryDate: z.coerce.date().nullable().optional(),
    serialNumbers: z.array(z.string().min(1).max(128)).optional(),
    qualityCheck: z.string().max(2000).nullable().optional(),
    coldChainOk: z.boolean().nullable().optional(),
  })
  .strict();

export const UpdateGrLinesSchema = z
  .object({
    lines: z.array(UpdateGrLineSchema).min(1),
  })
  .strict();

export class UpdateGrLinesDto extends createZodDto(UpdateGrLinesSchema) {}

export const CancelGrSchema = z
  .object({
    reason: z.string().min(5).max(500),
  })
  .strict();

export class CancelGrDto extends createZodDto(CancelGrSchema) {}

export const RejectGrSchema = z
  .object({
    reason: z.string().min(5).max(500),
  })
  .strict();

export class RejectGrDto extends createZodDto(RejectGrSchema) {}

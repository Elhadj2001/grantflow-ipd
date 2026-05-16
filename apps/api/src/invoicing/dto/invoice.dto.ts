import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { InvoiceStatus } from '@prisma/client';

/** Ligne de facture pour création manuelle / PATCH. */
const InvoiceLineSchema = z
  .object({
    lineNumber: z.number().int().positive(),
    description: z.string().min(1).max(500),
    quantity: z.number().positive().optional(),
    unitPrice: z.number().nonnegative().optional(),
    lineTotal: z.number().nonnegative(),
    poLineId: z.string().uuid().nullable().optional(),
    taxCodeId: z.string().uuid().nullable().optional(),
    glAccount: z.string().max(16).nullable().optional(),
  })
  .strict();

/**
 * Création manuelle (saisie comptable, sans PDF). Permet d'enregistrer
 * une facture papier reçue au courrier, ou de saisir une facture après
 * coup quand l'OCR a échoué.
 */
export const CreateInvoiceManualSchema = z
  .object({
    invoiceNumber: z.string().min(1).max(64),
    supplierId: z.string().uuid(),
    invoiceDate: z.coerce.date(),
    dueDate: z.coerce.date(),
    currency: z.string().length(3).default('XOF'),
    exchangeRate: z.number().positive().optional(),
    poId: z.string().uuid().nullable().optional(),
    totalHt: z.number().nonnegative(),
    totalVat: z.number().nonnegative().default(0),
    totalTtc: z.number().positive(),
    lines: z.array(InvoiceLineSchema).min(1),
  })
  .strict();

export class CreateInvoiceManualDto extends createZodDto(CreateInvoiceManualSchema) {}

/**
 * PATCH facture — correction du payload capturé. Aucun champ obligatoire,
 * c'est un patch partiel. Les lignes ne sont pas modifiables ici (pour
 * corriger les lignes, reject + recréer).
 */
export const UpdateInvoiceSchema = z
  .object({
    invoiceNumber: z.string().min(1).max(64).optional(),
    invoiceDate: z.coerce.date().optional(),
    dueDate: z.coerce.date().optional(),
    currency: z.string().length(3).optional(),
    exchangeRate: z.number().positive().nullable().optional(),
    poId: z.string().uuid().nullable().optional(),
    supplierId: z.string().uuid().optional(),
    totalHt: z.number().nonnegative().optional(),
    totalVat: z.number().nonnegative().optional(),
    totalTtc: z.number().positive().optional(),
  })
  .strict();

export class UpdateInvoiceDto extends createZodDto(UpdateInvoiceSchema) {}

/** Force-match : reason obligatoire pour audit traçable. */
export const ForceMatchSchema = z
  .object({
    reason: z.string().min(5).max(500),
  })
  .strict();

export class ForceMatchDto extends createZodDto(ForceMatchSchema) {}

/** Rejet facture : reason obligatoire. */
export const RejectInvoiceSchema = z
  .object({
    reason: z.string().min(5).max(500),
  })
  .strict();

export class RejectInvoiceDto extends createZodDto(RejectInvoiceSchema) {}

/** Annulation de comptabilisation (DAF/SUPER_ADMIN) — motif obligatoire. */
export const CancelPostingSchema = z
  .object({
    reason: z.string().min(5).max(500),
  })
  .strict();

export class CancelPostingDto extends createZodDto(CancelPostingSchema) {}

/**
 * Métadonnées optionnelles lors d'un upload PDF. L'OCR remplit le reste,
 * mais le comptable peut pré-déclarer le supplier / PO si visible sur
 * l'enveloppe (utile quand le PDF est dégradé).
 */
export const UploadHintSchema = z
  .object({
    supplierId: z.string().uuid().optional(),
    poId: z.string().uuid().optional(),
  })
  .strict();

export class UploadHintDto extends createZodDto(UploadHintSchema) {}

const coerceInt = (min: number, max: number, def: number) =>
  z
    .union([z.string().regex(/^\d+$/), z.number().int()])
    .transform((v) => (typeof v === 'number' ? v : parseInt(v, 10)))
    .pipe(z.number().int().min(min).max(max))
    .default(def);

export const INVOICE_SORT_FIELDS = ['createdAt', 'invoiceDate', 'dueDate', 'invoiceNumber', 'totalTtc'] as const;

export const InvoiceQuerySchema = z
  .object({
    q: z.string().min(1).max(128).optional(),
    status: z.nativeEnum(InvoiceStatus).optional(),
    supplierId: z.string().uuid().optional(),
    poId: z.string().uuid().optional(),
    fromDate: z.string().optional(),
    toDate: z.string().optional(),
    page: coerceInt(1, 10_000, 1),
    pageSize: coerceInt(1, 100, 20),
    sort: z.enum(INVOICE_SORT_FIELDS).default('createdAt'),
    order: z.enum(['asc', 'desc']).default('desc'),
  })
  .strict();

export class InvoiceQueryDto extends createZodDto(InvoiceQuerySchema) {}

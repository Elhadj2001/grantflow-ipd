import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

const uuid = z.string().uuid();

export const PaymentMethodEnum = z
  .enum(['sepa', 'swift', 'check', 'cash', 'direct_debit'])
  .default('sepa');

export const CreatePaymentRunSchema = z
  .object({
    bankAccountId: uuid,
    /**
     * Devise du run : doit matcher celle du bankAccount. Stockée en double
     * pour traçabilité, mais réconciliée dans le service.
     */
    currency: z.string().length(3).optional(),
    /** Facultatif : si omis, le run prend la date du jour. */
    paymentDate: z.coerce.date().optional(),
    /** Méthode par défaut pour tous les paiements créés ici. */
    method: PaymentMethodEnum,
    /** Liste des factures à inclure dans le run (au moins 1). */
    invoiceIds: z.array(uuid).min(1).max(500),
  })
  .strict();
export class CreatePaymentRunDto extends createZodDto(CreatePaymentRunSchema) {}

export const AddInvoicesToRunSchema = z
  .object({
    invoiceIds: z.array(uuid).min(1).max(500),
  })
  .strict();
export class AddInvoicesToRunDto extends createZodDto(AddInvoicesToRunSchema) {}

export const RemoveInvoicesFromRunSchema = z
  .object({
    paymentIds: z.array(uuid).min(1).max(500),
  })
  .strict();
export class RemoveInvoicesFromRunDto extends createZodDto(RemoveInvoicesFromRunSchema) {}

export const ApprovePaymentRunSchema = z
  .object({
    comment: z.string().max(500).optional(),
  })
  .strict();
export class ApprovePaymentRunDto extends createZodDto(ApprovePaymentRunSchema) {}

export const RejectPaymentRunSchema = z
  .object({
    reason: z.string().min(5).max(500),
  })
  .strict();
export class RejectPaymentRunDto extends createZodDto(RejectPaymentRunSchema) {}

export const CancelPaymentRunSchema = z
  .object({
    reason: z.string().min(5).max(500),
  })
  .strict();
export class CancelPaymentRunDto extends createZodDto(CancelPaymentRunSchema) {}

/** Sprint F4a — acknowledge des alertes IBAN par le DAF, motif obligatoire. */
export const AcknowledgeIbanAlertsSchema = z
  .object({
    reason: z.string().min(5).max(500),
    /**
     * Confirmation explicite que le DAF a vérifié l'identité du
     * bénéficiaire par un canal indépendant (téléphone). Sert d'audit
     * trail visuel — pas de réelle vérif automatique possible.
     */
    identityVerified: z.boolean().default(false),
  })
  .strict();
export class AcknowledgeIbanAlertsDto extends createZodDto(AcknowledgeIbanAlertsSchema) {}

/**
 * Liste des statuts d'un `payment_run`.
 *
 * ⚠️ Contrairement à PR/PO/GR/Invoice qui utilisent `z.nativeEnum(<PrismaEnum>)`,
 * ici la colonne `ap.payment_run.status` est `TEXT` au DDL — il n'existe PAS
 * d'enum Postgres `payment_run_status`. Prisma la mappe en `String`, donc on
 * doit maintenir un tuple littéral.
 *
 * En contrepartie, le test sentinelle
 * `__tests__/payment-run-status-alignment.spec.ts` fige le contrat :
 * tout statut effectivement écrit par `payment-run.service.ts` doit parser
 * OK ici. Si quelqu'un ajoute `'approved'` / `'sent'` côté service sans
 * mettre cette liste à jour, le test casse — c'est exactement la régression
 * qu'on évite (cf. bug `pending_caissier` sur PR avant le fix
 * `fix-pr-status-enum-alignment`).
 */
export const PAYMENT_RUN_STATUSES = [
  'draft',
  'prepared',
  'executed',
  'rejected',
  'cancelled',
] as const;

export const PaymentRunQuerySchema = z
  .object({
    status: z.enum(PAYMENT_RUN_STATUSES).optional(),
    bankAccountId: uuid.optional(),
    fromDate: z.coerce.date().optional(),
    toDate: z.coerce.date().optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    sort: z.enum(['runDate', 'runNumber', 'createdAt', 'totalAmount']).default('runDate'),
    order: z.enum(['asc', 'desc']).default('desc'),
  })
  .strict();
export class PaymentRunQueryDto extends createZodDto(PaymentRunQuerySchema) {}

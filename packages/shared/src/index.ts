/**
 * @grantflow/shared
 *
 * Types et schémas Zod partagés entre apps/web et apps/api.
 * Tout type ou DTO utilisé des deux côtés doit être défini ici.
 */
import { z } from 'zod';

// ============ ÉNUMS ============
// Les valeurs sont alignées sur les types PostgreSQL définis dans docs/grantflow_ddl_postgresql.sql
// IMPORTANT : valeurs en lowercase pour matcher les enums PostgreSQL et le schema.prisma.

export const PrStatus = z.enum([
  'draft', 'submitted', 'pending_pi', 'pending_cg', 'pending_daf',
  'approved', 'rejected', 'cancelled', 'closed',
]);
export type PrStatus = z.infer<typeof PrStatus>;

export const PoStatus = z.enum([
  'draft', 'sent', 'acknowledged', 'partially_received', 'received',
  'invoiced', 'closed', 'cancelled',
]);
export type PoStatus = z.infer<typeof PoStatus>;

export const InvoiceStatus = z.enum([
  'captured', 'matching', 'exception_price', 'exception_qty', 'matched',
  'pending_validation', 'posted', 'partially_paid', 'paid', 'rejected', 'archived',
]);
export type InvoiceStatus = z.infer<typeof InvoiceStatus>;

export const Currency = z.enum(['XOF', 'EUR', 'USD', 'GBP', 'CHF']);
export type Currency = z.infer<typeof Currency>;

// ============ DTOs partagés ============
export const PurchaseRequestLineDto = z.object({
  description: z.string().min(2),
  quantity: z.number().positive(),
  unit: z.string().default('unit'),
  unitPrice: z.number().nonnegative(),
  budgetLineId: z.string().uuid(),
});

export const CreatePurchaseRequestDto = z.object({
  neededBy: z.coerce.date().optional(),
  description: z.string().min(5),
  projectId: z.string().uuid(),
  grantId: z.string().uuid(),
  costCenterId: z.string().uuid().optional(),
  activityId: z.string().uuid().optional(),
  currency: Currency.default('XOF'),
  lines: z.array(PurchaseRequestLineDto).min(1),
});
export type CreatePurchaseRequestDto = z.infer<typeof CreatePurchaseRequestDto>;

// ============ Helpers ============
export function formatXof(amount: number): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(amount) + ' XOF';
}

export function formatCurrency(amount: number, currency: Currency = 'XOF'): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(amount);
}

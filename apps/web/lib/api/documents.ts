import { apiFetch, type ApiFetchOptions } from '@/lib/api-client';

/**
 * US-069 — documents archivés d'une entité (panneau Documents généralisé).
 * Miroir du type API `EntityDocument` (dérivé des métadonnées existantes,
 * pas de table dédiée).
 */
export interface EntityDocument {
  objectKey: string;
  label: string;
  kind: 'invoice_pdf' | 'po_pdf';
  contentType: string;
  /** null = stockage indisponible au moment du listing (best-effort). */
  sizeBytes: number | null;
  storedAt: string | null;
  /** Chemin API relatif pour l'aperçu / le téléchargement (flux blob). */
  downloadPath: string;
}

export function listInvoiceDocuments(invoiceId: string, options: ApiFetchOptions = {}) {
  return apiFetch<EntityDocument[]>(`/invoices/${invoiceId}/documents`, options);
}

export function listPoDocuments(poId: string, options: ApiFetchOptions = {}) {
  return apiFetch<EntityDocument[]>(`/purchase-orders/${poId}/documents`, options);
}

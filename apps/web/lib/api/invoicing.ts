import { apiFetch, type ApiFetchOptions } from '../api-client';

/**
 * Client API typé pour le module facturation (apps/api/src/invoicing/).
 *
 * Endpoints couverts :
 *  - POST  /invoices/upload         — upload PDF multipart + OCR sync
 *  - POST  /invoices                — création manuelle
 *  - GET   /invoices                — liste paginée + filtres
 *  - GET   /invoices/:id            — détail + lignes
 *  - GET   /invoices/:id/match-details — détail rapprochement
 *  - GET   /invoices/:id/pdf        — stream PDF (flux blob DocumentViewer, US-069)
 *  - GET   /invoices/:id/documents  — listing documents (DocumentsPanel, US-069)
 *  - PATCH /invoices/:id            — correction (statuts captured/exception)
 *  - POST  /invoices/:id/submit     — lance le matching 3-way
 *  - POST  /invoices/:id/force-match (DAF) — bypass exception + reason
 *  - POST  /invoices/:id/reject     — rejet + reason
 *  - POST  /invoices/:id/post       — comptabilisation
 *  - POST  /invoices/:id/cancel-posting (DAF) — extourne + reason
 *  - GET   /invoices/:id/journal-entries — AC + extournes classe 8
 */

// =====================================================================
//  Types — statuts & enums
// =====================================================================

export type InvoiceStatus =
  | 'captured'
  | 'matched'
  | 'exception_price'
  | 'exception_qty'
  | 'posted'
  | 'rejected'
  | 'archived'
  | 'paid';

export type MatchResult =
  | 'OK'
  | 'EXCEPTION_PRICE'
  | 'EXCEPTION_QTY'
  | 'UNMATCHED_INVOICE_LINE';

// =====================================================================
//  Types — entités
// =====================================================================

export interface InvoiceLine {
  id: string;
  lineNumber: number;
  description: string;
  quantity: number | string | null;
  unitPrice: number | string | null;
  lineTotal: number | string;
  poLineId: string | null;
  taxCodeId: string | null;
  glAccount: string | null;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  supplierId: string;
  invoiceDate: string;
  dueDate: string;
  totalHt: string;
  totalVat: string;
  totalTtc: string;
  currency: string;
  // US-068 (ADR-005) : équivalents XOF stockés (colonnes snake exposées
  // telles quelles par Prisma) — infobulle XOF, aucun recalcul front.
  total_ht_xof?: string | number | null;
  total_vat_xof?: string | number | null;
  total_ttc_xof?: string | number | null;
  exchangeRate: string | null;
  poId: string | null;
  status: InvoiceStatus;
  ocrConfidence: number | null;
  pdfObjectKey: string | null;
  capturedPayload: Record<string, unknown> | null;
  matchSummary: Record<string, unknown> | null;
  matchedAt: string | null;
  matchedBy: string | null;
  postedAt: string | null;
  postedBy: string | null;
  rejectedAt: string | null;
  rejectedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceWithLines extends Invoice {
  lines: InvoiceLine[];
}

// =====================================================================
//  Types — OCR
// =====================================================================

export interface OcrFields {
  invoiceNumber?: string;
  invoiceDate?: string;
  dueDate?: string;
  totalHt?: number;
  totalVat?: number;
  totalTtc?: number;
  currency?: string;
  poReference?: string;
  supplierName?: string;
  supplierId?: string;
  lines?: Array<{ description: string; quantity?: number; unitPrice?: number; lineTotal: number }>;
}

export interface OcrResult {
  confidence: number;
  isImageScan: boolean;
  fields: OcrFields;
  fieldConfidence: Record<string, number>;
}

export interface UploadResult {
  invoiceId: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  pdfObjectKey: string;
  ocr: OcrResult;
  invoice: InvoiceWithLines;
}

// =====================================================================
//  Types — Matching
// =====================================================================

export interface InvoiceLineMatchDetail {
  invoiceLineId: string;
  invoiceLineNumber: number;
  poLineId: string | null;
  qtyInvoiced: number;
  qtyReceived: number;
  qtyOrdered: number;
  priceInvoiced: number;
  priceOrdered: number;
  priceVariancePct: number;
  qtyVariancePct: number;
  result: MatchResult;
  message?: string;
}

export interface MatchSummary {
  totalLinesMatched: number;
  totalLinesException: number;
  priceVarianceMax: number;
  qtyVarianceMax: number;
  priceTolerancePct: number;
  qtyTolerancePct: number;
  details: InvoiceLineMatchDetail[];
  forcedMatch?: {
    forcedBy: string;
    forcedAt: string;
    reason: string;
    previousStatus: InvoiceStatus;
  };
}

export interface MatchOutcome {
  invoiceId: string;
  newStatus: InvoiceStatus;
  summary: MatchSummary;
}

export interface SubmitResult {
  invoice: Invoice;
  outcome: MatchOutcome;
}

// =====================================================================
//  Types — Journal entries
// =====================================================================

export interface JournalLine {
  id: string;
  lineNumber: number;
  accountCode: string;
  label: string | null;
  debit: string;
  credit: string;
  currency: string;
  debitCurrency: string | null;
  creditCurrency: string | null;
  /** Taux figé à l'écriture (colonne snake exposée telle quelle par Prisma). */
  fx_rate?: string | null;
  projectId: string | null;
  grantId: string | null;
  budgetLineId: string | null;
  costCenterId: string | null;
  activityId: string | null;
}

export interface JournalEntry {
  id: string;
  entryNumber: string;
  journal: string;
  entryDate: string;
  label: string | null;
  status: 'draft' | 'posted' | 'reversed';
  sourceType: string | null;
  sourceId: string | null;
  postedAt: string | null;
  postedBy: string | null;
  reversedById: string | null;
  createdAt: string;
  lines: JournalLine[];
}

export interface JournalEntriesResponse {
  acEntries: JournalEntry[];
  class8Reversals: JournalEntry[];
}

// =====================================================================
//  Types — Posting / Cancel
// =====================================================================

export interface PostInvoiceResult {
  invoice: Invoice;
  acEntry: JournalEntry;
  class8Reversal: JournalEntry | null;
  exchangeRate: number | null;
  totalTtcXof: number;
}

// =====================================================================
//  Types — Queries & inputs
// =====================================================================

export interface ListInvoicesQuery {
  q?: string;
  status?: InvoiceStatus;
  supplierId?: string;
  poId?: string;
  fromDate?: string;
  toDate?: string;
  page?: number;
  pageSize?: number;
  sort?: 'createdAt' | 'invoiceDate' | 'dueDate' | 'invoiceNumber' | 'totalTtc';
  order?: 'asc' | 'desc';
}

export interface ListResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface UpdateInvoiceInput {
  invoiceNumber?: string;
  invoiceDate?: string;
  dueDate?: string;
  currency?: string;
  exchangeRate?: number | null;
  poId?: string | null;
  supplierId?: string;
  totalHt?: number;
  totalVat?: number;
  totalTtc?: number;
}

// =====================================================================
//  Helpers
// =====================================================================

function qs(params: object): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    usp.set(k, String(v));
  }
  const s = usp.toString();
  return s ? `?${s}` : '';
}

type FetchOpts = Pick<ApiFetchOptions, 'accessToken'>;

// =====================================================================
//  API calls
// =====================================================================

export async function listInvoices(
  query: ListInvoicesQuery = {},
  opts: FetchOpts = {},
): Promise<ListResponse<Invoice>> {
  return apiFetch<ListResponse<Invoice>>(`/invoices${qs(query)}`, opts);
}

export async function getInvoice(
  id: string,
  opts: FetchOpts = {},
): Promise<InvoiceWithLines> {
  return apiFetch<InvoiceWithLines>(`/invoices/${id}`, opts);
}

export async function getInvoiceMatchDetails(
  id: string,
  opts: FetchOpts = {},
): Promise<{ invoice: InvoiceWithLines; matches: unknown[]; summary: MatchSummary | null }> {
  return apiFetch(`/invoices/${id}/match-details`, opts);
}

export async function listInvoiceJournalEntries(
  id: string,
  opts: FetchOpts = {},
): Promise<JournalEntriesResponse> {
  return apiFetch<JournalEntriesResponse>(`/invoices/${id}/journal-entries`, opts);
}

/**
 * Upload PDF facture (multipart/form-data). Différent des autres calls
 * — on ne peut pas passer par apiFetch (qui force JSON). Fait l'XHR
 * directement pour supporter onUploadProgress.
 */
export interface UploadProgressInfo {
  loaded: number;
  total: number;
  pct: number;
}

export interface UploadOptions {
  accessToken?: string | null;
  supplierId?: string;
  poId?: string;
  onProgress?: (info: UploadProgressInfo) => void;
}

export async function uploadInvoice(
  file: File,
  options: UploadOptions = {},
): Promise<UploadResult> {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
  const url = `${baseUrl}/invoices/upload`;

  const form = new FormData();
  form.append('file', file);
  if (options.supplierId) form.append('supplierId', options.supplierId);
  if (options.poId) form.append('poId', options.poId);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    if (options.accessToken) {
      xhr.setRequestHeader('Authorization', `Bearer ${options.accessToken}`);
    }
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && options.onProgress) {
        options.onProgress({
          loaded: e.loaded,
          total: e.total,
          pct: Math.round((e.loaded / e.total) * 100),
        });
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch (err) {
          reject(new Error('Réponse upload non parsable'));
        }
      } else {
        let body: { code?: string; message?: string } = {};
        try {
          body = JSON.parse(xhr.responseText);
        } catch {
          /* noop */
        }
        const err = new Error(body.message ?? `HTTP ${xhr.status}`) as Error & {
          status: number;
          body: typeof body;
        };
        err.status = xhr.status;
        err.body = body;
        reject(err);
      }
    };
    xhr.onerror = () => reject(new Error('Erreur réseau lors de l\'upload'));
    xhr.send(form);
  });
}

export async function updateInvoice(
  id: string,
  input: UpdateInvoiceInput,
  opts: FetchOpts = {},
): Promise<InvoiceWithLines> {
  return apiFetch<InvoiceWithLines>(`/invoices/${id}`, {
    ...opts,
    method: 'PATCH',
    json: input,
  });
}

export async function submitInvoice(
  id: string,
  opts: FetchOpts = {},
): Promise<SubmitResult> {
  return apiFetch<SubmitResult>(`/invoices/${id}/submit`, {
    ...opts,
    method: 'POST',
  });
}

export async function forceMatchInvoice(
  id: string,
  reason: string,
  opts: FetchOpts = {},
): Promise<Invoice> {
  return apiFetch<Invoice>(`/invoices/${id}/force-match`, {
    ...opts,
    method: 'POST',
    json: { reason },
  });
}

export async function rejectInvoice(
  id: string,
  reason: string,
  opts: FetchOpts = {},
): Promise<Invoice> {
  return apiFetch<Invoice>(`/invoices/${id}/reject`, {
    ...opts,
    method: 'POST',
    json: { reason },
  });
}

export async function postInvoice(
  id: string,
  opts: FetchOpts = {},
): Promise<PostInvoiceResult> {
  return apiFetch<PostInvoiceResult>(`/invoices/${id}/post`, {
    ...opts,
    method: 'POST',
  });
}

export async function cancelPosting(
  id: string,
  reason: string,
  opts: FetchOpts = {},
): Promise<unknown> {
  return apiFetch(`/invoices/${id}/cancel-posting`, {
    ...opts,
    method: 'POST',
    json: { reason },
  });
}

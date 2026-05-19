import { apiFetch, type ApiFetchOptions } from '../api-client';

/**
 * Client API typé pour le module Trésorerie (apps/api/src/treasury/).
 *
 * Endpoints couverts (sprint 5.1 + F4a) :
 *  - BankAccount : GET /bank-accounts, GET /bank-accounts/:id
 *  - PaymentRun : list, detail, payments, journal-entries, create, addInvoices,
 *    removeInvoices, prepare, approve, reject, cancel
 *  - F4a : iban-alerts, acknowledge-iban-alerts, generate-sepa, sepa download,
 *    mark-sepa-sent
 */

// =====================================================================
//  Enums & statuses
// =====================================================================

export type PaymentRunStatus = 'draft' | 'prepared' | 'executed' | 'rejected' | 'cancelled';
export type PaymentStatus = 'queued' | 'prepared' | 'executed' | 'failed' | 'reconciled' | 'cancelled';
export type PaymentMethod = 'sepa' | 'swift' | 'check' | 'cash' | 'direct_debit';

// =====================================================================
//  BankAccount
// =====================================================================

export interface BankAccount {
  id: string;
  code: string;
  label: string;
  accountNumber: string;
  bic: string | null;
  bankName: string;
  currency: string;
  glAccountCode: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// =====================================================================
//  PaymentRun + Payment
// =====================================================================

export interface IbanAlert {
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  currentIban: string;
  previousIban: string | null;
  changedAt: string;
  daysSinceChange: number;
  changedBy: string | null;
  acknowledged: boolean;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  acknowledgeReason: string | null;
}

export interface PreparationWarning {
  paymentId: string;
  invoiceId: string;
  supplierCode: string;
  warning: string;
}

export interface Payment {
  id: string;
  paymentRunId: string | null;
  invoiceId: string;
  amount: string;
  currency: string;
  originalAmount: string | null;
  originalCurrency: string | null;
  exchangeRate: string | null;
  method: PaymentMethod;
  paymentDate: string;
  status: PaymentStatus;
  bankReference: string | null;
  fxGainLoss: string | null;
  createdAt: string;
}

export interface PaymentWithInvoice extends Payment {
  invoice: {
    id: string;
    invoiceNumber: string;
    totalTtc: string;
    currency?: string;
    status?: string;
  };
}

export interface PaymentRun {
  id: string;
  runNumber: string;
  runDate: string;
  currency: string;
  bankAccountId: string | null;
  preparedBy: string | null;
  approvedBy: string | null;
  totalAmount: string;
  status: PaymentRunStatus;
  sepaFileKey: string | null;
  /** Présent après generate-sepa (sprint F4a). */
  sepaGeneratedAt: string | null;
  sepaSentAt: string | null;
  preparationWarnings: PreparationWarning[] | null;
  ibanAlerts: IbanAlert[] | null;
  rejectionReason: string | null;
  approvedAt: string | null;
  executedAt: string | null;
  createdAt: string;
}

export interface PaymentRunWithPayments extends PaymentRun {
  payments: PaymentWithInvoice[];
}

// =====================================================================
//  Queries & inputs
// =====================================================================

export interface ListPaymentRunsQuery {
  status?: PaymentRunStatus;
  bankAccountId?: string;
  fromDate?: string;
  toDate?: string;
  page?: number;
  pageSize?: number;
  sort?: 'runDate' | 'runNumber' | 'createdAt' | 'totalAmount';
  order?: 'asc' | 'desc';
}

export interface ListResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface CreatePaymentRunInput {
  bankAccountId: string;
  currency?: string;
  paymentDate?: string;
  method: PaymentMethod;
  invoiceIds: string[];
}

export interface AcknowledgeIbanAlertsInput {
  reason: string;
  identityVerified?: boolean;
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
//  BankAccount API
// =====================================================================

export async function listBankAccounts(opts: FetchOpts = {}): Promise<BankAccount[]> {
  return apiFetch<BankAccount[]>('/bank-accounts', opts);
}

export async function getBankAccount(id: string, opts: FetchOpts = {}): Promise<BankAccount> {
  return apiFetch<BankAccount>(`/bank-accounts/${id}`, opts);
}

// =====================================================================
//  PaymentRun API
// =====================================================================

export async function listPaymentRuns(
  query: ListPaymentRunsQuery = {},
  opts: FetchOpts = {},
): Promise<ListResponse<PaymentRun>> {
  return apiFetch<ListResponse<PaymentRun>>(`/payment-runs${qs(query)}`, opts);
}

export async function getPaymentRun(
  id: string,
  opts: FetchOpts = {},
): Promise<PaymentRunWithPayments> {
  return apiFetch<PaymentRunWithPayments>(`/payment-runs/${id}`, opts);
}

export async function listPaymentRunPayments(
  id: string,
  opts: FetchOpts = {},
): Promise<PaymentWithInvoice[]> {
  return apiFetch<PaymentWithInvoice[]>(`/payment-runs/${id}/payments`, opts);
}

export async function createPaymentRun(
  input: CreatePaymentRunInput,
  opts: FetchOpts = {},
): Promise<PaymentRunWithPayments> {
  return apiFetch<PaymentRunWithPayments>('/payment-runs', {
    ...opts,
    method: 'POST',
    json: input,
  });
}

export async function preparePaymentRun(
  id: string,
  opts: FetchOpts = {},
): Promise<PaymentRun> {
  return apiFetch<PaymentRun>(`/payment-runs/${id}/prepare`, { ...opts, method: 'POST' });
}

export async function approvePaymentRun(
  id: string,
  comment: string | undefined,
  opts: FetchOpts = {},
): Promise<PaymentRun> {
  return apiFetch<PaymentRun>(`/payment-runs/${id}/approve`, {
    ...opts,
    method: 'POST',
    json: { comment },
  });
}

export async function rejectPaymentRun(
  id: string,
  reason: string,
  opts: FetchOpts = {},
): Promise<PaymentRun> {
  return apiFetch<PaymentRun>(`/payment-runs/${id}/reject`, {
    ...opts,
    method: 'POST',
    json: { reason },
  });
}

export async function cancelPaymentRun(
  id: string,
  reason: string,
  opts: FetchOpts = {},
): Promise<PaymentRun> {
  return apiFetch<PaymentRun>(`/payment-runs/${id}/cancel`, {
    ...opts,
    method: 'POST',
    json: { reason },
  });
}

// =====================================================================
//  Sprint F4a — anti-fraude IBAN
// =====================================================================

export async function listIbanAlerts(
  id: string,
  opts: FetchOpts = {},
): Promise<IbanAlert[]> {
  return apiFetch<IbanAlert[]>(`/payment-runs/${id}/iban-alerts`, opts);
}

export async function acknowledgeIbanAlerts(
  id: string,
  input: AcknowledgeIbanAlertsInput,
  opts: FetchOpts = {},
): Promise<PaymentRun> {
  return apiFetch<PaymentRun>(`/payment-runs/${id}/acknowledge-iban-alerts`, {
    ...opts,
    method: 'POST',
    json: input,
  });
}

// =====================================================================
//  Sprint F4a — SEPA
// =====================================================================

export async function generateSepa(
  id: string,
  opts: FetchOpts = {},
): Promise<{ runNumber: string; generatedAt: string; size: number }> {
  return apiFetch(`/payment-runs/${id}/generate-sepa`, { ...opts, method: 'POST' });
}

/** Récupère le XML SEPA en text brut (le caller en fait un blob pour download). */
export async function downloadSepaXml(
  id: string,
  opts: FetchOpts = {},
): Promise<string> {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
  const res = await fetch(`${baseUrl}/payment-runs/${id}/sepa`, {
    headers: opts.accessToken
      ? { Authorization: `Bearer ${opts.accessToken}` }
      : undefined,
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} — SEPA download failed`);
  }
  return res.text();
}

export async function markSepaSent(
  id: string,
  opts: FetchOpts = {},
): Promise<PaymentRun> {
  return apiFetch<PaymentRun>(`/payment-runs/${id}/mark-sepa-sent`, {
    ...opts,
    method: 'POST',
  });
}

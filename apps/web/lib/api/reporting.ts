import { apiFetch, type ApiFetchOptions } from '../api-client';

/**
 * Client API typé pour le module Reporting bailleur (apps/api/src/reporting/).
 *
 * Sprint F5a — endpoints couverts :
 *   - Templates  : list, detail, create, addMappings (upsert)
 *   - Reports    : list, detail, create, lock, send, download PDF/Excel
 *
 * Limitations connues du backend (cf. F5a-C0 exploration) :
 *   - Pas de PATCH ni DELETE sur les templates
 *   - Pas d'ajout/suppression de catégorie après création (seuls les mappings
 *     peuvent être modifiés via /templates/:id/mappings — upsert)
 *   - Pas de DELETE sur donor-reports (seul lock + send disponibles)
 */

type FetchOpts = Pick<ApiFetchOptions, 'accessToken'>;

// =====================================================================
//  Types
// =====================================================================

export type DonorReportStatus = 'draft' | 'locked' | 'sent';

export const REPORT_CURRENCIES = ['XOF', 'EUR', 'USD', 'GBP', 'CHF'] as const;
export type ReportCurrency = (typeof REPORT_CURRENCIES)[number];

export interface DonorTemplateSummary {
  id: string;
  code: string;
  name: string;
  donorId: string | null;
  currency: string;
  format: Record<string, unknown>;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  donor: { code: string; label: string } | null;
  _count: { categories: number; mappings: number };
}

export interface DonorCategory {
  id: string;
  templateId: string;
  code: string;
  label: string;
  parentId: string | null;
  sortOrder: number;
}

export interface AccountMapping {
  id: string;
  templateId: string;
  glAccountCode: string;
  donorCategoryId: string;
  sign: 1 | -1;
}

export interface DonorTemplateDetail extends Omit<DonorTemplateSummary, '_count' | 'donor'> {
  donor: { id: string; code: string; label: string; type: string } | null;
  categories: DonorCategory[];
  mappings: AccountMapping[];
}

export interface DonorReportLine {
  id: string;
  reportId: string;
  donorCategoryId: string;
  categoryCode: string;
  categoryLabel: string;
  budgetAmount: string;
  spentAmount: string;
  variance: string;
  variancePct: string;
}

export interface DonorReportSummary {
  id: string;
  grantId: string;
  templateId: string;
  periodStart: string;
  periodEnd: string;
  status: DonorReportStatus;
  currency: string;
  fxRateUsed: string | null;
  totalBudget: string;
  totalSpent: string;
  totalOverhead: string;
  fundsCarried: string;
  generatedBy: string;
  generatedAt: string;
  lockedBy: string | null;
  lockedAt: string | null;
  sentBy: string | null;
  sentAt: string | null;
  pdfObjectKey: string | null;
  excelObjectKey: string | null;
  notes: string | null;
}

export interface DonorReportDetail extends DonorReportSummary {
  lines: DonorReportLine[];
  template: {
    code: string;
    name: string;
    currency: string;
    donor: { id: string; code: string; label: string } | null;
  };
  grant: {
    reference: string;
    currency: string;
    amount: string;
  };
}

// =====================================================================
//  Inputs (mutations)
// =====================================================================

export interface CreateDonorTemplateInput {
  code: string;
  name: string;
  donorId?: string | null;
  currency: ReportCurrency;
  format?: Record<string, unknown>;
  categories?: Array<{
    code: string;
    label: string;
    parentCode?: string;
    sortOrder?: number;
  }>;
}

export interface AddMappingsInput {
  mappings: Array<{
    glAccountCode: string;
    categoryCode: string;
    sign?: 1 | -1;
  }>;
}

export interface CreateDonorReportInput {
  grantId: string;
  templateId: string;
  periodStart: string; // YYYY-MM-DD (coerce.date côté backend)
  periodEnd: string;
  notes?: string;
}

export interface SendDonorReportInput {
  externalReference?: string;
  notes?: string;
}

export interface ListDonorReportsQuery {
  grantId?: string;
  status?: DonorReportStatus;
  templateId?: string;
}

// =====================================================================
//  Templates
// =====================================================================

export async function listDonorTemplates(opts: FetchOpts = {}): Promise<DonorTemplateSummary[]> {
  return apiFetch<DonorTemplateSummary[]>('/reporting/templates', opts);
}

export async function getDonorTemplate(
  id: string,
  opts: FetchOpts = {},
): Promise<DonorTemplateDetail> {
  return apiFetch<DonorTemplateDetail>(`/reporting/templates/${id}`, opts);
}

export async function createDonorTemplate(
  input: CreateDonorTemplateInput,
  opts: FetchOpts = {},
): Promise<DonorTemplateSummary> {
  return apiFetch<DonorTemplateSummary>('/reporting/templates', {
    accessToken: opts.accessToken,
    method: 'POST',
    json: input,
  });
}

export async function addTemplateMappings(
  templateId: string,
  input: AddMappingsInput,
  opts: FetchOpts = {},
): Promise<DonorTemplateDetail> {
  return apiFetch<DonorTemplateDetail>(`/reporting/templates/${templateId}/mappings`, {
    accessToken: opts.accessToken,
    method: 'POST',
    json: input,
  });
}

// =====================================================================
//  Donor Reports
// =====================================================================

export async function listDonorReports(
  query: ListDonorReportsQuery = {},
  opts: FetchOpts = {},
): Promise<DonorReportSummary[]> {
  return apiFetch<DonorReportSummary[]>(
    `/reporting/donor-reports${qs(query as Record<string, string | undefined>)}`,
    opts,
  );
}

export async function getDonorReport(
  id: string,
  opts: FetchOpts = {},
): Promise<DonorReportDetail> {
  return apiFetch<DonorReportDetail>(`/reporting/donor-reports/${id}`, opts);
}

export async function createDonorReport(
  input: CreateDonorReportInput,
  opts: FetchOpts = {},
): Promise<DonorReportSummary> {
  return apiFetch<DonorReportSummary>('/reporting/donor-reports', {
    accessToken: opts.accessToken,
    method: 'POST',
    json: input,
  });
}

export async function lockDonorReport(
  id: string,
  opts: FetchOpts = {},
): Promise<DonorReportSummary> {
  return apiFetch<DonorReportSummary>(`/reporting/donor-reports/${id}/lock`, {
    accessToken: opts.accessToken,
    method: 'POST',
  });
}

export async function sendDonorReport(
  id: string,
  input: SendDonorReportInput,
  opts: FetchOpts = {},
): Promise<DonorReportSummary> {
  return apiFetch<DonorReportSummary>(`/reporting/donor-reports/${id}/send`, {
    accessToken: opts.accessToken,
    method: 'POST',
    json: input,
  });
}

/**
 * Récupère le PDF en blob — le caller crée un download via anchor.
 */
export async function downloadDonorReportPdf(
  id: string,
  opts: FetchOpts = {},
): Promise<Blob> {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
  const res = await fetch(`${baseUrl}/reporting/donor-reports/${id}/pdf`, {
    headers: opts.accessToken ? { Authorization: `Bearer ${opts.accessToken}` } : undefined,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} — PDF download failed`);
  return res.blob();
}

export async function downloadDonorReportExcel(
  id: string,
  opts: FetchOpts = {},
): Promise<Blob> {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
  const res = await fetch(`${baseUrl}/reporting/donor-reports/${id}/excel`, {
    headers: opts.accessToken ? { Authorization: `Bearer ${opts.accessToken}` } : undefined,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} — Excel download failed`);
  return res.blob();
}

// =====================================================================
//  Helpers UI partagés
// =====================================================================

/**
 * Niveau d'alerte de variance d'une ligne (cf. ReportAggregationService) :
 *   - none    : |variance%| < 5 %
 *   - warning : 5 % ≤ |variance%| ≤ 15 %
 *   - critical: > 15 %  (le backend lui-même flag `alert: true` au-delà de 10 %)
 *
 * Utilisé par DonorReportLineTable pour la coloration des cellules.
 */
export function varianceLevel(variancePct: number): 'none' | 'warning' | 'critical' {
  const abs = Math.abs(variancePct);
  if (abs > 15) return 'critical';
  if (abs >= 5) return 'warning';
  return 'none';
}

/**
 * Code template badge "officiel" — IPD ne re-seed pas ces codes, donc on
 * peut s'appuyer dessus pour distinguer les modèles fournis de ceux créés
 * en interne (USAID/OMS/WT en seed F5a backend).
 */
export const OFFICIAL_TEMPLATE_CODES = new Set([
  'USAID_FFR425',
  'OMS_STANDARD',
  'WELLCOME_TRUST',
]);

/**
 * Filtre client-side pour les rôles BAILLEUR : on ne renvoie que les
 * rapports `sent`. Le backend ne filtre pas par rôle (limitation connue)
 * — c'est notre voile UI. Pour la production, ajouter un guard côté API.
 */
export function filterReportsForBailleur<T extends { status: DonorReportStatus }>(
  reports: T[],
): T[] {
  return reports.filter((r) => r.status === 'sent');
}

/** Sérialise un object query en `?a=b&c=d`. */
function qs(params: Record<string, string | undefined>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') usp.append(k, v);
  }
  const s = usp.toString();
  return s ? `?${s}` : '';
}

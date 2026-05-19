import { apiFetch, type ApiFetchOptions } from '../api-client';

/**
 * Client API typé pour le module Pilotage (apps/api/src/pilotage/).
 *
 * Sprint F-PILOTAGE — endpoints lecture seule pour Contrôleur de gestion
 * et Principal Investigator :
 *   - GET /pilotage/grants/my-projects                  (PI only)
 *   - GET /pilotage/grants/:id/transactions
 *   - GET /pilotage/grants/:id/analytical-breakdown
 *   - GET /pilotage/grants/:id/dedicated-funds
 *   - GET /pilotage/grants/:id/overhead-calculation
 *
 * Les types miroirent les DTO du backend (apps/api/src/pilotage/dto/).
 */

type FetchOpts = ApiFetchOptions;

// =====================================================================
//  Types
// =====================================================================

export type BreakdownDimension = 'account' | 'cost_center' | 'activity' | 'period';
export type TransactionTypeFamily = 'all' | 'pr' | 'po' | 'invoice' | 'payment' | 'od';

export interface PilotageTransaction {
  entryId: string;
  entryNumber: string;
  entryDate: string;
  journal: string;
  label: string;
  sourceType: string | null;
  sourceId: string | null;
  accountCode: string;
  debit: number;
  credit: number;
  net: number;
  currency: string;
  status: string;
}

export interface TransactionsResponse {
  data: PilotageTransaction[];
  total: number;
  totalDebit: number;
  totalCredit: number;
}

export interface BreakdownEntry {
  key: string;
  label: string;
  amount: number;
  share: number;
}

export interface BreakdownResponse {
  by: BreakdownDimension;
  total: number;
  entries: BreakdownEntry[];
}

export interface DedicatedFundsMovement {
  id: string;
  movementType: 'allocation' | 'reprise' | string;
  amount: number;
  currency: string;
  rationale: string | null;
  computedAt: string;
  journalEntryId: string | null;
  periodCode: string | null;
}

export interface DedicatedFundsResponse {
  grantId: string;
  grantReference: string;
  balance: number;
  currency: string;
  movements: DedicatedFundsMovement[];
  lastMovement: DedicatedFundsMovement | null;
}

export interface OverheadEntry {
  id: string;
  periodCode: string;
  eligibleBase: number;
  overheadRate: number;
  overheadAmount: number;
  journalEntryId: string | null;
  computedAt: string;
}

export interface OverheadResponse {
  grantId: string;
  grantReference: string;
  grantOverheadRate: number;
  totalBillable: number;
  totalReversed: number;
  variance: number;
  variancePercent: number;
  entries: OverheadEntry[];
}

export interface MyProjectGrant {
  id: string;
  reference: string;
  amount: number;
  currency: string;
  startDate: string;
  endDate: string;
  status: string;
  donorCode: string;
  donorLabel: string;
}

export interface MyProject {
  id: string;
  code: string;
  title: string;
  status: string;
  grants: MyProjectGrant[];
}

export interface MyProjectsResponse {
  piUserId?: string;
  data: MyProject[];
  total: number;
}

// =====================================================================
//  Filters
// =====================================================================

export interface TransactionsFilter {
  type?: TransactionTypeFamily;
  fromDate?: string;
  toDate?: string;
  accountCode?: string;
}

export interface BreakdownFilter {
  by?: BreakdownDimension;
  fromDate?: string;
  toDate?: string;
}

function qs(params: Record<string, string | undefined>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') usp.append(k, v);
  }
  const s = usp.toString();
  return s ? `?${s}` : '';
}

// =====================================================================
//  Endpoints
// =====================================================================

export async function getMyProjects(opts: FetchOpts = {}): Promise<MyProjectsResponse> {
  return apiFetch<MyProjectsResponse>('/pilotage/grants/my-projects', opts);
}

export async function getGrantTransactions(
  grantId: string,
  filter: TransactionsFilter = {},
  opts: FetchOpts = {},
): Promise<TransactionsResponse> {
  return apiFetch<TransactionsResponse>(
    `/pilotage/grants/${grantId}/transactions${qs(filter as Record<string, string | undefined>)}`,
    opts,
  );
}

export async function getGrantBreakdown(
  grantId: string,
  filter: BreakdownFilter = {},
  opts: FetchOpts = {},
): Promise<BreakdownResponse> {
  return apiFetch<BreakdownResponse>(
    `/pilotage/grants/${grantId}/analytical-breakdown${qs(
      filter as Record<string, string | undefined>,
    )}`,
    opts,
  );
}

export async function getGrantDedicatedFunds(
  grantId: string,
  opts: FetchOpts = {},
): Promise<DedicatedFundsResponse> {
  return apiFetch<DedicatedFundsResponse>(
    `/pilotage/grants/${grantId}/dedicated-funds`,
    opts,
  );
}

export async function getGrantOverhead(
  grantId: string,
  opts: FetchOpts = {},
): Promise<OverheadResponse> {
  return apiFetch<OverheadResponse>(
    `/pilotage/grants/${grantId}/overhead-calculation`,
    opts,
  );
}

// =====================================================================
//  Helpers UI partagés
// =====================================================================

/**
 * Formate une devise UEMOA/SYSCEBNL en respectant la charte
 * (espace insécable comme séparateur de milliers, virgule comme
 * séparateur décimal — cf. CLAUDE.md §2).
 */
export function formatAmount(value: number, currency = 'XOF'): string {
  if (!Number.isFinite(value)) return '—';
  // Note: navigator may not be available SSR — toLocaleString fallback
  const formatted = value.toLocaleString('fr-FR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return `${formatted} ${currency}`;
}

export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return `${(value * 100).toLocaleString('fr-FR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} %`;
}

/**
 * Détermine la palette d'alerte d'un grant en fonction des marqueurs clés
 * (% consommé + jours restants jusqu'à endDate). Décision UI :
 *  - critical : ≤ 30 jours OU consommé ≥ 90 %
 *  - warning  : ≤ 90 jours OU consommé ≥ 75 %
 *  - none     : sinon
 *
 * `endDate` au format ISO 'YYYY-MM-DD'.
 */
export function computeGrantAlertLevel(
  endDate: string,
  utilization: number,
  today: Date = new Date(),
): 'critical' | 'warning' | 'none' {
  const end = new Date(`${endDate}T00:00:00Z`);
  const daysLeft = Math.ceil((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (daysLeft <= 30 || utilization >= 0.9) return 'critical';
  if (daysLeft <= 90 || utilization >= 0.75) return 'warning';
  return 'none';
}

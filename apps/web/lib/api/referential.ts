import { apiFetch, type ApiFetchOptions } from '../api-client';

/**
 * Types alignés sur les DTOs `apps/api/src/referential/*`.
 *
 * Les Decimal arrivent en string depuis Prisma (ex: `'485000.00'`) —
 * on les conserve en string pour respecter la précision et on les convertit
 * au point d'affichage via `AmountDisplay`. Les agrégats du dashboard
 * (`available`, `engaged`…) sont renvoyés en `number` par le backend
 * (cf. `GrantBudgetLineEntryDto`).
 */

// =====================================================================
//  Projects
// =====================================================================

export type ProjectStatus = 'active' | 'on_hold' | 'closed';

export interface Project {
  id: string;
  code: string;
  title: string;
  programId: string | null;
  piUserId: string | null;
  startDate: string;
  endDate: string | null;
  status: ProjectStatus;
  description: string | null;
  createdAt: string;
}

export interface ListProjectsQuery {
  q?: string;
  status?: ProjectStatus;
  isActive?: boolean;
  page?: number;
  pageSize?: number;
  sort?: 'code' | 'title' | 'startDate' | 'createdAt';
  order?: 'asc' | 'desc';
}

// =====================================================================
//  Grants
// =====================================================================

export type GrantStatus = 'active' | 'suspended' | 'closed';

export interface Grant {
  id: string;
  reference: string;
  donorId: string;
  projectId: string;
  amount: string;
  currency: string;
  overheadRate: string;
  startDate: string;
  endDate: string;
  status: GrantStatus;
  signedAt: string | null;
  notes: string | null;
  createdAt: string;
}

export interface ListGrantsQuery {
  q?: string;
  donorId?: string;
  projectId?: string;
  status?: GrantStatus;
  currency?: string;
  page?: number;
  pageSize?: number;
  sort?: 'reference' | 'amount' | 'startDate' | 'endDate' | 'createdAt';
  order?: 'asc' | 'desc';
}

export interface GrantBudgetLineEntry {
  budgetLineId: string;
  code: string;
  label: string;
  budgeted: number;
  engaged: number;
  consumed: number;
  available: number;
  utilization: number;
}

export interface GrantDashboard {
  grantRef: string;
  totalBudgeted: number;
  totalEngaged: number;
  totalConsumed: number;
  totalAvailable: number;
  utilization: number;
  byBudgetLine: GrantBudgetLineEntry[];
  monthsRemaining: number;
  alerts: string[];
}

// =====================================================================
//  Budget lines (master data — pas d'agrégats)
// =====================================================================

export interface BudgetLine {
  id: string;
  grantId: string;
  code: string;
  label: string;
  budgetedAmount: string;
  defaultAccount: string | null;
  isOverheadEligible: boolean;
  isActive: boolean;
}

// =====================================================================
//  Suppliers
// =====================================================================

export interface Supplier {
  id: string;
  code: string;
  name: string;
  vatNumber: string | null;
  address: string | null;
  country: string | null;
  iban: string | null;
  bic: string | null;
  bankName: string | null;
  paymentTermsDays: number;
  currencyDefault: string;
  riskScore: number | null;
  isActive: boolean;
  createdAt: string;
}

export interface ListSuppliersQuery {
  q?: string;
  country?: string;
  currency?: string;
  isActive?: boolean;
  includeInactive?: boolean;
  page?: number;
  pageSize?: number;
  sort?: 'code' | 'name' | 'createdAt' | 'riskScore';
  order?: 'asc' | 'desc';
}

// =====================================================================
//  Generic
// =====================================================================

export interface ListResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

/** Sérialise un object query en `?a=b&c=d` (filtre les `undefined`/`null`/`''`). */
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

export async function listProjects(
  query: ListProjectsQuery = {},
  opts: FetchOpts = {},
): Promise<ListResponse<Project>> {
  return apiFetch<ListResponse<Project>>(`/projects${qs(query)}`, opts);
}

export async function getProject(id: string, opts: FetchOpts = {}): Promise<Project> {
  return apiFetch<Project>(`/projects/${id}`, opts);
}

export async function listGrants(
  query: ListGrantsQuery = {},
  opts: FetchOpts = {},
): Promise<ListResponse<Grant>> {
  return apiFetch<ListResponse<Grant>>(`/grants${qs(query)}`, opts);
}

export async function getGrant(id: string, opts: FetchOpts = {}): Promise<Grant> {
  return apiFetch<Grant>(`/grants/${id}`, opts);
}

export async function getGrantDashboard(id: string, opts: FetchOpts = {}): Promise<GrantDashboard> {
  return apiFetch<GrantDashboard>(`/grants/${id}/dashboard`, opts);
}

/**
 * Liste les lignes budgétaires actives d'un grant.
 *
 * Renvoie uniquement les métadonnées (code, label, budgeted). Pour la
 * disponibilité temps réel, utiliser `getGrantDashboard()` qui expose
 * `byBudgetLine[].available`.
 */
export async function listBudgetLines(
  grantId: string,
  opts: FetchOpts = {},
): Promise<{ data: BudgetLine[]; total: number }> {
  return apiFetch<{ data: BudgetLine[]; total: number }>(
    `/grants/${grantId}/budget-lines`,
    opts,
  );
}

export async function listSuppliers(
  query: ListSuppliersQuery = {},
  opts: FetchOpts = {},
): Promise<ListResponse<Supplier>> {
  return apiFetch<ListResponse<Supplier>>(`/suppliers${qs(query)}`, opts);
}

export async function getSupplier(id: string, opts: FetchOpts = {}): Promise<Supplier> {
  return apiFetch<Supplier>(`/suppliers/${id}`, opts);
}

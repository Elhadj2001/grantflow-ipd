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
//  Donors
// =====================================================================

export interface Donor {
  id: string;
  code: string;
  label: string;
  type: string;
  country: string | null;
  isActive: boolean;
}

export interface ListDonorsQuery {
  q?: string;
  isActive?: boolean;
  page?: number;
  pageSize?: number;
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

export async function listDonors(
  query: ListDonorsQuery = {},
  opts: FetchOpts = {},
): Promise<ListResponse<Donor>> {
  return apiFetch<ListResponse<Donor>>(`/donors${qs(query)}`, opts);
}

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

// ---------------------------------------------------------------------
// Grants — write (CG / SUPER_ADMIN — sprint F-PILOTAGE)
// ---------------------------------------------------------------------

export interface CreateGrantInput {
  reference: string;
  donorId: string;
  projectId: string;
  amount: string;
  currency: string;
  overheadRate: number;
  startDate: string;
  endDate: string;
  status: 'draft' | 'active';
  signedAt?: string | null;
  notes?: string | null;
}

export type UpdateGrantInput = Partial<CreateGrantInput>;

export async function createGrant(
  input: CreateGrantInput,
  opts: FetchOpts = {},
): Promise<Grant> {
  return apiFetch<Grant>('/grants', {
    accessToken: opts.accessToken,
    method: 'POST',
    json: input,
  });
}

export async function updateGrant(
  id: string,
  input: UpdateGrantInput,
  opts: FetchOpts = {},
): Promise<Grant> {
  return apiFetch<Grant>(`/grants/${id}`, {
    accessToken: opts.accessToken,
    method: 'PATCH',
    json: input,
  });
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

// ---------------------------------------------------------------------
// Suppliers — mutations (sprint F5b-c Lot A)
// ---------------------------------------------------------------------

/**
 * Devises supportées par le backend (cf. SUPPLIER_CURRENCIES dans
 * apps/api/src/referential/supplier/dto/create-supplier.dto.ts).
 */
export const SUPPLIER_CURRENCIES = ['XOF', 'EUR', 'USD', 'GBP', 'CHF'] as const;
export type SupplierCurrency = (typeof SUPPLIER_CURRENCIES)[number];

/** Cf. CreateSupplierDto — strict, validation Zod côté backend. */
export interface CreateSupplierInput {
  code: string;
  name: string;
  vatNumber?: string;
  address?: string;
  country?: string;
  iban?: string;
  bic?: string;
  bankName?: string;
  paymentTermsDays?: number;
  currencyDefault?: SupplierCurrency;
  riskScore?: number;
}

/** Cf. UpdateSupplierDto — tous optionnels, certains nullable (null = clear). */
export interface UpdateSupplierInput {
  code?: string;
  name?: string;
  vatNumber?: string | null;
  address?: string | null;
  country?: string | null;
  iban?: string | null;
  bic?: string | null;
  bankName?: string | null;
  paymentTermsDays?: number;
  currencyDefault?: SupplierCurrency;
  riskScore?: number;
}

export async function createSupplier(
  input: CreateSupplierInput,
  opts: FetchOpts = {},
): Promise<Supplier> {
  return apiFetch<Supplier>('/suppliers', {
    accessToken: opts.accessToken,
    method: 'POST',
    json: input,
  });
}

export async function updateSupplier(
  id: string,
  input: UpdateSupplierInput,
  opts: FetchOpts = {},
): Promise<Supplier> {
  return apiFetch<Supplier>(`/suppliers/${id}`, {
    accessToken: opts.accessToken,
    method: 'PATCH',
    json: input,
  });
}

/**
 * Remplacement complet (PUT). Mêmes champs que `createSupplier` mais le
 * fournisseur doit déjà exister. À utiliser pour les rares cas où on
 * réécrit l'enregistrement entier (admin / migration) — l'UI courante
 * préfère `updateSupplier` (PATCH).
 */
export async function replaceSupplier(
  id: string,
  input: CreateSupplierInput,
  opts: FetchOpts = {},
): Promise<Supplier> {
  return apiFetch<Supplier>(`/suppliers/${id}`, {
    accessToken: opts.accessToken,
    method: 'PUT',
    json: input,
  });
}

/**
 * Soft-delete. Le backend renvoie 204 (NO_CONTENT) sans body → on type
 * la promesse en `void`. apiFetch gère déjà le 204 et renvoie `undefined`.
 */
export async function deleteSupplier(id: string, opts: FetchOpts = {}): Promise<void> {
  await apiFetch<void>(`/suppliers/${id}`, {
    accessToken: opts.accessToken,
    method: 'DELETE',
  });
}

export async function restoreSupplier(id: string, opts: FetchOpts = {}): Promise<Supplier> {
  return apiFetch<Supplier>(`/suppliers/${id}/restore`, {
    accessToken: opts.accessToken,
    method: 'POST',
  });
}

// ---------------------------------------------------------------------
// Budget lines — mutations (sprint F5b-c Lot A)
// ---------------------------------------------------------------------

/** Cf. CreateBudgetLineDto — strict. Le code interdit l'underscore. */
export interface CreateBudgetLineInput {
  /** Regex `^[A-Z0-9][A-Z0-9-]{1,31}$` (différent du code fournisseur). */
  code: string;
  label: string;
  /** Decimal positif (string ou number côté wire). */
  budgetedAmount: string | number;
  /** Compte SYSCEBNL par défaut — clé du mapping bailleur. */
  defaultAccount?: string;
  isOverheadEligible?: boolean;
}

/** Cf. UpdateBudgetLineDto. `defaultAccount: null` = clear. */
export interface UpdateBudgetLineInput {
  code?: string;
  label?: string;
  budgetedAmount?: string | number;
  defaultAccount?: string | null;
  isOverheadEligible?: boolean;
}

export async function createBudgetLine(
  grantId: string,
  input: CreateBudgetLineInput,
  opts: FetchOpts = {},
): Promise<BudgetLine> {
  return apiFetch<BudgetLine>(`/grants/${grantId}/budget-lines`, {
    accessToken: opts.accessToken,
    method: 'POST',
    json: input,
  });
}

export async function updateBudgetLine(
  grantId: string,
  id: string,
  input: UpdateBudgetLineInput,
  opts: FetchOpts = {},
): Promise<BudgetLine> {
  return apiFetch<BudgetLine>(`/grants/${grantId}/budget-lines/${id}`, {
    accessToken: opts.accessToken,
    method: 'PATCH',
    json: input,
  });
}

export async function deleteBudgetLine(
  grantId: string,
  id: string,
  opts: FetchOpts = {},
): Promise<void> {
  await apiFetch<void>(`/grants/${grantId}/budget-lines/${id}`, {
    accessToken: opts.accessToken,
    method: 'DELETE',
  });
}

export async function restoreBudgetLine(
  grantId: string,
  id: string,
  opts: FetchOpts = {},
): Promise<BudgetLine> {
  return apiFetch<BudgetLine>(`/grants/${grantId}/budget-lines/${id}/restore`, {
    accessToken: opts.accessToken,
    method: 'POST',
  });
}

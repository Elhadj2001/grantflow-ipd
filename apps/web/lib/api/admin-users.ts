import { apiFetch, type ApiFetchOptions } from '../api-client';

/**
 * Types alignés sur `apps/api/src/admin/users/dto/admin-user.dto.ts`.
 *
 * Source de vérité des rôles : on importe le tableau ROLES côté backend
 * exposé par packages/shared n'est pas encore disponible — on duplique
 * ici la liste pour rester self-contained, avec un commentaire pour la
 * source. Toute modification à un seul endroit sans l'autre cassera le
 * typecheck en cascade (les services backend exigent un Role connu).
 */
export const GRANTFLOW_ROLES = [
  'SUPER_ADMIN',
  'DAF',
  'CONTROLEUR',
  'COMPTABLE',
  'TRESORIER',
  'ACHETEUR',
  'MAGASINIER',
  'PI',
  'DEMANDEUR',
  'BAILLEUR',
  'CAISSIER',
  // US-065 — Grant Office (Notes Techniques, ADR-006)
  'GO',
] as const;
export type GrantflowRoleCode = (typeof GRANTFLOW_ROLES)[number];

export const USER_API_STATUSES = ['active', 'inactive'] as const;
export type UserApiStatus = (typeof USER_API_STATUSES)[number];

export interface AdminUser {
  id: string;
  email: string;
  fullName: string;
  department: string | null;
  employeeCode: string | null;
  status: UserApiStatus;
  /** Statut Keycloak (best-effort — fallback sur AppUser.status si KC KO). */
  enabled: boolean;
  roles: string[];
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface AdminUserListResponse {
  data: AdminUser[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface CreateAdminUserResponse extends AdminUser {
  /** false si Keycloak n'a pas pu envoyer le mail (SMTP KO en dev). */
  invitationEmailSent: boolean;
}

export interface ListAdminUsersQuery {
  q?: string;
  role?: GrantflowRoleCode;
  status?: UserApiStatus;
  includeInactive?: boolean;
  page?: number;
  pageSize?: number;
  sort?: 'email' | 'fullName' | 'createdAt';
  order?: 'asc' | 'desc';
}

export interface CreateAdminUserInput {
  email: string;
  fullName: string;
  department?: string;
  employeeCode?: string;
  /** Au moins 1 rôle obligatoire (validation Zod backend). */
  roles: GrantflowRoleCode[];
}

export interface UpdateAdminUserInput {
  fullName?: string;
  /** null = clear, undefined = no change. */
  department?: string | null;
  employeeCode?: string | null;
}

export interface SetUserRolesInput {
  roles: GrantflowRoleCode[];
}

type FetchOpts = Pick<ApiFetchOptions, 'accessToken'>;

/** Sérialise un objet en query-string en ignorant `undefined` / `null`. */
function qs(query: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

// =====================================================================
//  Read
// =====================================================================

export async function listAdminUsers(
  query: ListAdminUsersQuery = {},
  opts: FetchOpts = {},
): Promise<AdminUserListResponse> {
  // Cast explicite : ListAdminUsersQuery est un objet fermé (pas d'index
  // signature) — qs() consomme un Record<string, unknown> générique.
  return apiFetch<AdminUserListResponse>(
    `/admin/users${qs(query as Record<string, unknown>)}`,
    {
      accessToken: opts.accessToken,
    },
  );
}

export async function getAdminUser(id: string, opts: FetchOpts = {}): Promise<AdminUser> {
  return apiFetch<AdminUser>(`/admin/users/${id}`, { accessToken: opts.accessToken });
}

// =====================================================================
//  Write
// =====================================================================

export async function createAdminUser(
  input: CreateAdminUserInput,
  opts: FetchOpts = {},
): Promise<CreateAdminUserResponse> {
  return apiFetch<CreateAdminUserResponse>('/admin/users', {
    accessToken: opts.accessToken,
    method: 'POST',
    json: input,
  });
}

export async function updateAdminUser(
  id: string,
  input: UpdateAdminUserInput,
  opts: FetchOpts = {},
): Promise<AdminUser> {
  return apiFetch<AdminUser>(`/admin/users/${id}`, {
    accessToken: opts.accessToken,
    method: 'PATCH',
    json: input,
  });
}

export async function setUserRoles(
  id: string,
  input: SetUserRolesInput,
  opts: FetchOpts = {},
): Promise<AdminUser> {
  return apiFetch<AdminUser>(`/admin/users/${id}/roles`, {
    accessToken: opts.accessToken,
    method: 'PUT',
    json: input,
  });
}

export async function activateAdminUser(id: string, opts: FetchOpts = {}): Promise<AdminUser> {
  return apiFetch<AdminUser>(`/admin/users/${id}/activate`, {
    accessToken: opts.accessToken,
    method: 'POST',
  });
}

export async function deactivateAdminUser(
  id: string,
  opts: FetchOpts = {},
): Promise<AdminUser> {
  return apiFetch<AdminUser>(`/admin/users/${id}/deactivate`, {
    accessToken: opts.accessToken,
    method: 'POST',
  });
}

/** Le backend renvoie 204 (NO_CONTENT) — la promesse résout `undefined`. */
export async function resetAdminUserPassword(id: string, opts: FetchOpts = {}): Promise<void> {
  await apiFetch<void>(`/admin/users/${id}/reset-password`, {
    accessToken: opts.accessToken,
    method: 'POST',
  });
}

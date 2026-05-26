'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import {
  activateAdminUser,
  createAdminUser,
  deactivateAdminUser,
  getAdminUser,
  listAdminUsers,
  resetAdminUserPassword,
  setUserRoles,
  updateAdminUser,
  type AdminUser,
  type AdminUserListResponse,
  type CreateAdminUserInput,
  type CreateAdminUserResponse,
  type ListAdminUsersQuery,
  type SetUserRolesInput,
  type UpdateAdminUserInput,
} from '@/lib/api/admin-users';
import { mapApiErrorToToast } from '@/lib/use-api';

/**
 * Hooks TanStack pour le module admin/users (sprint F-ADMIN-USERS Lot C).
 *
 * Conventions :
 *   - queries gated par `sessionReady` (jamais d'appel anonyme)
 *   - mutations invalident `adminUsersKeys.all` au succès (pas de
 *     update optimiste — les opérations passent par Keycloak et peuvent
 *     échouer asymétriquement)
 *   - mapApiErrorToToast pour remonter les codes business → toast i18n
 *
 * staleTime court (30 s) : on veut voir tout de suite si un compte
 * vient d'être désactivé ou si un rôle a été modifié.
 */
const THIRTY_SECONDS = 30 * 1000;

export const adminUsersKeys = {
  all: ['admin-users'] as const,
  list: (q: ListAdminUsersQuery) => [...adminUsersKeys.all, 'list', q] as const,
  detail: (id: string) => [...adminUsersKeys.all, 'detail', id] as const,
};

function useToken() {
  const { data: session, status } = useSession();
  return {
    accessToken: session?.accessToken ?? null,
    sessionReady: status === 'authenticated',
  };
}

// =====================================================================
//  Queries
// =====================================================================

export function useAdminUsersList(query: ListAdminUsersQuery = {}) {
  const { accessToken, sessionReady } = useToken();
  return useQuery<AdminUserListResponse>({
    queryKey: adminUsersKeys.list(query),
    enabled: sessionReady,
    staleTime: THIRTY_SECONDS,
    queryFn: async () => {
      try {
        return await listAdminUsers(query, { accessToken });
      } catch (err) {
        mapApiErrorToToast(err);
        throw err;
      }
    },
  });
}

export function useAdminUser(id: string | null | undefined) {
  const { accessToken, sessionReady } = useToken();
  const enabled = sessionReady && !!id;
  return useQuery<AdminUser>({
    queryKey: adminUsersKeys.detail(id ?? ''),
    enabled,
    staleTime: THIRTY_SECONDS,
    queryFn: async () => {
      try {
        return await getAdminUser(id!, { accessToken });
      } catch (err) {
        mapApiErrorToToast(err);
        throw err;
      }
    },
  });
}

// =====================================================================
//  Mutations
// =====================================================================

export function useCreateAdminUser() {
  const qc = useQueryClient();
  const { accessToken } = useToken();
  return useMutation<CreateAdminUserResponse, unknown, CreateAdminUserInput>({
    mutationFn: (input) => createAdminUser(input, { accessToken }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminUsersKeys.all });
    },
    onError: (err) => mapApiErrorToToast(err),
  });
}

export function useUpdateAdminUser(id: string) {
  const qc = useQueryClient();
  const { accessToken } = useToken();
  return useMutation<AdminUser, unknown, UpdateAdminUserInput>({
    mutationFn: (input) => updateAdminUser(id, input, { accessToken }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminUsersKeys.all });
    },
    onError: (err) => mapApiErrorToToast(err),
  });
}

export function useSetUserRoles(id: string) {
  const qc = useQueryClient();
  const { accessToken } = useToken();
  return useMutation<AdminUser, unknown, SetUserRolesInput>({
    mutationFn: (input) => setUserRoles(id, input, { accessToken }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminUsersKeys.all });
    },
    onError: (err) => mapApiErrorToToast(err),
  });
}

export function useActivateAdminUser() {
  const qc = useQueryClient();
  const { accessToken } = useToken();
  return useMutation<AdminUser, unknown, string>({
    mutationFn: (id) => activateAdminUser(id, { accessToken }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminUsersKeys.all });
    },
    onError: (err) => mapApiErrorToToast(err),
  });
}

export function useDeactivateAdminUser() {
  const qc = useQueryClient();
  const { accessToken } = useToken();
  return useMutation<AdminUser, unknown, string>({
    mutationFn: (id) => deactivateAdminUser(id, { accessToken }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminUsersKeys.all });
    },
    onError: (err) => mapApiErrorToToast(err),
  });
}

export function useResetAdminUserPassword() {
  const { accessToken } = useToken();
  return useMutation<void, unknown, string>({
    mutationFn: (id) => resetAdminUserPassword(id, { accessToken }),
    onError: (err) => mapApiErrorToToast(err),
  });
}

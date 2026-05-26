'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import {
  createBudgetLine,
  createSupplier,
  deleteBudgetLine,
  deleteSupplier,
  getGrantDashboard,
  listBudgetLines,
  listGrants,
  listProjects,
  listSuppliers,
  restoreBudgetLine,
  restoreSupplier,
  updateBudgetLine,
  updateSupplier,
  type BudgetLine,
  type CreateBudgetLineInput,
  type CreateSupplierInput,
  type Grant,
  type GrantDashboard,
  type ListGrantsQuery,
  type ListProjectsQuery,
  type ListResponse,
  type ListSuppliersQuery,
  type Project,
  type Supplier,
  type UpdateBudgetLineInput,
  type UpdateSupplierInput,
} from '@/lib/api/referential';
import { mapApiErrorToToast } from '@/lib/use-api';

/**
 * Hooks TanStack Query autour des endpoints `/referential/*`.
 *
 * Données peu volatiles → on autorise un `staleTime` long (5 min)
 * pour éviter les re-fetchs intempestifs pendant la saisie d'une DA.
 */
const FIVE_MIN = 5 * 60 * 1000;

const referentialKeys = {
  all: ['referential'] as const,
  projects: (q: ListProjectsQuery) => [...referentialKeys.all, 'projects', q] as const,
  grants: (q: ListGrantsQuery) => [...referentialKeys.all, 'grants', 'list', q] as const,
  grantsByProject: (projectId: string) =>
    [...referentialKeys.all, 'grants', 'byProject', projectId] as const,
  grantDashboard: (grantId: string) =>
    [...referentialKeys.all, 'grants', grantId, 'dashboard'] as const,
  budgetLines: (grantId: string) =>
    [...referentialKeys.all, 'grants', grantId, 'budget-lines'] as const,
  suppliersList: () => [...referentialKeys.all, 'suppliers'] as const,
  suppliers: (q: ListSuppliersQuery) =>
    [...referentialKeys.suppliersList(), q] as const,
};

function useToken() {
  const { data: session, status } = useSession();
  return {
    accessToken: session?.accessToken ?? null,
    sessionReady: status === 'authenticated',
  };
}

// =====================================================================
//  Projects
// =====================================================================

export function useProjectsList(query: ListProjectsQuery = {}) {
  const { accessToken, sessionReady } = useToken();
  const effective: ListProjectsQuery = { pageSize: 100, isActive: true, ...query };
  return useQuery<ListResponse<Project>>({
    queryKey: referentialKeys.projects(effective),
    enabled: sessionReady,
    staleTime: FIVE_MIN,
    queryFn: async () => {
      try {
        return await listProjects(effective, { accessToken });
      } catch (err) {
        mapApiErrorToToast(err);
        throw err;
      }
    },
  });
}

// =====================================================================
//  Grants — liste générique paginée (portefeuille / analytics)
// =====================================================================

export function useGrantsList(query: ListGrantsQuery = {}) {
  const { accessToken, sessionReady } = useToken();
  const effective: ListGrantsQuery = { pageSize: 50, ...query };
  return useQuery<ListResponse<Grant>>({
    queryKey: referentialKeys.grants(effective),
    enabled: sessionReady,
    staleTime: FIVE_MIN,
    queryFn: async () => {
      try {
        return await listGrants(effective, { accessToken });
      } catch (err) {
        mapApiErrorToToast(err);
        throw err;
      }
    },
  });
}

// =====================================================================
//  Grants (filtrés par projet)
// =====================================================================

export function useGrantsByProject(projectId: string | null | undefined) {
  const { accessToken, sessionReady } = useToken();
  const enabled = sessionReady && !!projectId;
  return useQuery<ListResponse<Grant>>({
    queryKey: referentialKeys.grantsByProject(projectId ?? ''),
    enabled,
    staleTime: FIVE_MIN,
    queryFn: async () => {
      try {
        return await listGrants(
          { projectId: projectId!, status: 'active', pageSize: 100 },
          { accessToken },
        );
      } catch (err) {
        mapApiErrorToToast(err);
        throw err;
      }
    },
  });
}

// =====================================================================
//  Budget lines (via grant dashboard — donne aussi l'availability)
// =====================================================================

export function useGrantDashboard(grantId: string | null | undefined) {
  const { accessToken, sessionReady } = useToken();
  const enabled = sessionReady && !!grantId;
  return useQuery<GrantDashboard>({
    // staleTime court — l'utilisateur peut soumettre plusieurs DAs et
    // attendre que les engagements se reflètent dans `available`.
    queryKey: referentialKeys.grantDashboard(grantId ?? ''),
    enabled,
    staleTime: 30_000,
    queryFn: async () => {
      try {
        return await getGrantDashboard(grantId!, { accessToken });
      } catch (err) {
        mapApiErrorToToast(err);
        throw err;
      }
    },
  });
}

// =====================================================================
//  Suppliers (recherche serveur)
// =====================================================================

export function useSuppliersList(query: ListSuppliersQuery = {}) {
  const { accessToken, sessionReady } = useToken();
  const effective: ListSuppliersQuery = { isActive: true, pageSize: 50, ...query };
  return useQuery<ListResponse<Supplier>>({
    queryKey: referentialKeys.suppliers(effective),
    enabled: sessionReady,
    staleTime: FIVE_MIN,
    queryFn: async () => {
      try {
        return await listSuppliers(effective, { accessToken });
      } catch (err) {
        mapApiErrorToToast(err);
        throw err;
      }
    },
  });
}

// =====================================================================
//  Sprint F5b-c — Suppliers mutations
// =====================================================================

/**
 * Invalide toutes les listes fournisseurs (queries `suppliers, *`) après
 * un create/update/delete. On invalide à `suppliersList()` racine pour
 * couvrir toutes les variantes de query (`q`, `isActive`, …) en cache.
 */
function useInvalidateSuppliers() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: referentialKeys.suppliersList() });
  };
}

export function useCreateSupplier() {
  const { accessToken } = useToken();
  const invalidate = useInvalidateSuppliers();
  return useMutation<Supplier, Error, CreateSupplierInput>({
    mutationFn: (input) => createSupplier(input, { accessToken }),
    onSuccess: invalidate,
  });
}

export function useUpdateSupplier(supplierId: string) {
  const { accessToken } = useToken();
  const invalidate = useInvalidateSuppliers();
  return useMutation<Supplier, Error, UpdateSupplierInput>({
    mutationFn: (input) => updateSupplier(supplierId, input, { accessToken }),
    onSuccess: invalidate,
  });
}

export function useDeleteSupplier() {
  const { accessToken } = useToken();
  const invalidate = useInvalidateSuppliers();
  return useMutation<void, Error, string>({
    mutationFn: (id) => deleteSupplier(id, { accessToken }),
    onSuccess: invalidate,
  });
}

export function useRestoreSupplier() {
  const { accessToken } = useToken();
  const invalidate = useInvalidateSuppliers();
  return useMutation<Supplier, Error, string>({
    mutationFn: (id) => restoreSupplier(id, { accessToken }),
    onSuccess: invalidate,
  });
}

// =====================================================================
//  Sprint F5b-c — Budget lines queries + mutations
// =====================================================================

/**
 * Liste des lignes budgétaires d'un grant. Cf. backend BudgetLineController
 * — n'expose pas isActive, mais le service ne renvoie que les actives
 * (listByGrant filtre `isActive=true` côté Prisma). Pour voir aussi les
 * inactives en édition, il faudra un endpoint dédié plus tard.
 */
export function useBudgetLinesList(grantId: string | null | undefined) {
  const { accessToken, sessionReady } = useToken();
  return useQuery<{ data: BudgetLine[]; total: number }>({
    queryKey: referentialKeys.budgetLines(grantId ?? ''),
    enabled: sessionReady && !!grantId,
    staleTime: FIVE_MIN,
    queryFn: async () => {
      try {
        return await listBudgetLines(grantId!, { accessToken });
      } catch (err) {
        mapApiErrorToToast(err);
        throw err;
      }
    },
  });
}

/**
 * Invalide les lignes budgétaires du grant + son dashboard (qui agrège
 * la consommation par ligne — un changement de budget impacte le %
 * d'utilisation affiché).
 */
function useInvalidateBudgetLines(grantId: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: referentialKeys.budgetLines(grantId) });
    qc.invalidateQueries({ queryKey: referentialKeys.grantDashboard(grantId) });
  };
}

export function useCreateBudgetLine(grantId: string) {
  const { accessToken } = useToken();
  const invalidate = useInvalidateBudgetLines(grantId);
  return useMutation<BudgetLine, Error, CreateBudgetLineInput>({
    mutationFn: (input) => createBudgetLine(grantId, input, { accessToken }),
    onSuccess: invalidate,
  });
}

export function useUpdateBudgetLine(grantId: string) {
  const { accessToken } = useToken();
  const invalidate = useInvalidateBudgetLines(grantId);
  return useMutation<BudgetLine, Error, { id: string; input: UpdateBudgetLineInput }>({
    mutationFn: ({ id, input }) => updateBudgetLine(grantId, id, input, { accessToken }),
    onSuccess: invalidate,
  });
}

export function useDeleteBudgetLine(grantId: string) {
  const { accessToken } = useToken();
  const invalidate = useInvalidateBudgetLines(grantId);
  return useMutation<void, Error, string>({
    mutationFn: (id) => deleteBudgetLine(grantId, id, { accessToken }),
    onSuccess: invalidate,
  });
}

export function useRestoreBudgetLine(grantId: string) {
  const { accessToken } = useToken();
  const invalidate = useInvalidateBudgetLines(grantId);
  return useMutation<BudgetLine, Error, string>({
    mutationFn: (id) => restoreBudgetLine(grantId, id, { accessToken }),
    onSuccess: invalidate,
  });
}

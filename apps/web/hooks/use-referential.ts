'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import {
  createBudgetLine,
  createDonor,
  createProject,
  createSupplier,
  deleteBudgetLine,
  deleteDonor,
  deleteProject,
  deleteSupplier,
  getGrant,
  getGrantDashboard,
  listBudgetLines,
  listDonors,
  listGrants,
  listProjects,
  listSuppliers,
  restoreBudgetLine,
  restoreDonor,
  restoreProject,
  restoreSupplier,
  updateBudgetLine,
  updateDonor,
  updateProject,
  updateSupplier,
  type BudgetLine,
  type CreateBudgetLineInput,
  type CreateDonorInput,
  type CreateProjectInput,
  type CreateSupplierInput,
  type Donor,
  type Grant,
  type GrantDashboard,
  type ListDonorsQuery,
  type ListGrantsQuery,
  type ListProjectsQuery,
  type ListResponse,
  type ListSuppliersQuery,
  type Project,
  type Supplier,
  type UpdateBudgetLineInput,
  type UpdateDonorInput,
  type UpdateProjectInput,
  type UpdateSupplierInput,
} from '@/lib/api/referential';
import { listExpenseNatures, type ExpenseNature } from '@/lib/api/expense-natures';
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
  projectsList: () => [...referentialKeys.all, 'projects'] as const,
  projects: (q: ListProjectsQuery) => [...referentialKeys.projectsList(), q] as const,
  grants: (q: ListGrantsQuery) => [...referentialKeys.all, 'grants', 'list', q] as const,
  grant: (grantId: string) => [...referentialKeys.all, 'grants', grantId] as const,
  grantsByProject: (projectId: string) =>
    [...referentialKeys.all, 'grants', 'byProject', projectId] as const,
  grantDashboard: (grantId: string) =>
    [...referentialKeys.all, 'grants', grantId, 'dashboard'] as const,
  budgetLines: (grantId: string) =>
    [...referentialKeys.all, 'grants', grantId, 'budget-lines'] as const,
  suppliersList: () => [...referentialKeys.all, 'suppliers'] as const,
  suppliers: (q: ListSuppliersQuery) =>
    [...referentialKeys.suppliersList(), q] as const,
  donorsList: () => [...referentialKeys.all, 'donors'] as const,
  donors: (q: ListDonorsQuery) => [...referentialKeys.donorsList(), q] as const,
};

function useToken() {
  const { data: session, status } = useSession();
  return {
    accessToken: session?.accessToken ?? null,
    sessionReady: status === 'authenticated',
  };
}

// =====================================================================
// US-064 — catalogue des natures de dépense (formulaire DA + détail)
// =====================================================================
export function useExpenseNatures() {
  const { accessToken, sessionReady } = useToken();
  return useQuery<ExpenseNature[]>({
    queryKey: [...referentialKeys.all, 'expense-natures'],
    enabled: sessionReady,
    staleTime: FIVE_MIN,
    queryFn: async () => {
      try {
        return await listExpenseNatures({ accessToken });
      } catch (err) {
        mapApiErrorToToast(err);
        throw err;
      }
    },
  });
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

/**
 * Charge le grant complet (incluant `currency`, `startDate`, `endDate`,
 * `status`, …). Distinct de `useGrantDashboard` qui ne livre que les
 * agrégats budgétaires. Utilisé par la page détail convention pour
 * afficher la devise réelle au lieu d'un fallback codé en dur.
 *
 * Fix convention-currency-display (mars 2026) : la page détail
 * affichait XOF partout parce que GrantDashboard n'expose pas currency.
 */
export function useGrant(grantId: string | null | undefined) {
  const { accessToken, sessionReady } = useToken();
  const enabled = sessionReady && !!grantId;
  return useQuery<Grant>({
    queryKey: referentialKeys.grant(grantId ?? ''),
    enabled,
    staleTime: FIVE_MIN,
    queryFn: async () => {
      try {
        return await getGrant(grantId!, { accessToken });
      } catch (err) {
        mapApiErrorToToast(err);
        throw err;
      }
    },
  });
}

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

// =====================================================================
//  Sprint F-REF-BAILLEURS-PROJETS — Donors queries + mutations
// =====================================================================

export function useDonorsList(query: ListDonorsQuery = {}) {
  const { accessToken, sessionReady } = useToken();
  const effective: ListDonorsQuery = { pageSize: 100, isActive: true, ...query };
  return useQuery<ListResponse<Donor>>({
    queryKey: referentialKeys.donors(effective),
    enabled: sessionReady,
    staleTime: FIVE_MIN,
    queryFn: async () => {
      try {
        return await listDonors(effective, { accessToken });
      } catch (err) {
        mapApiErrorToToast(err);
        throw err;
      }
    },
  });
}

/** Invalide toutes les listes bailleurs après create/update/delete. */
function useInvalidateDonors() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: referentialKeys.donorsList() });
  };
}

export function useCreateDonor() {
  const { accessToken } = useToken();
  const invalidate = useInvalidateDonors();
  return useMutation<Donor, Error, CreateDonorInput>({
    mutationFn: (input) => createDonor(input, { accessToken }),
    onSuccess: invalidate,
  });
}

export function useUpdateDonor(donorId: string) {
  const { accessToken } = useToken();
  const invalidate = useInvalidateDonors();
  return useMutation<Donor, Error, UpdateDonorInput>({
    mutationFn: (input) => updateDonor(donorId, input, { accessToken }),
    onSuccess: invalidate,
  });
}

export function useDeleteDonor() {
  const { accessToken } = useToken();
  const invalidate = useInvalidateDonors();
  return useMutation<void, Error, string>({
    mutationFn: (id) => deleteDonor(id, { accessToken }),
    onSuccess: invalidate,
  });
}

export function useRestoreDonor() {
  const { accessToken } = useToken();
  const invalidate = useInvalidateDonors();
  return useMutation<Donor, Error, string>({
    mutationFn: (id) => restoreDonor(id, { accessToken }),
    onSuccess: invalidate,
  });
}

// =====================================================================
//  Sprint F-REF-BAILLEURS-PROJETS — Projects mutations
// =====================================================================

/** Invalide toutes les listes projets après mutation. Le détail GrantsByProject
 *  reste sur sa clé propre — pas d'invalidation cross-grants ici (un changement
 *  de status projet ne change pas les engagements comptables). */
function useInvalidateProjects() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: referentialKeys.projectsList() });
  };
}

export function useCreateProject() {
  const { accessToken } = useToken();
  const invalidate = useInvalidateProjects();
  return useMutation<Project, Error, CreateProjectInput>({
    mutationFn: (input) => createProject(input, { accessToken }),
    onSuccess: invalidate,
  });
}

export function useUpdateProject(projectId: string) {
  const { accessToken } = useToken();
  const invalidate = useInvalidateProjects();
  return useMutation<Project, Error, UpdateProjectInput>({
    mutationFn: (input) => updateProject(projectId, input, { accessToken }),
    onSuccess: invalidate,
  });
}

export function useDeleteProject() {
  const { accessToken } = useToken();
  const invalidate = useInvalidateProjects();
  return useMutation<void, Error, string>({
    mutationFn: (id) => deleteProject(id, { accessToken }),
    onSuccess: invalidate,
  });
}

export function useRestoreProject() {
  const { accessToken } = useToken();
  const invalidate = useInvalidateProjects();
  return useMutation<Project, Error, string>({
    mutationFn: (id) => restoreProject(id, { accessToken }),
    onSuccess: invalidate,
  });
}

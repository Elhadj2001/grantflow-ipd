'use client';

import { useQuery } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import {
  getGrantDashboard,
  listGrants,
  listProjects,
  listSuppliers,
  type GrantDashboard,
  type ListGrantsQuery,
  type ListProjectsQuery,
  type ListResponse,
  type ListSuppliersQuery,
  type Grant,
  type Project,
  type Supplier,
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
  suppliers: (q: ListSuppliersQuery) => [...referentialKeys.all, 'suppliers', q] as const,
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

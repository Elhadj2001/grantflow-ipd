'use client';

import { useQuery } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import {
  getGrantBreakdown,
  getGrantDedicatedFunds,
  getGrantOverhead,
  getGrantTransactions,
  getMyProjects,
  type BreakdownFilter,
  type BreakdownResponse,
  type DedicatedFundsResponse,
  type MyProjectsResponse,
  type OverheadResponse,
  type TransactionsFilter,
  type TransactionsResponse,
} from '@/lib/api/pilotage';
import { mapApiErrorToToast } from '@/lib/use-api';

/**
 * Hooks TanStack pour les vues pilotage (Contrôleur de gestion + PI).
 *
 * `staleTime = 5 * 60 * 1000` (5 min) :
 *   - les dashboards de pilotage agrègent des écritures comptables qui
 *     évoluent lentement à l'échelle de la session utilisateur ;
 *   - on évite de marteler le backend à chaque mount.
 *
 * Les filtres composent la queryKey — TanStack revalide automatiquement
 * au changement.
 */

const FIVE_MIN = 5 * 60 * 1000;

const pilotageKeys = {
  all: ['pilotage'] as const,
  myProjects: () => [...pilotageKeys.all, 'my-projects'] as const,
  grant: (id: string) => [...pilotageKeys.all, 'grant', id] as const,
  grantTransactions: (id: string, f: TransactionsFilter) =>
    [...pilotageKeys.grant(id), 'transactions', f] as const,
  grantBreakdown: (id: string, f: BreakdownFilter) =>
    [...pilotageKeys.grant(id), 'breakdown', f] as const,
  grantDedicatedFunds: (id: string) =>
    [...pilotageKeys.grant(id), 'dedicated-funds'] as const,
  grantOverhead: (id: string) => [...pilotageKeys.grant(id), 'overhead'] as const,
};

function useToken() {
  const { data: session, status } = useSession();
  return {
    accessToken: session?.accessToken ?? null,
    sessionReady: status === 'authenticated',
  };
}

// =====================================================================
//  Mes projets (PI)
// =====================================================================

export function useMyProjects() {
  const { accessToken, sessionReady } = useToken();
  return useQuery<MyProjectsResponse>({
    queryKey: pilotageKeys.myProjects(),
    enabled: sessionReady,
    staleTime: FIVE_MIN,
    queryFn: async () => {
      try {
        return await getMyProjects({ accessToken });
      } catch (err) {
        mapApiErrorToToast(err);
        throw err;
      }
    },
  });
}

// =====================================================================
//  Détail Convention — sous-ressources
// =====================================================================

export function useGrantTransactions(
  grantId: string | null | undefined,
  filter: TransactionsFilter = {},
) {
  const { accessToken, sessionReady } = useToken();
  return useQuery<TransactionsResponse>({
    queryKey: pilotageKeys.grantTransactions(grantId ?? '', filter),
    enabled: sessionReady && !!grantId,
    staleTime: FIVE_MIN,
    queryFn: async () => {
      try {
        return await getGrantTransactions(grantId!, filter, { accessToken });
      } catch (err) {
        mapApiErrorToToast(err);
        throw err;
      }
    },
  });
}

export function useGrantBreakdown(
  grantId: string | null | undefined,
  filter: BreakdownFilter = { by: 'account' },
) {
  const { accessToken, sessionReady } = useToken();
  return useQuery<BreakdownResponse>({
    queryKey: pilotageKeys.grantBreakdown(grantId ?? '', filter),
    enabled: sessionReady && !!grantId,
    staleTime: FIVE_MIN,
    queryFn: async () => {
      try {
        return await getGrantBreakdown(grantId!, filter, { accessToken });
      } catch (err) {
        mapApiErrorToToast(err);
        throw err;
      }
    },
  });
}

export function useGrantDedicatedFunds(grantId: string | null | undefined) {
  const { accessToken, sessionReady } = useToken();
  return useQuery<DedicatedFundsResponse>({
    queryKey: pilotageKeys.grantDedicatedFunds(grantId ?? ''),
    enabled: sessionReady && !!grantId,
    staleTime: FIVE_MIN,
    queryFn: async () => {
      try {
        return await getGrantDedicatedFunds(grantId!, { accessToken });
      } catch (err) {
        mapApiErrorToToast(err);
        throw err;
      }
    },
  });
}

export function useGrantOverhead(grantId: string | null | undefined) {
  const { accessToken, sessionReady } = useToken();
  return useQuery<OverheadResponse>({
    queryKey: pilotageKeys.grantOverhead(grantId ?? ''),
    enabled: sessionReady && !!grantId,
    staleTime: FIVE_MIN,
    queryFn: async () => {
      try {
        return await getGrantOverhead(grantId!, { accessToken });
      } catch (err) {
        mapApiErrorToToast(err);
        throw err;
      }
    },
  });
}

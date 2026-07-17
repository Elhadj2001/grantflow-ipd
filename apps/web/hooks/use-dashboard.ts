'use client';

import { useQuery } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { getDashboardSummary, type DashboardSummary } from '@/lib/api/dashboard';
import { mapApiErrorToToast } from '@/lib/use-api';

/**
 * US-066 — hook unique du dashboard : UNE requête GET /dashboard/summary
 * (staleTime 30 s, cohérent avec la fraîcheur des compteurs métier).
 */
export function useDashboardSummary() {
  const { data: session, status } = useSession();
  return useQuery<DashboardSummary>({
    queryKey: ['dashboard', 'summary'],
    enabled: status === 'authenticated',
    staleTime: 30_000,
    queryFn: async () => {
      try {
        return await getDashboardSummary({ accessToken: session?.accessToken ?? null });
      } catch (err) {
        mapApiErrorToToast(err);
        throw err;
      }
    },
  });
}

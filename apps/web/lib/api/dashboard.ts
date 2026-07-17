import { apiFetch, type ApiFetchOptions } from '@/lib/api-client';

/**
 * US-066 — compteurs dashboard agrégés en UNE requête (remplace le fan-out
 * de 5 listes DA mono-statut + 3 listes pageSize=1).
 */
export interface DashboardSummary {
  prPending: {
    byStatus: Record<string, number>;
    total: number;
    /** true si le compte est restreint aux DA de l'utilisateur (rôle non full-view). */
    scopedToOwn: boolean;
  };
  /** null = rôle sans vue comptable (la carte est masquée). */
  invoicesToMatch: number | null;
  activeGrants: number;
  /** null = rôle sans vue comptable (la carte est masquée). */
  paymentsExecutedThisMonth: number | null;
}

export function getDashboardSummary(options: ApiFetchOptions = {}) {
  return apiFetch<DashboardSummary>('/dashboard/summary', options);
}

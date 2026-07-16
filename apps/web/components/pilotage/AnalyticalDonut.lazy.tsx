'use client';

import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Phase 4 refonte 2025 — recharts (~100 KB gzip) sortait dans le bundle
 * initial des pages pilotage via l'import statique d'AnalyticalDonut.
 * Ce wrapper `next/dynamic` (ssr:false + skeleton) ne charge la lib qu'au
 * rendu effectif du graphique. API identique : importer `AnalyticalDonut`
 * depuis ce fichier au lieu de './AnalyticalDonut'.
 */
export const AnalyticalDonut = dynamic(
  () => import('./AnalyticalDonut').then((m) => m.AnalyticalDonut),
  {
    ssr: false,
    loading: () => <Skeleton className="h-64 w-full rounded-carte" />,
  },
);

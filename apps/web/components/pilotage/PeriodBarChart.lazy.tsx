'use client';

import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/skeleton';

/** Chargement différé de recharts (cf. AnalyticalDonut.lazy). */
export const PeriodBarChart = dynamic(
  () => import('./PeriodBarChart').then((m) => m.PeriodBarChart),
  {
    ssr: false,
    loading: () => <Skeleton className="h-full w-full rounded-carte" />,
  },
);

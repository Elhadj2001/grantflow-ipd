'use client';

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatAmount } from '@/lib/api/pilotage';

interface PeriodBarChartProps {
  entries: Array<{ key: string; amount: number }>;
  currency: string;
}

/**
 * Histogramme « évolution mensuelle des dépenses » (pilotage convention).
 * Extrait de la page conventions/[id] (Phase 4 refonte 2025) pour permettre
 * le chargement différé de recharts via PeriodBarChart.lazy. Couleurs charte
 * 2025 (barres bleu IPD #0089D0, curseur bleu translucide).
 */
export function PeriodBarChart({ entries, currency }: PeriodBarChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={entries}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="key" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip
          formatter={(value: number) => formatAmount(value, currency)}
          cursor={{ fill: 'rgba(0, 137, 208, 0.08)' }}
        />
        <Bar dataKey="amount" fill="#0089D0" />
      </BarChart>
    </ResponsiveContainer>
  );
}

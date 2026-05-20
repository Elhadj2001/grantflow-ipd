'use client';

import { cn } from '@/lib/utils';
import { formatAmount, formatPercent } from '@/lib/api/pilotage';
import { varianceLevel, type DonorReportLine } from '@/lib/api/reporting';

export interface DonorReportLineTableProps {
  lines: DonorReportLine[];
  currency: string;
  className?: string;
}

/**
 * Table des lignes d'un rapport bailleur (1 ligne par catégorie).
 *
 * Colonnes : Catégorie, Budget, Dépenses, Variance, Variance %.
 * Cellule "Variance %" colorée selon `varianceLevel()` :
 *  - none    (< 5 %)  → texte vert
 *  - warning (5-15 %) → ambre
 *  - critical (> 15 %) → rouge + ligne entière surlignée
 *
 * Les montants sont des Decimal sérialisés en string (cf. Prisma) — on
 * les convertit avec Number() pour `formatAmount`. Les valeurs > 10^15
 * dépassent la précision float, mais reporting bailleur reste sous
 * cette limite (jamais vu de subvention au-delà de 1 G$).
 */
export function DonorReportLineTable({ lines, currency, className }: DonorReportLineTableProps) {
  const totals = lines.reduce(
    (acc, l) => {
      acc.budget += Number(l.budgetAmount);
      acc.spent += Number(l.spentAmount);
      acc.variance += Number(l.variance);
      return acc;
    },
    { budget: 0, spent: 0, variance: 0 },
  );
  const totalVariancePct = totals.budget > 0 ? totals.variance / totals.budget : 0;

  return (
    <div
      data-testid="donor-report-line-table"
      data-count={lines.length}
      className={cn('overflow-x-auto rounded-md border bg-white', className)}
    >
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-muted">
          <tr>
            <th className="px-3 py-2 text-left">Catégorie</th>
            <th className="px-3 py-2 text-right">Budget</th>
            <th className="px-3 py-2 text-right">Dépenses</th>
            <th className="px-3 py-2 text-right">Variance</th>
            <th className="px-3 py-2 text-right">Variance %</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {lines.length === 0 && (
            <tr>
              <td colSpan={5} className="px-3 py-6 text-center text-slate-muted">
                Aucune ligne agrégée — vérifiez que le template a des mappings.
              </td>
            </tr>
          )}
          {lines.map((l) => {
            const pct = Number(l.variancePct);
            const level = varianceLevel(pct);
            return (
              <tr
                key={l.id}
                data-testid={`drl-row-${l.categoryCode}`}
                data-variance-level={level}
                className={cn(
                  'transition hover:bg-slate-50',
                  level === 'critical' && 'bg-state-error/5',
                )}
              >
                <td className="px-3 py-2">
                  <span className="font-mono text-xs text-slate-muted">{l.categoryCode}</span>
                  <span className="ml-2 text-slate-700">{l.categoryLabel}</span>
                </td>
                <td className="px-3 py-2 text-right">
                  {formatAmount(Number(l.budgetAmount), currency)}
                </td>
                <td className="px-3 py-2 text-right">
                  {formatAmount(Number(l.spentAmount), currency)}
                </td>
                <td className="px-3 py-2 text-right">
                  {formatAmount(Number(l.variance), currency)}
                </td>
                <td
                  className={cn(
                    'px-3 py-2 text-right font-semibold',
                    level === 'none' && 'text-state-success',
                    level === 'warning' && 'text-state-warning',
                    level === 'critical' && 'text-state-error',
                  )}
                >
                  {formatPercent(pct / 100)}
                </td>
              </tr>
            );
          })}
        </tbody>
        {lines.length > 0 && (
          <tfoot className="bg-slate-50 text-sm font-semibold">
            <tr>
              <td className="px-3 py-2 text-ipd-darker">Total</td>
              <td className="px-3 py-2 text-right">{formatAmount(totals.budget, currency)}</td>
              <td className="px-3 py-2 text-right">{formatAmount(totals.spent, currency)}</td>
              <td className="px-3 py-2 text-right">{formatAmount(totals.variance, currency)}</td>
              <td className="px-3 py-2 text-right">{formatPercent(totalVariancePct)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

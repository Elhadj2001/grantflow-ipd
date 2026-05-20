'use client';

import { useMemo, useState } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatAmount, formatPercent } from '@/lib/api/pilotage';

export interface BudgetVarianceRow {
  budgetLineId: string;
  code: string;
  label: string;
  budgeted: number;
  engaged: number;
  consumed: number;
  available: number;
  utilization: number;
}

export interface BudgetVarianceTableProps {
  rows: BudgetVarianceRow[];
  currency?: string;
  /** Affiche un footer total. */
  showTotals?: boolean;
  className?: string;
}

type SortKey = 'code' | 'utilization' | 'available' | 'budgeted';
type SortOrder = 'asc' | 'desc';

/**
 * Table de variance budgétaire — tri client-side, couleurs par
 * niveau de consommation (vert <60%, ambre 60-80%, orange 80-95%, rouge >95%).
 *
 * Tri par défaut : utilization décroissante (les lignes en alerte
 * remontent en haut pour le CG).
 */
export function BudgetVarianceTable({
  rows,
  currency = 'XOF',
  showTotals = true,
  className,
}: BudgetVarianceTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('utilization');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortOrder === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortOrder === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return copy;
  }, [rows, sortKey, sortOrder]);

  const totals = useMemo(() => {
    const b = rows.reduce((s, r) => s + r.budgeted, 0);
    const e = rows.reduce((s, r) => s + r.engaged, 0);
    const c = rows.reduce((s, r) => s + r.consumed, 0);
    return {
      budgeted: b,
      engaged: e,
      consumed: c,
      available: b - e,
      utilization: b > 0 ? e / b : 0,
    };
  }, [rows]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortOrder(key === 'code' ? 'asc' : 'desc');
    }
  };

  return (
    <div
      data-testid="budget-variance-table"
      data-sort-key={sortKey}
      data-sort-order={sortOrder}
      className={cn('overflow-x-auto rounded-lg border bg-white shadow-sm', className)}
    >
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-muted">
          <tr>
            <SortableTh label="Ligne" sortKey="code" current={sortKey} order={sortOrder} onClick={toggleSort} />
            <th className="px-3 py-2 text-left">Libellé</th>
            <SortableTh
              label="Budgété"
              sortKey="budgeted"
              current={sortKey}
              order={sortOrder}
              onClick={toggleSort}
              align="right"
            />
            <th className="px-3 py-2 text-right">Consommé</th>
            <th className="px-3 py-2 text-right">Engagé</th>
            <SortableTh
              label="Disponible"
              sortKey="available"
              current={sortKey}
              order={sortOrder}
              onClick={toggleSort}
              align="right"
            />
            <SortableTh
              label="Variance"
              sortKey="utilization"
              current={sortKey}
              order={sortOrder}
              onClick={toggleSort}
              align="right"
            />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {sorted.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-3 py-6 text-center text-slate-muted">
                Aucune ligne budgétaire
              </td>
            </tr>
          ) : (
            sorted.map((r) => {
              const tone = utilizationTone(r.utilization);
              return (
                <tr
                  key={r.budgetLineId}
                  data-testid={`bvt-row-${r.code}`}
                  data-tone={tone}
                  className={cn(
                    'transition hover:bg-slate-50',
                    tone === 'critical' && 'bg-state-error/5',
                  )}
                >
                  <td className="px-3 py-2 font-medium text-ipd-darker">{r.code}</td>
                  <td className="px-3 py-2 text-slate-700">{r.label}</td>
                  <td className="px-3 py-2 text-right">{formatAmount(r.budgeted, currency)}</td>
                  <td className="px-3 py-2 text-right">{formatAmount(r.consumed, currency)}</td>
                  <td className="px-3 py-2 text-right">{formatAmount(r.engaged, currency)}</td>
                  <td className="px-3 py-2 text-right">{formatAmount(r.available, currency)}</td>
                  <td
                    className={cn(
                      'px-3 py-2 text-right font-semibold',
                      tone === 'critical' && 'text-state-error',
                      tone === 'warning' && 'text-state-warning',
                      tone === 'ok' && 'text-state-success',
                    )}
                  >
                    {formatPercent(r.utilization)}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
        {showTotals && rows.length > 0 && (
          <tfoot className="bg-slate-50 text-sm font-semibold">
            <tr>
              <td className="px-3 py-2 text-ipd-darker" colSpan={2}>
                Total
              </td>
              <td className="px-3 py-2 text-right">{formatAmount(totals.budgeted, currency)}</td>
              <td className="px-3 py-2 text-right">{formatAmount(totals.consumed, currency)}</td>
              <td className="px-3 py-2 text-right">{formatAmount(totals.engaged, currency)}</td>
              <td className="px-3 py-2 text-right">{formatAmount(totals.available, currency)}</td>
              <td className="px-3 py-2 text-right">{formatPercent(totals.utilization)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

function utilizationTone(u: number): 'ok' | 'watch' | 'warning' | 'critical' {
  if (u >= 0.95) return 'critical';
  if (u >= 0.8) return 'warning';
  if (u >= 0.6) return 'watch';
  return 'ok';
}

interface SortableThProps {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  order: SortOrder;
  onClick: (k: SortKey) => void;
  align?: 'left' | 'right';
}

function SortableTh({ label, sortKey, current, order, onClick, align = 'left' }: SortableThProps) {
  const active = current === sortKey;
  return (
    <th
      className={cn(
        'cursor-pointer select-none px-3 py-2',
        align === 'right' ? 'text-right' : 'text-left',
      )}
      onClick={() => onClick(sortKey)}
      data-testid={`bvt-sort-${sortKey}`}
    >
      <span className={cn('inline-flex items-center gap-1', align === 'right' && 'justify-end')}>
        {label}
        {active && (order === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
      </span>
    </th>
  );
}

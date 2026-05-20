'use client';

import { useState, useMemo } from 'react';
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { cn } from '@/lib/utils';
import { formatAmount, formatPercent } from '@/lib/api/pilotage';
import type { BreakdownEntry } from '@/lib/api/pilotage';

export interface AnalyticalDonutProps {
  entries: BreakdownEntry[];
  /** Devise utilisée pour le tooltip (XOF par défaut). */
  currency?: string;
  /** Titre affiché au-dessus du donut. */
  title?: string;
  /** Action déclenchée au click sur une part — caller filtre la liste. */
  onSelect?: (key: string | null) => void;
  /** Limite d'éléments avant agrégation en "Autres". */
  topN?: number;
  className?: string;
}

// Palette IPD-cohérente, traversant la roue chromatique en restant
// désaturée pour éviter la lutte avec la charte aqua institutionnelle.
const PALETTE = [
  '#1B7A8E', // ipd-darker
  '#2BA0B8', // ipd-dark
  '#4FC3D9', // ipd
  '#1E3A5F', // navy
  '#7B5BD8',
  '#D17C2E',
  '#9DA9B7',
  '#46A36D',
];

/**
 * Donut Recharts + légende interactive.
 *
 * Comportement :
 *  - top-N segments listés, le reste agrégé en "Autres"
 *  - click sur un segment OU sur la légende → onSelect(key)
 *  - re-click ou click sur segment actif → onSelect(null) (reset)
 *  - tooltip natif Recharts avec montant + part
 *
 * Pas de side-effect store / pas de useEffect — entièrement contrôlé
 * par le caller via onSelect.
 */
export function AnalyticalDonut({
  entries,
  currency = 'XOF',
  title,
  onSelect,
  topN = 7,
  className,
}: AnalyticalDonutProps) {
  const [selected, setSelected] = useState<string | null>(null);

  const chartData = useMemo(() => {
    if (entries.length <= topN) {
      return entries.map((e) => ({ ...e }));
    }
    const head = entries.slice(0, topN);
    const tail = entries.slice(topN);
    const tailAmount = tail.reduce((s, e) => s + e.amount, 0);
    const tailShare = tail.reduce((s, e) => s + e.share, 0);
    return [
      ...head,
      { key: '__others__', label: 'Autres', amount: tailAmount, share: tailShare },
    ];
  }, [entries, topN]);

  const total = chartData.reduce((s, e) => s + e.amount, 0);

  const handleClick = (key: string) => {
    const next = selected === key ? null : key;
    setSelected(next);
    onSelect?.(next);
  };

  if (chartData.length === 0) {
    return (
      <div
        data-testid="analytical-donut"
        data-empty="true"
        data-selected={selected ?? ''}
        className={cn(
          'flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 p-8 text-sm text-slate-muted',
          className,
        )}
      >
        {title && <p className="mb-2 font-medium text-slate-700">{title}</p>}
        Aucune donnée à afficher
      </div>
    );
  }

  return (
    <div
      data-testid="analytical-donut"
      data-empty="false"
      data-selected={selected ?? ''}
      className={cn('rounded-lg border bg-white p-4 shadow-sm', className)}
    >
      {title && <h3 className="mb-3 text-sm font-semibold text-slate-700">{title}</h3>}
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              dataKey="amount"
              nameKey="label"
              cx="50%"
              cy="50%"
              innerRadius={55}
              outerRadius={85}
              paddingAngle={1}
              onClick={(d) => handleClick(d.key as string)}
            >
              {chartData.map((entry, idx) => (
                <Cell
                  key={entry.key}
                  fill={PALETTE[idx % PALETTE.length]}
                  opacity={selected && selected !== entry.key ? 0.35 : 1}
                  stroke="#fff"
                  strokeWidth={selected === entry.key ? 3 : 1}
                  data-testid={`donut-cell-${entry.key}`}
                  style={{ cursor: 'pointer' }}
                />
              ))}
            </Pie>
            <Tooltip
              formatter={(value: number, _name, props) => {
                const share = total > 0 ? value / total : 0;
                return [
                  `${formatAmount(value, currency)} (${formatPercent(share)})`,
                  props.payload?.label as string,
                ];
              }}
            />
            <Legend
              verticalAlign="bottom"
              align="left"
              wrapperStyle={{ fontSize: 12 }}
              formatter={(value, entry) => (
                <span
                  data-testid={`donut-legend-${(entry.payload as unknown as BreakdownEntry).key}`}
                  className={cn(
                    'cursor-pointer text-slate-700',
                    selected ===
                      (entry.payload as unknown as BreakdownEntry).key &&
                      'font-semibold underline',
                  )}
                  onClick={() =>
                    handleClick((entry.payload as unknown as BreakdownEntry).key)
                  }
                >
                  {value}
                </span>
              )}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

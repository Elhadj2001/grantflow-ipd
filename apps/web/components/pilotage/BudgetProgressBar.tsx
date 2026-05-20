'use client';

import { cn } from '@/lib/utils';
import { formatAmount, formatPercent } from '@/lib/api/pilotage';

export interface BudgetProgressBarProps {
  budgeted: number;
  consumed: number;
  engaged: number;
  /** Currency code (XOF par défaut). */
  currency?: string;
  /** Force la hauteur de la barre — 'sm' pour les cards, 'md' pour le détail. */
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Barre de progression budgétaire à 4 segments empilés :
 *   - consommé (vert) : factures comptabilisées
 *   - engagé non consommé (bleu) : BC validés en attente facture
 *   - disponible (gris) : reste sur la ligne / le grant
 *   - dépassement (rouge) : si engaged > budgeted (alerte critique)
 *
 * Le tooltip au survol affiche les 4 valeurs en XOF formatées.
 * Conforme charte IPD §4 — couleurs ipd / state-*.
 */
export function BudgetProgressBar({
  budgeted,
  consumed,
  engaged,
  currency = 'XOF',
  size = 'md',
  className,
}: BudgetProgressBarProps) {
  const safeBudgeted = Math.max(budgeted, 0);
  const safeConsumed = Math.max(consumed, 0);
  const safeEngaged = Math.max(engaged, safeConsumed); // engaged inclut consommé
  const engagedOnly = Math.max(safeEngaged - safeConsumed, 0);

  const overrun = Math.max(safeEngaged - safeBudgeted, 0);
  const consumedClamped = Math.min(safeConsumed, safeBudgeted);
  const engagedClamped = Math.min(engagedOnly, Math.max(safeBudgeted - consumedClamped, 0));
  const available = Math.max(safeBudgeted - consumedClamped - engagedClamped, 0);

  const total = safeBudgeted + overrun;
  const pct = (v: number) => (total > 0 ? (v / total) * 100 : 0);

  const utilization = safeBudgeted > 0 ? safeEngaged / safeBudgeted : 0;

  const tooltip = [
    `Budgété : ${formatAmount(safeBudgeted, currency)}`,
    `Consommé : ${formatAmount(safeConsumed, currency)} (${formatPercent(
      safeBudgeted > 0 ? safeConsumed / safeBudgeted : 0,
    )})`,
    `Engagé : ${formatAmount(safeEngaged, currency)} (${formatPercent(utilization)})`,
    `Disponible : ${formatAmount(safeBudgeted - safeEngaged, currency)}`,
    overrun > 0 ? `Dépassement : ${formatAmount(overrun, currency)}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  return (
    <div
      data-testid="budget-progress-bar"
      data-utilization={utilization.toFixed(4)}
      data-has-overrun={overrun > 0 ? 'true' : 'false'}
      className={cn('w-full', className)}
      title={tooltip}
    >
      <div
        className={cn(
          'flex w-full overflow-hidden rounded-full border border-slate-200 bg-slate-100',
          size === 'sm' ? 'h-2' : 'h-3',
        )}
        role="progressbar"
        aria-valuenow={Math.round(utilization * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Budget consommé ${Math.round(utilization * 100)}%`}
      >
        {consumedClamped > 0 && (
          <span
            data-testid="bpb-segment-consumed"
            className="bg-state-success"
            style={{ width: `${pct(consumedClamped)}%` }}
          />
        )}
        {engagedClamped > 0 && (
          <span
            data-testid="bpb-segment-engaged"
            className="bg-ipd-dark"
            style={{ width: `${pct(engagedClamped)}%` }}
          />
        )}
        {available > 0 && (
          <span
            data-testid="bpb-segment-available"
            className="bg-slate-200"
            style={{ width: `${pct(available)}%` }}
          />
        )}
        {overrun > 0 && (
          <span
            data-testid="bpb-segment-overrun"
            className="bg-state-error"
            style={{ width: `${pct(overrun)}%` }}
          />
        )}
      </div>
      {size === 'md' && (
        <div className="mt-1 flex justify-between text-xs text-slate-muted">
          <span>{formatAmount(safeConsumed, currency)} consommé</span>
          <span>{formatAmount(safeBudgeted - safeEngaged, currency)} disponible</span>
        </div>
      )}
    </div>
  );
}

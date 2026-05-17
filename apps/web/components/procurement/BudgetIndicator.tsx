'use client';

import { AlertTriangle, CheckCircle2, AlertCircle } from 'lucide-react';
import { AmountDisplay } from '@/components/common/AmountDisplay';
import { cn } from '@/lib/utils';
import {
  BUDGET_THRESHOLD_OK_PCT,
  BUDGET_THRESHOLD_WARN_PCT,
} from './pickers/BudgetLinePicker';

export interface BudgetIndicatorProps {
  /** Budget total alloué à la ligne (en devise locale du grant). */
  budgeted: number;
  /** Reste disponible (= budgeted - engaged - consumed). */
  available: number;
  /** Montant que la DA en cours va consommer. Optionnel. */
  requested?: number;
  currency?: string;
  className?: string;
}

/**
 * Barre de progression budgétaire + libellé + alerte "solde insuffisant".
 *
 * Trois états couleur (constantes dans `BudgetLinePicker.tsx` pour partage) :
 *  - vert  : disponible > 20% du budget
 *  - orange: 5–20% (warning)
 *  - rouge : < 5% OU demandé > disponible (insuffisant)
 */
export function BudgetIndicator({
  budgeted,
  available,
  requested = 0,
  currency = 'XOF',
  className,
}: BudgetIndicatorProps) {
  const insufficient = requested > 0 && requested > available;
  const availablePct = budgeted > 0 ? (available / budgeted) * 100 : 0;
  const consumedPct = Math.max(0, Math.min(100, 100 - availablePct));
  const requestedPct =
    budgeted > 0 ? Math.max(0, Math.min(100, (requested / budgeted) * 100)) : 0;

  const bucket = bucketForPct(availablePct, insufficient);

  return (
    <div
      data-testid="budget-indicator"
      data-state={bucket.state}
      className={cn('space-y-2 rounded-md border border-slate-200 bg-white p-3', className)}
    >
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-slate-text">Budget de la ligne</span>
        <span className={cn('flex items-center gap-1 font-medium', bucket.textClass)}>
          <bucket.Icon className="h-3.5 w-3.5" />
          {bucket.label}
        </span>
      </div>

      <div className="relative h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className="absolute inset-y-0 left-0 bg-slate-300"
          style={{ width: `${consumedPct}%` }}
          aria-label="Engagé + consommé"
        />
        {requested > 0 && (
          <div
            data-testid="budget-indicator-requested"
            className={cn('absolute inset-y-0 opacity-70', bucket.barClass)}
            style={{
              left: `${consumedPct}%`,
              width: `${Math.min(requestedPct, 100 - consumedPct)}%`,
            }}
            aria-label="Demande en cours"
          />
        )}
      </div>

      <div className="flex items-center justify-between text-xs text-slate-muted">
        <span>
          <AmountDisplay amount={available} currency={currency} /> disponible
        </span>
        <span>
          / <AmountDisplay amount={budgeted} currency={currency} />
        </span>
      </div>

      {insufficient && (
        <p className="flex items-start gap-1.5 text-xs font-medium text-state-error">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Le montant demandé (
          <AmountDisplay amount={requested} currency={currency} />) dépasse le solde disponible.
        </p>
      )}
    </div>
  );
}

function bucketForPct(pct: number, insufficient: boolean) {
  if (insufficient) {
    return {
      state: 'insufficient' as const,
      label: 'Solde insuffisant',
      textClass: 'text-state-error',
      barClass: 'bg-state-error',
      Icon: AlertCircle,
    };
  }
  if (pct > BUDGET_THRESHOLD_OK_PCT) {
    return {
      state: 'ok' as const,
      label: `${pct.toFixed(0)}% disponible`,
      textClass: 'text-state-success',
      barClass: 'bg-state-success',
      Icon: CheckCircle2,
    };
  }
  if (pct > BUDGET_THRESHOLD_WARN_PCT) {
    return {
      state: 'warn' as const,
      label: `${pct.toFixed(0)}% disponible`,
      textClass: 'text-state-warning',
      barClass: 'bg-state-warning',
      Icon: AlertTriangle,
    };
  }
  return {
    state: 'low' as const,
    label: `${pct.toFixed(0)}% disponible`,
    textClass: 'text-state-error',
    barClass: 'bg-state-error',
    Icon: AlertCircle,
  };
}

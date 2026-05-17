'use client';

import * as React from 'react';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { Badge } from '@/components/ui/badge';
import { useGrantDashboard } from '@/hooks/use-referential';
import type { GrantBudgetLineEntry } from '@/lib/api/referential';
import { cn } from '@/lib/utils';

/**
 * Seuils d'alerte budgétaire (en pourcentage de disponible / budgeté).
 * Exposés comme constantes — ajustables sans toucher la logique.
 */
export const BUDGET_THRESHOLD_OK_PCT = 20; // > 20% disponible → vert
export const BUDGET_THRESHOLD_WARN_PCT = 5; // entre 5% et 20% → orange ; < 5% → rouge

export interface BudgetLinePickerProps {
  grantId: string | null;
  value: string | null;
  onChange: (budgetLineId: string | null, entry: GrantBudgetLineEntry | null) => void;
  /** Montant demandé pour cette ligne — sert au flag "Solde insuffisant". */
  requestedAmount?: number;
  currency?: string;
  disabled?: boolean;
  className?: string;
  testId?: string;
}

/**
 * Sélecteur de ligne budgétaire avec affichage temps réel du
 * disponible / budgeté + badge couleur. Source : grant dashboard
 * (`/grants/:id/dashboard` → `byBudgetLine[]`).
 *
 * Cascade depuis `grantId` — désactivé sinon.
 */
export function BudgetLinePicker({
  grantId,
  value,
  onChange,
  requestedAmount = 0,
  currency = 'XOF',
  disabled,
  className,
  testId = 'budget-line-picker',
}: BudgetLinePickerProps) {
  const { data, isLoading } = useGrantDashboard(grantId);
  const entries = React.useMemo(() => data?.byBudgetLine ?? [], [data]);

  // Vider si grantId change
  const lastGrantId = React.useRef<string | null>(grantId);
  React.useEffect(() => {
    if (lastGrantId.current !== grantId) {
      lastGrantId.current = grantId;
      if (value) onChange(null, null);
    }
  }, [grantId, value, onChange]);

  const options: ComboboxOption[] = React.useMemo(
    () =>
      entries.map((e) => {
        const insufficient = requestedAmount > 0 && requestedAmount > e.available;
        const pct = e.budgeted > 0 ? (e.available / e.budgeted) * 100 : 0;
        const variant = bucketForPct(pct, insufficient);
        return {
          value: e.budgetLineId,
          label: `${e.code} — ${e.label}`,
          sublabel: (
            <span className={cn(variant.textClass)}>
              {formatAmount(e.available, currency)} disponible / {formatAmount(e.budgeted, currency)} ({pct.toFixed(0)}%)
            </span>
          ),
          searchText: `${e.code} ${e.label}`,
          rightSlot: insufficient ? (
            <Badge variant="error" className="text-[10px]">
              Solde insuffisant
            </Badge>
          ) : null,
        };
      }),
    [entries, requestedAmount, currency],
  );

  return (
    <Combobox
      testId={testId}
      options={options}
      value={value}
      onChange={(id) => {
        const entry = entries.find((e) => e.budgetLineId === id) ?? null;
        onChange(id, entry);
      }}
      placeholder={grantId ? 'Sélectionner une ligne budgétaire…' : 'Choisir une convention d\'abord'}
      searchPlaceholder="Rechercher par code ou libellé…"
      emptyText={
        grantId
          ? 'Aucune ligne budgétaire sur cette convention.'
          : 'Sélectionnez une convention.'
      }
      loading={isLoading}
      disabled={disabled || !grantId}
      className={className}
    />
  );
}

function bucketForPct(pct: number, insufficient: boolean) {
  if (insufficient) return { textClass: 'text-state-error' };
  if (pct > BUDGET_THRESHOLD_OK_PCT) return { textClass: 'text-state-success' };
  if (pct > BUDGET_THRESHOLD_WARN_PCT) return { textClass: 'text-state-warning' };
  return { textClass: 'text-state-error' };
}

function formatAmount(amount: number, currency: string): string {
  const decimals = currency === 'XOF' ? 0 : 2;
  return `${new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount)} ${currency}`;
}

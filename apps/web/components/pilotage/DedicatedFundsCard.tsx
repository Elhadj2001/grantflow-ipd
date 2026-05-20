'use client';

import { PiggyBank, History, ArrowDown, ArrowUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { formatAmount } from '@/lib/api/pilotage';
import type { DedicatedFundsResponse } from '@/lib/api/pilotage';

export interface DedicatedFundsCardProps {
  data: DedicatedFundsResponse;
  className?: string;
}

/**
 * Carte SYSCEBNL — Fonds dédiés (compte 19).
 *
 * Affiche :
 *   - solde net du compte 19 imputé au grant (toutes périodes posted)
 *   - dernier mouvement (allocation ou reprise) avec rationale et
 *     pointeur vers la période fiscale
 *   - lien implicite vers l'historique des mouvements (count)
 *
 * Source : /pilotage/grants/:id/dedicated-funds
 */
export function DedicatedFundsCard({ data, className }: DedicatedFundsCardProps) {
  const last = data.lastMovement;
  const isAllocation = last?.movementType === 'allocation';

  return (
    <Card data-testid="dedicated-funds-card" className={className}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base text-ipd-darker">
            <PiggyBank className="h-4 w-4" />
            Fonds dédiés (SYSCEBNL — compte 19)
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-muted">Solde net</p>
          <p
            data-testid="dedicated-funds-balance"
            className={cn(
              'text-2xl font-bold',
              data.balance > 0 ? 'text-ipd-darker' : 'text-slate-700',
            )}
          >
            {formatAmount(data.balance, data.currency)}
          </p>
        </div>

        {last ? (
          <div
            data-testid="dedicated-funds-last-movement"
            className={cn(
              'flex items-start gap-3 rounded-md border px-3 py-2',
              isAllocation
                ? 'border-state-success/30 bg-state-success/5'
                : 'border-state-warning/30 bg-state-warning/5',
            )}
          >
            <span
              className={cn(
                'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
                isAllocation
                  ? 'bg-state-success/20 text-state-success'
                  : 'bg-state-warning/20 text-state-warning',
              )}
            >
              {isAllocation ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-muted">
                {isAllocation ? 'Dernière dotation (689)' : 'Dernière reprise (789)'}
                {last.periodCode && (
                  <span className="ml-2 font-normal text-slate-muted">· {last.periodCode}</span>
                )}
              </p>
              <p className="mt-0.5 text-sm font-medium text-slate-700">
                {formatAmount(last.amount, last.currency)}
              </p>
              {last.rationale && (
                <p className="mt-1 text-xs text-slate-muted line-clamp-2">{last.rationale}</p>
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-muted">Aucun mouvement enregistré sur ce grant.</p>
        )}

        {data.movements.length > 1 && (
          <p className="flex items-center gap-1 text-xs text-slate-muted">
            <History className="h-3 w-3" />
            {data.movements.length} mouvement{data.movements.length > 1 ? 's' : ''} sur le grant
          </p>
        )}
      </CardContent>
    </Card>
  );
}

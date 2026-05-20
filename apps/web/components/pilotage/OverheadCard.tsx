'use client';

import { AlertTriangle, Percent } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { formatAmount, formatPercent } from '@/lib/api/pilotage';
import type { OverheadResponse } from '@/lib/api/pilotage';

export interface OverheadCardProps {
  data: OverheadResponse;
  currency?: string;
  /** Seuil de variance au-delà duquel on déclenche une alerte (par défaut 5%). */
  alertThreshold?: number;
  className?: string;
}

/**
 * Carte récapitulative de l'overhead d'un grant :
 *   - facturable (∑ overhead_calculation.overhead_amount, calculé en base)
 *   - reversé (somme crédits compte 754x grant)
 *   - variance + % avec alerte rouge si > seuil (5% par défaut)
 *
 * Le calcul est fourni par le backend (`/grants/:id/overhead-calculation`).
 */
export function OverheadCard({
  data,
  currency = 'XOF',
  alertThreshold = 0.05,
  className,
}: OverheadCardProps) {
  const showAlert = Math.abs(data.variancePercent) > alertThreshold && data.totalBillable > 0;

  return (
    <Card
      data-testid="overhead-card"
      data-alert={showAlert ? 'true' : 'false'}
      className={cn(showAlert && 'border-2 border-state-error/40', className)}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base text-ipd-darker">Overhead</CardTitle>
          <span className="flex items-center gap-1 text-xs text-slate-muted">
            <Percent className="h-3 w-3" />
            Taux convention : {formatPercent(data.grantOverheadRate)}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        <dl className="grid grid-cols-2 gap-3">
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-muted">Facturable</dt>
            <dd className="mt-0.5 text-lg font-semibold text-slate-700">
              {formatAmount(data.totalBillable, currency)}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-muted">Reversé (754x)</dt>
            <dd className="mt-0.5 text-lg font-semibold text-slate-700">
              {formatAmount(data.totalReversed, currency)}
            </dd>
          </div>
        </dl>

        <div
          data-testid="overhead-variance"
          className={cn(
            'flex items-center justify-between rounded-md border px-3 py-2',
            showAlert && 'border-state-error/40 bg-state-error/5',
            !showAlert && 'border-slate-200 bg-slate-50',
          )}
        >
          <div className="space-y-0.5">
            <p className="text-xs uppercase tracking-wide text-slate-muted">Écart</p>
            <p
              className={cn(
                'text-sm font-semibold',
                showAlert ? 'text-state-error' : 'text-slate-700',
              )}
            >
              {formatAmount(data.variance, currency)} ({formatPercent(data.variancePercent)})
            </p>
          </div>
          {showAlert && (
            <span
              data-testid="overhead-alert"
              className="flex items-center gap-1 rounded-full bg-state-error/15 px-2 py-1 text-xs font-semibold text-state-error"
            >
              <AlertTriangle className="h-3 w-3" />
              Écart &gt; {formatPercent(alertThreshold)}
            </span>
          )}
        </div>

        {data.entries.length > 0 && (
          <p className="text-xs text-slate-muted">
            {data.entries.length} période{data.entries.length > 1 ? 's' : ''} de calcul (dernière :{' '}
            {data.entries[0]?.periodCode})
          </p>
        )}
      </CardContent>
    </Card>
  );
}

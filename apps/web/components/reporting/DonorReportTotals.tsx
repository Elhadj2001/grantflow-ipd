'use client';

import { Coins, CreditCard, GitBranch, TrendingUp } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { formatAmount, formatPercent } from '@/lib/api/pilotage';

export interface DonorReportTotalsProps {
  totalBudget: number;
  totalSpent: number;
  totalOverhead: number;
  fundsCarried: number;
  currency: string;
  fxRateUsed?: number | null;
  className?: string;
}

/**
 * 4 cards Budget / Spent / Variance (calculée) / FundsCarried (reports).
 *
 * La variance est dérivée client-side (totalBudget - totalSpent) avec
 * un % de consommation. Code couleur :
 *   - vert  : consommation < 90 %
 *   - ambre : 90-100 %
 *   - rouge : > 100 % (sur-consommation)
 *
 * Affiche le `fxRateUsed` en sous-ligne si différent de 1 (devise du
 * template ≠ XOF).
 */
export function DonorReportTotals({
  totalBudget,
  totalSpent,
  totalOverhead,
  fundsCarried,
  currency,
  fxRateUsed,
  className,
}: DonorReportTotalsProps) {
  const variance = totalBudget - totalSpent;
  const utilization = totalBudget > 0 ? totalSpent / totalBudget : 0;

  const varianceTone = (() => {
    if (utilization > 1) return 'critical';
    if (utilization >= 0.9) return 'warning';
    return 'ok';
  })();

  return (
    <div
      data-testid="donor-report-totals"
      data-variance-tone={varianceTone}
      className={cn('grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4', className)}
    >
      <TotalCard
        testId="total-budget"
        icon={Coins}
        label="Budget"
        value={formatAmount(totalBudget, currency)}
        sub={fxRateUsed && fxRateUsed !== 1 ? `Taux : ${fxRateUsed.toFixed(4)}` : undefined}
      />
      <TotalCard
        testId="total-spent"
        icon={CreditCard}
        label="Dépenses"
        value={formatAmount(totalSpent, currency)}
        sub={`${formatPercent(utilization)} du budget`}
      />
      <TotalCard
        testId="total-variance"
        icon={TrendingUp}
        label="Variance"
        value={formatAmount(variance, currency)}
        sub={formatPercent(1 - utilization)}
        tone={varianceTone}
      />
      <TotalCard
        testId="funds-carried"
        icon={GitBranch}
        label="Reports / Fonds dédiés"
        value={formatAmount(fundsCarried, currency)}
        sub={totalOverhead > 0 ? `Overhead : ${formatAmount(totalOverhead, currency)}` : undefined}
      />
    </div>
  );
}

interface TotalCardProps {
  testId: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
  tone?: 'ok' | 'warning' | 'critical';
}

function TotalCard({ testId, icon: Icon, label, value, sub, tone }: TotalCardProps) {
  return (
    <Card
      data-testid={testId}
      data-tone={tone ?? 'neutral'}
      className={cn(
        'border-2',
        tone === 'critical' && 'border-state-error/40 bg-state-error/5',
        tone === 'warning' && 'border-state-warning/40 bg-state-warning/5',
      )}
    >
      <CardContent className="space-y-1 p-4">
        <p className="flex items-center gap-1 text-xs uppercase tracking-wide text-slate-muted">
          <Icon className="h-3 w-3" />
          {label}
        </p>
        <p
          className={cn(
            'text-xl font-bold',
            tone === 'critical' && 'text-state-error',
            tone === 'warning' && 'text-state-warning',
            (!tone || tone === 'ok') && 'text-ipd-darker',
          )}
        >
          {value}
        </p>
        {sub && <p className="text-xs text-slate-muted">{sub}</p>}
      </CardContent>
    </Card>
  );
}

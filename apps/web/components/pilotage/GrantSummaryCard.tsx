'use client';

import Link from 'next/link';
import { Bell, ArrowRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  computeGrantAlertLevel,
  formatAmount,
  formatPercent,
} from '@/lib/api/pilotage';
import { BudgetProgressBar } from './BudgetProgressBar';
import { GrantStatusBadge, type GrantBadgeStatus } from './GrantStatusBadge';

export interface GrantSummaryCardProps {
  id: string;
  reference: string;
  donorLabel: string;
  projectTitle: string;
  amount: number;
  currency: string;
  startDate: string;
  endDate: string;
  status: GrantBadgeStatus;
  budgeted: number;
  consumed: number;
  engaged: number;
  /** Lien à utiliser au click (par défaut /pilotage/conventions/:id). */
  href?: string;
  className?: string;
}

/**
 * Carte synthétique d'une convention (Portefeuille CG / Mes Projets PI).
 *
 * Affiche : code grant, bailleur, projet, période, montant, status badge,
 * BudgetProgressBar + indicateur d'alerte (cloche orange/rouge selon
 * proximité d'échéance ou consommation > 75/90%).
 *
 * Cliquable → href (Détail Convention).
 */
export function GrantSummaryCard({
  id,
  reference,
  donorLabel,
  projectTitle,
  amount,
  currency,
  startDate,
  endDate,
  status,
  budgeted,
  consumed,
  engaged,
  href,
  className,
}: GrantSummaryCardProps) {
  const utilization = budgeted > 0 ? engaged / budgeted : 0;
  const alertLevel = computeGrantAlertLevel(endDate, utilization);
  const link = href ?? `/pilotage/conventions/${id}`;

  const alertText =
    alertLevel === 'critical'
      ? 'Action urgente requise'
      : alertLevel === 'warning'
        ? 'À surveiller'
        : null;

  return (
    <Link
      href={link}
      data-testid="grant-summary-card"
      data-alert-level={alertLevel}
      data-grant-id={id}
      className={cn(
        'group block transition focus:outline-none focus:ring-2 focus:ring-ipd-dark focus:ring-offset-2',
        className,
      )}
    >
      <Card
        className={cn(
          'h-full border-2 transition hover:border-ipd hover:shadow-md',
          alertLevel === 'critical' && 'border-state-error/40 hover:border-state-error',
          alertLevel === 'warning' && 'border-state-warning/40 hover:border-state-warning',
        )}
      >
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <div className="space-y-0.5">
              <CardTitle className="text-base text-ipd-darker">{reference}</CardTitle>
              <p className="text-xs text-slate-muted">{donorLabel}</p>
            </div>
            <div className="flex items-center gap-2">
              {alertText && (
                <span
                  data-testid="alert-icon"
                  data-level={alertLevel}
                  className={cn(
                    'flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold',
                    alertLevel === 'critical' && 'bg-state-error/15 text-state-error',
                    alertLevel === 'warning' && 'bg-state-warning/15 text-state-warning',
                  )}
                  title={alertText}
                >
                  <Bell className="h-3 w-3" />
                  {alertText}
                </span>
              )}
              <GrantStatusBadge status={status} />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm font-medium text-slate-700">{projectTitle}</p>
          <div className="grid grid-cols-2 gap-2 text-xs text-slate-muted">
            <div>
              <p className="uppercase tracking-wide text-[10px]">Période</p>
              <p className="text-slate-700">
                {startDate} → {endDate}
              </p>
            </div>
            <div>
              <p className="uppercase tracking-wide text-[10px]">Montant</p>
              <p className="font-semibold text-slate-700">{formatAmount(amount, currency)}</p>
            </div>
          </div>

          <div className="pt-1">
            <BudgetProgressBar
              budgeted={budgeted}
              consumed={consumed}
              engaged={engaged}
              currency={currency}
              size="sm"
            />
            <div className="mt-1 flex items-center justify-between text-xs">
              <span className="text-slate-muted">
                {formatPercent(utilization)} engagé
              </span>
              <span className="flex items-center gap-1 text-ipd-darker opacity-0 transition group-hover:opacity-100">
                Détail <ArrowRight className="h-3 w-3" />
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

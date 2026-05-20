'use client';

import { CalendarDays, Coins, Building2, Percent, Receipt } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatAmount, formatPercent } from '@/lib/api/pilotage';
import { GrantStatusBadge, type GrantBadgeStatus } from './GrantStatusBadge';

export interface GrantHeaderProps {
  reference: string;
  donorLabel: string;
  projectTitle: string;
  amount: number;
  currency: string;
  startDate: string;
  endDate: string;
  status: GrantBadgeStatus;
  overheadRate: number;
  /** Actions à droite du header (édition, etc.). */
  actions?: React.ReactNode;
  /** Mode sticky pour conserver le header lors du scroll des sections. */
  sticky?: boolean;
  className?: string;
}

/**
 * Header de la page Détail Convention. Affiche en un coup d'œil
 * les invariants du grant (référence, bailleur, projet, période,
 * montant, overhead, status) — avec une option `sticky` pour rester
 * visible lors du scroll des sections (budget, transactions, etc.).
 */
export function GrantHeader({
  reference,
  donorLabel,
  projectTitle,
  amount,
  currency,
  startDate,
  endDate,
  status,
  overheadRate,
  actions,
  sticky = false,
  className,
}: GrantHeaderProps) {
  return (
    <header
      data-testid="grant-header"
      data-sticky={sticky}
      className={cn(
        'rounded-lg border bg-white p-4 shadow-sm',
        sticky && 'sticky top-0 z-10',
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-ipd-darker">{reference}</h1>
            <GrantStatusBadge status={status} />
          </div>
          <p className="text-sm text-slate-700">{projectTitle}</p>
          <p className="flex items-center gap-1.5 text-xs text-slate-muted">
            <Building2 className="h-3 w-3" />
            {donorLabel}
          </p>
        </div>

        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat icon={Coins} label="Montant" value={formatAmount(amount, currency)} />
        <Stat
          icon={CalendarDays}
          label="Période"
          value={`${startDate} → ${endDate}`}
        />
        <Stat icon={Percent} label="Overhead" value={formatPercent(overheadRate)} />
        <Stat icon={Receipt} label="Devise" value={currency} />
      </dl>
    </header>
  );
}

interface StatProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}

function Stat({ icon: Icon, label, value }: StatProps) {
  return (
    <div className="rounded-md bg-slate-50 px-3 py-2">
      <dt className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-slate-muted">
        <Icon className="h-3 w-3" />
        {label}
      </dt>
      <dd className="mt-0.5 text-sm font-semibold text-slate-700">{value}</dd>
    </div>
  );
}

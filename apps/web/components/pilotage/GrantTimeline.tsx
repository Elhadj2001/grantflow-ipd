'use client';

import { FileText, Truck, Receipt, Banknote, Layers } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatAmount } from '@/lib/api/pilotage';
import type { PilotageTransaction } from '@/lib/api/pilotage';

export interface GrantTimelineProps {
  transactions: PilotageTransaction[];
  currency?: string;
  /** Affiche les écritures non posted (draft) avec une indication grisée. */
  showDrafts?: boolean;
  className?: string;
}

/**
 * Timeline chronologique des écritures comptables imputées au grant.
 * Affiche pour chaque transaction : date, label, source (PR/PO/INV/PAY/OD)
 * + icône, montant net (D-C), compte SYSCEBNL et statut.
 *
 * Items inline groupés par mois pour faciliter la lecture (CG).
 */
export function GrantTimeline({
  transactions,
  currency = 'XOF',
  showDrafts = true,
  className,
}: GrantTimelineProps) {
  const filtered = showDrafts
    ? transactions
    : transactions.filter((t) => t.status === 'posted');

  if (filtered.length === 0) {
    return (
      <div
        data-testid="grant-timeline"
        data-empty="true"
        className={cn(
          'rounded-lg border border-dashed border-slate-200 p-8 text-center text-sm text-slate-muted',
          className,
        )}
      >
        Aucune transaction sur la période sélectionnée
      </div>
    );
  }

  const groups = groupByMonth(filtered);

  return (
    <div
      data-testid="grant-timeline"
      data-count={filtered.length}
      className={cn('space-y-6', className)}
    >
      {groups.map((g) => (
        <section key={g.key} data-testid={`timeline-month-${g.key}`}>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-muted">
            {g.label}
          </h3>
          <ol className="space-y-1">
            {g.items.map((t) => {
              const family = inferFamily(t.sourceType);
              const Icon = ICON_FOR_FAMILY[family];
              return (
                <li
                  key={`${t.entryId}-${t.accountCode}`}
                  data-testid={`timeline-item-${t.entryId}`}
                  data-status={t.status}
                  className={cn(
                    'flex items-center gap-3 rounded-md border bg-white p-3 shadow-sm transition hover:border-ipd',
                    t.status !== 'posted' && 'opacity-60',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                      FAMILY_COLOR[family],
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-700">{t.label}</p>
                    <p className="text-xs text-slate-muted">
                      {t.entryDate} · {t.entryNumber} · compte {t.accountCode}
                    </p>
                  </div>
                  <div className="text-right">
                    <p
                      className={cn(
                        'text-sm font-semibold',
                        t.net > 0 && 'text-state-error',
                        t.net < 0 && 'text-state-success',
                      )}
                    >
                      {t.net > 0 ? '+' : ''}
                      {formatAmount(t.net, t.currency || currency)}
                    </p>
                    <p className="text-[10px] uppercase tracking-wide text-slate-muted">
                      {FAMILY_LABEL[family]}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}

const ICON_FOR_FAMILY: Record<string, React.ComponentType<{ className?: string }>> = {
  pr: FileText,
  po: Truck,
  invoice: Receipt,
  payment: Banknote,
  od: Layers,
};

const FAMILY_LABEL: Record<string, string> = {
  pr: 'DA',
  po: 'BC',
  invoice: 'Facture',
  payment: 'Paiement',
  od: 'OD',
};

const FAMILY_COLOR: Record<string, string> = {
  pr: 'bg-slate-100 text-slate-700',
  po: 'bg-ipd-50 text-ipd-darker',
  invoice: 'bg-state-warning/15 text-state-warning',
  payment: 'bg-state-success/15 text-state-success',
  od: 'bg-navy/10 text-navy',
};

function inferFamily(sourceType: string | null): 'pr' | 'po' | 'invoice' | 'payment' | 'od' {
  switch (sourceType) {
    case 'purchase_request':
      return 'pr';
    case 'purchase_order':
    case 'goods_receipt':
      return 'po';
    case 'invoice':
      return 'invoice';
    case 'payment_run':
    case 'payment':
      return 'payment';
    default:
      return 'od';
  }
}

interface MonthGroup {
  key: string;
  label: string;
  items: PilotageTransaction[];
}

function groupByMonth(items: PilotageTransaction[]): MonthGroup[] {
  const map = new Map<string, MonthGroup>();
  for (const t of items) {
    const key = t.entryDate.slice(0, 7); // YYYY-MM
    const existing = map.get(key);
    if (existing) {
      existing.items.push(t);
    } else {
      map.set(key, { key, label: formatMonth(key), items: [t] });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.key.localeCompare(a.key));
}

function formatMonth(key: string): string {
  const [y, m] = key.split('-');
  const monthNames = [
    'Janvier',
    'Février',
    'Mars',
    'Avril',
    'Mai',
    'Juin',
    'Juillet',
    'Août',
    'Septembre',
    'Octobre',
    'Novembre',
    'Décembre',
  ];
  const idx = Math.max(0, Math.min(11, parseInt(m, 10) - 1));
  return `${monthNames[idx]} ${y}`;
}

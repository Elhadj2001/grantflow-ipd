'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, CalendarRange, CheckCircle2, Clock, ShieldOff } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { usePeriods } from '@/hooks/use-accounting';
import { usePermissions } from '@/hooks/use-permissions';
import type { FiscalPeriod } from '@/lib/api/accounting';

/**
 * Liste des périodes fiscales avec leur statut.
 *
 * Sprint F5b-b Lot B — accès interne finance uniquement (canViewClosure
 * filtre BAILLEUR). Lien vers le détail par période.
 */

type StatusFilter = 'all' | 'open' | 'closed';

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'Toutes' },
  { value: 'open', label: 'Ouvertes' },
  { value: 'closed', label: 'Closes' },
];

export default function PeriodsListPage() {
  const router = useRouter();
  const perms = usePermissions();
  const [filter, setFilter] = useState<StatusFilter>('all');
  const { data, isLoading, isError } = usePeriods();

  useEffect(() => {
    if (!perms.canViewClosure()) {
      router.replace('/dashboard');
    }
  }, [perms, router]);

  const periods = useMemo(() => {
    const list = data ?? [];
    // Tri : ouvertes en premier (chronologique décroissant), puis closes.
    return list.slice().sort((a, b) => {
      if (a.isClosed !== b.isClosed) return a.isClosed ? 1 : -1;
      return b.startDate.localeCompare(a.startDate);
    });
  }, [data]);

  const filtered = useMemo(() => {
    if (filter === 'all') return periods;
    if (filter === 'open') return periods.filter((p) => !p.isClosed);
    return periods.filter((p) => p.isClosed);
  }, [periods, filter]);

  if (!perms.canViewClosure()) {
    return (
      <div className="px-8 py-12 text-center">
        <ShieldOff className="mx-auto h-10 w-10 text-state-error" />
        <p className="mt-2 text-sm text-slate-muted">Accès réservé aux rôles finance.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <CalendarRange className="h-6 w-6 text-ipd-darker" />
            Clôture mensuelle
          </span>
        }
        subtitle="Périodes fiscales — précheck, FNP, fonds dédiés, clôture"
      />

      <div className="px-8 py-6 space-y-4">
        <div className="flex flex-wrap gap-2">
          {STATUS_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              size="sm"
              variant={filter === opt.value ? 'default' : 'outline'}
              onClick={() => setFilter(opt.value)}
              data-testid={`period-filter-${opt.value}`}
            >
              {opt.label}
            </Button>
          ))}
          <span className="ml-2 self-center text-xs text-slate-muted">
            {filtered.length} période{filtered.length > 1 ? 's' : ''}
          </span>
        </div>

        {isLoading && <p className="text-sm text-slate-muted">Chargement…</p>}
        {isError && (
          <p className="text-sm text-state-error">Impossible de charger les périodes.</p>
        )}

        {!isLoading && filtered.length === 0 && (
          <div
            data-testid="periods-empty"
            className="rounded-lg border border-dashed border-slate-200 p-12 text-center"
          >
            <p className="text-sm text-slate-muted">Aucune période ne correspond au filtre.</p>
          </div>
        )}

        <div
          data-testid="periods-grid"
          className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3"
        >
          {filtered.map((p) => (
            <PeriodCard key={p.id} period={p} />
          ))}
        </div>
      </div>
    </div>
  );
}

function PeriodCard({ period }: { period: FiscalPeriod }) {
  const isClosed = period.isClosed;
  return (
    <Link
      href={`/accounting/periods/${period.id}`}
      data-testid={`period-card-${period.code}`}
      data-status={isClosed ? 'closed' : 'open'}
      className="group block transition focus:outline-none focus:ring-2 focus:ring-ipd-dark focus:ring-offset-2"
    >
      <Card
        className={cn(
          'border-2 transition hover:border-ipd hover:shadow-md',
          isClosed && 'bg-slate-50',
        )}
      >
        <CardContent className="space-y-2 p-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-mono text-xs text-slate-muted">{period.periodType}</p>
              <p className="text-base font-semibold text-ipd-darker">{period.code}</p>
            </div>
            {isClosed ? (
              <Badge variant="muted" className="gap-1">
                <CheckCircle2 className="h-3 w-3" />
                Close
              </Badge>
            ) : (
              <Badge variant="success" className="gap-1">
                <Clock className="h-3 w-3" />
                Ouverte
              </Badge>
            )}
          </div>
          <p className="text-xs text-slate-muted">
            Du {period.startDate} au {period.endDate}
          </p>
          {period.closedAt && (
            <p className="text-xs text-slate-muted">
              Clôturée le {new Date(period.closedAt).toLocaleDateString('fr-FR')}
            </p>
          )}
          <div className="flex justify-end pt-1 text-xs text-ipd-darker opacity-0 transition group-hover:opacity-100">
            Détail <ArrowRight className="ml-1 h-3 w-3" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

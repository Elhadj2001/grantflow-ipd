'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Plus, Search, Target } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { GrantSummaryCard } from '@/components/pilotage/GrantSummaryCard';
import type { GrantBadgeStatus } from '@/components/pilotage/GrantStatusBadge';
import { computeGrantAlertLevel } from '@/lib/api/pilotage';
import { usePermissions } from '@/hooks/use-permissions';
import { useGrantsList } from '@/hooks/use-referential';
import type { Grant } from '@/lib/api/referential';

type StatusFilterValue = 'all' | 'active' | 'expiring' | 'expired' | 'closed';

const STATUS_OPTIONS: Array<{ value: StatusFilterValue; label: string }> = [
  { value: 'all', label: 'Tous' },
  { value: 'active', label: 'Actives' },
  { value: 'expiring', label: 'Expire bientôt' },
  { value: 'expired', label: 'Expirées' },
  { value: 'closed', label: 'Clôturées' },
];

/**
 * Portefeuille des conventions — vue CG/DAF/SUPER_ADMIN.
 *
 * Liste sous forme de cartes synthétiques (GrantSummaryCard), chacune
 * cliquable vers le détail. Filtres : statut + recherche par référence.
 *
 * Note : pour le sprint F-PILOTAGE on calcule l'alerte UI à partir de
 * (endDate, status) — le détail (BudgetProgressBar) reste à 0 tant qu'on
 * n'a pas chargé le dashboard. C'est un compromis volontaire pour éviter
 * N appels parallèles à /grants/:id/dashboard sur la liste — le détail
 * complet est à un clic.
 */
export default function ConventionsPortfolioPage() {
  const perms = usePermissions();
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>('all');
  const [search, setSearch] = useState('');

  const apiStatus = useMemo(() => {
    if (statusFilter === 'closed') return 'closed' as const;
    if (statusFilter === 'all' || statusFilter === 'expiring' || statusFilter === 'expired') {
      return undefined;
    }
    return statusFilter;
  }, [statusFilter]);

  const { data, isLoading, isError } = useGrantsList({
    status: apiStatus,
    q: search.length > 0 ? search : undefined,
    pageSize: 100,
  });

  const filtered = useMemo(() => {
    if (!data?.data) return [];
    if (statusFilter !== 'expiring' && statusFilter !== 'expired') return data.data;
    return data.data.filter((g) => {
      const alert = computeGrantAlertLevel(g.endDate, 0);
      if (statusFilter === 'expiring') return alert === 'warning' || alert === 'critical';
      if (statusFilter === 'expired') {
        return new Date(g.endDate) < new Date();
      }
      return true;
    });
  }, [data, statusFilter]);

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <Target className="h-6 w-6 text-ipd-darker" />
            Portefeuille des conventions
          </span>
        }
        subtitle="Pilotage analytique des grants bailleurs en temps réel"
        actions={
          perms.canParameterGrant() && (
            <Button asChild>
              <Link href="/pilotage/conventions/new">
                <Plus className="mr-1 h-4 w-4" />
                Nouvelle convention
              </Link>
            </Button>
          )
        }
      />

      <div className="px-8 py-6">
        {/* Filtres */}
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-muted" />
            <Input
              data-testid="search-grants"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher (réf., notes)…"
              className="w-72 pl-9"
            />
          </div>
          <div className="flex flex-wrap gap-1">
            {STATUS_OPTIONS.map((opt) => (
              <Button
                key={opt.value}
                data-testid={`status-filter-${opt.value}`}
                size="sm"
                variant={statusFilter === opt.value ? 'default' : 'outline'}
                onClick={() => setStatusFilter(opt.value)}
              >
                {opt.label}
              </Button>
            ))}
          </div>
        </div>

        {/* Liste */}
        {isLoading && <p className="text-sm text-slate-muted">Chargement…</p>}
        {isError && (
          <p className="text-sm text-state-error">
            Impossible de charger les conventions. Réessayez plus tard.
          </p>
        )}
        {!isLoading && filtered.length === 0 && (
          <div
            data-testid="empty-state"
            className="rounded-lg border border-dashed border-slate-200 p-12 text-center"
          >
            <p className="text-sm text-slate-muted">Aucune convention ne correspond aux filtres.</p>
          </div>
        )}

        <div
          data-testid="grant-portfolio-grid"
          className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
        >
          {filtered.map((g) => (
            <GrantSummaryCard
              key={g.id}
              id={g.id}
              reference={g.reference}
              donorLabel={`Bailleur ${g.donorId.slice(0, 8)}`}
              projectTitle={`Projet ${g.projectId.slice(0, 8)}`}
              amount={Number(g.amount)}
              currency={g.currency}
              startDate={g.startDate}
              endDate={g.endDate}
              status={statusToBadge(g)}
              budgeted={Number(g.amount)}
              consumed={0}
              engaged={0}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function statusToBadge(g: Grant): GrantBadgeStatus {
  if (g.status === 'closed') return 'closed';
  if (g.status === 'suspended') return 'suspended';
  // Active : on détecte expiring/expired par endDate
  const today = new Date();
  const end = new Date(g.endDate);
  if (end < today) return 'expired';
  const daysLeft = Math.ceil((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (daysLeft <= 90) return 'expiring';
  return 'active';
}

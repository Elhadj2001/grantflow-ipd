'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BarChart3, Download } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/button';
import { formatAmount, formatPercent } from '@/lib/api/pilotage';
import { useGrantsList } from '@/hooks/use-referential';
import { useGrantBreakdown } from '@/hooks/use-pilotage';
import { usePermissions } from '@/hooks/use-permissions';
import type { BreakdownDimension } from '@/lib/api/pilotage';
import type { Grant } from '@/lib/api/referential';
import { AnalyticalDonut } from '@/components/pilotage/AnalyticalDonut';
import { cn } from '@/lib/utils';

type RowDim = 'grant' | 'account' | 'cost_center' | 'period';

const DIMENSION_LABELS: Record<RowDim, string> = {
  grant: 'Convention',
  account: 'Compte SYSCEBNL',
  cost_center: 'Centre de coût',
  period: 'Mois',
};

/**
 * Vue analytique globale — cross-conventions. Réservée au CG/DAF/
 * SUPER_ADMIN.
 *
 * Construit un tableau multi-dimensions à partir des breakdowns
 * /pilotage/grants/:id/analytical-breakdown agrégés côté front pour les
 * N premiers grants actifs. Export Excel via génération CSV
 * (déclenchement download natif — pas de lib supplémentaire).
 *
 * Compromis sprint F-PILOTAGE : N parallèles fetch côté front (max 10
 * grants) au lieu d'un endpoint backend agrégeant. Si > 10 grants
 * actifs, on ajoutera un endpoint dédié dans un sprint ultérieur.
 */
export default function AnalyticsPage() {
  const router = useRouter();
  const perms = usePermissions();
  const [dimension, setDimension] = useState<RowDim>('grant');
  const [breakdownDim, setBreakdownDim] = useState<BreakdownDimension>('account');

  useEffect(() => {
    if (!perms.canViewAnalytics()) {
      router.replace('/dashboard');
    }
  }, [perms, router]);

  const { data: grantsData } = useGrantsList({ status: 'active', pageSize: 10 });
  const grants = grantsData?.data ?? [];

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-ipd-darker" />
            Analytique globale
          </span>
        }
        subtitle="Vue cross-conventions consolidée (CG/DAF)"
        actions={
          <Button
            data-testid="export-analytics"
            size="sm"
            variant="outline"
            onClick={() => exportCsv(grants, dimension)}
          >
            <Download className="mr-1 h-4 w-4" />
            Export Excel (CSV)
          </Button>
        }
      />

      <div className="px-8 py-6 space-y-6">
        {/* Sélecteurs */}
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-slate-muted">Ligne :</span>
          {(Object.keys(DIMENSION_LABELS) as RowDim[]).map((d) => (
            <Button
              key={d}
              data-testid={`dim-row-${d}`}
              size="sm"
              variant={dimension === d ? 'default' : 'outline'}
              onClick={() => setDimension(d)}
            >
              {DIMENSION_LABELS[d]}
            </Button>
          ))}
          <span className="ml-4 text-sm text-slate-muted">Colonne :</span>
          {(['account', 'cost_center', 'activity', 'period'] as BreakdownDimension[]).map((d) => (
            <Button
              key={d}
              data-testid={`dim-col-${d}`}
              size="sm"
              variant={breakdownDim === d ? 'default' : 'outline'}
              onClick={() => setBreakdownDim(d)}
            >
              {DIMENSION_LABELS[d as RowDim] ?? d}
            </Button>
          ))}
        </div>

        {grants.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 p-12 text-center">
            <p className="text-sm text-slate-muted">Aucune convention active à analyser.</p>
          </div>
        ) : (
          <GrantsBreakdownGrid grants={grants} breakdownDim={breakdownDim} />
        )}
      </div>
    </div>
  );
}

interface GrantsBreakdownGridProps {
  grants: Grant[];
  breakdownDim: BreakdownDimension;
}

function GrantsBreakdownGrid({ grants, breakdownDim }: GrantsBreakdownGridProps) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
      {grants.map((g) => (
        <GrantBreakdownCard key={g.id} grant={g} dim={breakdownDim} />
      ))}
    </div>
  );
}

interface GrantBreakdownCardProps {
  grant: Grant;
  dim: BreakdownDimension;
}

function GrantBreakdownCard({ grant, dim }: GrantBreakdownCardProps) {
  const { data, isLoading } = useGrantBreakdown(grant.id, { by: dim });

  return (
    <div className="rounded-lg border bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-ipd-darker">{grant.reference}</p>
          <p className="text-xs text-slate-muted">
            {grant.startDate} → {grant.endDate}
          </p>
        </div>
        <span className="text-xs text-slate-muted">
          {formatAmount(Number(grant.amount), grant.currency)}
        </span>
      </div>

      {isLoading && <p className="text-xs text-slate-muted">…</p>}

      {!isLoading && data && data.entries.length === 0 && (
        <p className="rounded-md bg-slate-50 px-3 py-4 text-center text-xs text-slate-muted">
          Aucune dépense imputée
        </p>
      )}

      {!isLoading && data && data.entries.length > 0 && (
        <>
          <AnalyticalDonut entries={data.entries.slice(0, 5)} title={undefined} />
          <ul className="mt-2 space-y-1 text-xs">
            {data.entries.slice(0, 5).map((e) => (
              <li
                key={e.key}
                className={cn('flex items-center justify-between')}
                data-testid={`abreakdown-row-${grant.id}-${e.key}`}
              >
                <span className="truncate text-slate-700">{e.label}</span>
                <span className="font-medium text-slate-700">
                  {formatAmount(e.amount, 'XOF')} ({formatPercent(e.share)})
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/**
 * Export CSV pour ouverture Excel. Pas de dépendance xlsx — on génère
 * un CSV UTF-8 avec BOM (Excel reconnaît les accents).
 */
function exportCsv(grants: Grant[], dim: RowDim) {
  const headers = ['Référence', 'Bailleur', 'Projet', 'Montant', 'Devise', 'Période début', 'Période fin', 'Statut'];
  const lines = [headers.join(';')];
  for (const g of grants) {
    lines.push(
      [
        g.reference,
        g.donorId,
        g.projectId,
        Number(g.amount).toFixed(2),
        g.currency,
        g.startDate,
        g.endDate,
        g.status,
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(';'),
    );
  }
  const csv = '﻿' + lines.join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `grantflow-analytics-${dim}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

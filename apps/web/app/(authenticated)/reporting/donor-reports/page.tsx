'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { FileText, Plus, ShieldCheck } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DonorReportStatusBadge } from '@/components/reporting/DonorReportStatusBadge';
import { formatAmount } from '@/lib/api/pilotage';
import {
  filterReportsForBailleur,
  type DonorReportStatus,
  type DonorReportSummary,
} from '@/lib/api/reporting';
import { useDonorReports } from '@/hooks/use-reporting';
import { usePermissions } from '@/hooks/use-permissions';

const STATUS_OPTIONS: Array<{ value: DonorReportStatus | 'all'; label: string }> = [
  { value: 'all', label: 'Tous' },
  { value: 'draft', label: 'Brouillon' },
  { value: 'locked', label: 'Verrouillé' },
  { value: 'sent', label: 'Envoyé' },
];

/**
 * Liste des rapports bailleur — accessible CG/DAF/BAILLEUR/SA.
 *
 * BAILLEUR : voile UI sur status=sent only (cf. filterReportsForBailleur).
 * Le backend ne filtre pas par rôle pour l'instant — limitation connue
 * documentée dans lib/api/reporting.ts. Pour la production, un guard
 * RBAC serveur sera ajouté en F5b.
 */
export default function DonorReportsListPage() {
  const perms = usePermissions();
  const isBailleur = perms.has('BAILLEUR') && !perms.hasAny('CONTROLEUR', 'DAF', 'SUPER_ADMIN');

  const [statusFilter, setStatusFilter] = useState<DonorReportStatus | 'all'>(
    isBailleur ? 'sent' : 'all',
  );

  const apiQuery = statusFilter === 'all' ? {} : { status: statusFilter };
  const { data, isLoading, isError } = useDonorReports(apiQuery);

  // Voile BAILLEUR : ne montrer que status=sent même si filtre dit autre chose
  const reports = useMemo(() => {
    const list = data ?? [];
    return isBailleur ? filterReportsForBailleur(list) : list;
  }, [data, isBailleur]);

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <FileText className="h-6 w-6 text-ipd-darker" />
            Rapports bailleur
          </span>
        }
        subtitle={
          isBailleur
            ? 'Vue lecture seule — uniquement les rapports envoyés'
            : 'Gestion des rapports financiers envoyés aux bailleurs'
        }
        actions={
          perms.canCreateDonorReport() && (
            <Button asChild data-testid="create-report-button">
              <Link href="/reporting/donor-reports/new">
                <Plus className="mr-1 h-4 w-4" />
                Nouveau rapport
              </Link>
            </Button>
          )
        }
      />

      <div className="px-8 py-6">
        {isBailleur && (
          <div
            data-testid="bailleur-banner"
            className="mb-4 flex items-center gap-2 rounded-md border border-ipd-50 bg-ipd-50/40 px-3 py-2 text-sm text-ipd-darker"
          >
            <ShieldCheck className="h-4 w-4" />
            Vous consultez les rapports en mode lecture seule (rôle BAILLEUR).
          </div>
        )}

        {/* Filtres status — cachés pour BAILLEUR */}
        {!isBailleur && (
          <div className="mb-4 flex flex-wrap gap-2">
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
        )}

        {isLoading && <p className="text-sm text-slate-muted">Chargement…</p>}
        {isError && (
          <p className="text-sm text-state-error">Impossible de charger les rapports.</p>
        )}

        {!isLoading && reports.length === 0 && (
          <div
            data-testid="empty-reports"
            className="rounded-lg border border-dashed border-slate-200 p-12 text-center"
          >
            <p className="text-sm text-slate-muted">
              {isBailleur
                ? 'Aucun rapport n\'a encore été envoyé.'
                : 'Aucun rapport ne correspond aux filtres.'}
            </p>
          </div>
        )}

        <div
          data-testid="report-grid"
          className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3"
        >
          {reports.map((r) => (
            <DonorReportRowCard key={r.id} report={r} />
          ))}
        </div>
      </div>
    </div>
  );
}

function DonorReportRowCard({ report }: { report: DonorReportSummary }) {
  return (
    <Link
      href={`/reporting/donor-reports/${report.id}`}
      data-testid={`donor-report-${report.id}`}
      data-status={report.status}
      className="group block transition focus:outline-none focus:ring-2 focus:ring-ipd-dark focus:ring-offset-2"
    >
      <Card className="border-2 transition hover:border-ipd hover:shadow-md">
        <CardContent className="space-y-2 p-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-mono text-xs text-slate-muted">{report.id.slice(0, 8)}</p>
              <p className="text-sm font-semibold text-ipd-darker">
                Période {report.periodStart} → {report.periodEnd}
              </p>
            </div>
            <DonorReportStatusBadge status={report.status} />
          </div>
          <dl className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <dt className="text-slate-muted">Budget</dt>
              <dd className="font-medium text-slate-700">
                {formatAmount(Number(report.totalBudget), report.currency)}
              </dd>
            </div>
            <div>
              <dt className="text-slate-muted">Dépenses</dt>
              <dd className="font-medium text-slate-700">
                {formatAmount(Number(report.totalSpent), report.currency)}
              </dd>
            </div>
          </dl>
          <p className="text-xs text-slate-muted">
            Généré le {new Date(report.generatedAt).toLocaleDateString('fr-FR')}
            {report.sentAt && ` · Envoyé le ${new Date(report.sentAt).toLocaleDateString('fr-FR')}`}
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}

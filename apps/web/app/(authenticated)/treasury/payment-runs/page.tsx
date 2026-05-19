'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Wallet, Plus } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, type DataTableColumn } from '@/components/common/DataTable';
import { StatusBadge } from '@/components/common/StatusBadge';
import { AmountDisplay } from '@/components/common/AmountDisplay';
import { DateDisplay } from '@/components/common/DateDisplay';
import { EmptyState } from '@/components/common/EmptyState';
import { FilterBar } from '@/components/common/FilterBar';
import { Button } from '@/components/ui/button';
import { IbanAlertBadge } from '@/components/treasury/IbanAlertBadge';
import { useListPaymentRuns } from '@/hooks/use-treasury';
import { usePermissions } from '@/hooks/use-permissions';
import type { IbanAlert, PaymentRun, PaymentRunStatus } from '@/lib/api/treasury';

const PAGE_SIZE = 20;

const STATUS_VALUES: Array<{ value: PaymentRunStatus; label: string }> = [
  { value: 'draft', label: 'Brouillon' },
  { value: 'prepared', label: 'Préparé' },
  { value: 'executed', label: 'Exécuté' },
  { value: 'rejected', label: 'Rejeté' },
  { value: 'cancelled', label: 'Annulé' },
];

export default function PaymentRunsListPage() {
  const router = useRouter();
  const permissions = usePermissions();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<PaymentRunStatus | undefined>();

  const { data, isLoading } = useListPaymentRuns({
    page,
    pageSize: PAGE_SIZE,
    status: statusFilter,
  });

  const columns: DataTableColumn<PaymentRun>[] = [
    {
      key: 'runNumber',
      header: 'N° run',
      cell: (r) => <span className="font-mono text-xs">{r.runNumber}</span>,
      width: '150px',
    },
    {
      key: 'runDate',
      header: 'Date',
      cell: (r) => <DateDisplay value={r.runDate} format="short" />,
      width: '120px',
    },
    {
      key: 'status',
      header: 'Statut',
      cell: (r) => <StatusBadge status={r.status} />,
      width: '120px',
    },
    {
      key: 'totalAmount',
      header: 'Total',
      cell: (r) => <AmountDisplay amount={r.totalAmount} currency={r.currency} />,
      align: 'right',
      width: '170px',
    },
    {
      key: 'ibanAlerts',
      header: 'Anti-fraude IBAN',
      cell: (r) => {
        const alerts = (r.ibanAlerts ?? []) as IbanAlert[];
        if (alerts.length === 0) {
          return <IbanAlertBadge level="ok" />;
        }
        const unack = alerts.filter((a) => !a.acknowledged).length;
        return (
          <IbanAlertBadge
            level={unack > 0 ? 'critical' : 'warn'}
            count={unack > 0 ? unack : alerts.length}
          />
        );
      },
      width: '170px',
    },
    {
      key: 'sepaGeneratedAt',
      header: 'SEPA',
      cell: (r) =>
        r.sepaGeneratedAt ? (
          <DateDisplay value={r.sepaGeneratedAt} format="short" />
        ) : (
          <span className="text-xs text-slate-muted">—</span>
        ),
      width: '110px',
    },
  ];

  return (
    <>
      <PageHeader
        title="Payment Runs"
        subtitle="Mise en paiement groupée des factures (SEPA pain.001.001.03)"
        actions={
          permissions.canCreatePaymentRun() ? (
            <Button
              onClick={() => router.push('/treasury/payment-runs/new')}
              data-testid="payment-run-new-btn"
            >
              <Plus className="mr-2 h-4 w-4" /> Nouveau run
            </Button>
          ) : undefined
        }
      />
      <div className="space-y-4 p-8">
        <FilterBar
          filters={{ status: statusFilter }}
          options={[{ key: 'status', label: 'Statut', values: STATUS_VALUES }]}
          onFilterChange={(key, value) => {
            if (key === 'status') setStatusFilter(value as PaymentRunStatus | undefined);
            setPage(1);
          }}
        />

        <DataTable
          columns={columns}
          data={data?.data ?? []}
          getRowId={(r) => r.id}
          isLoading={isLoading}
          isEmpty={!isLoading && (data?.data.length ?? 0) === 0}
          emptyState={
            <EmptyState
              icon={Wallet}
              title="Aucun payment run"
              description={
                permissions.canCreatePaymentRun()
                  ? 'Créez un run pour regrouper plusieurs factures à payer (XOF ou multi-devises).'
                  : 'Aucun run accessible avec votre rôle actuel.'
              }
              actionLabel={
                permissions.canCreatePaymentRun() ? 'Créer un payment run' : undefined
              }
              onAction={
                permissions.canCreatePaymentRun()
                  ? () => router.push('/treasury/payment-runs/new')
                  : undefined
              }
            />
          }
          onRowClick={(r) => router.push(`/treasury/payment-runs/${r.id}`)}
          pagination={{
            page,
            pageSize: PAGE_SIZE,
            total: data?.total ?? 0,
            onPageChange: setPage,
          }}
        />
      </div>
    </>
  );
}

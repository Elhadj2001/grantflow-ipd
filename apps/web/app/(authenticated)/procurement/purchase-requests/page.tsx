'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FilePlus, ShoppingCart } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, type DataTableColumn } from '@/components/common/DataTable';
import { StatusBadge } from '@/components/common/StatusBadge';
import { AmountDisplay } from '@/components/common/AmountDisplay';
import { DateDisplay } from '@/components/common/DateDisplay';
import { EmptyState } from '@/components/common/EmptyState';
import { FilterBar } from '@/components/common/FilterBar';
import { Button } from '@/components/ui/button';
import { useListPRs } from '@/hooks/use-procurement';
import { usePermissions } from '@/hooks/use-permissions';
import type { PrStatus, PurchaseRequest } from '@/lib/api/procurement';

const STATUS_FILTER_VALUES: Array<{ value: PrStatus; label: string }> = [
  { value: 'draft', label: 'Brouillon' },
  { value: 'submitted', label: 'Soumise' },
  { value: 'pending_pi', label: 'PI' },
  { value: 'pending_cg', label: 'CG' },
  { value: 'pending_daf', label: 'DAF' },
  { value: 'approved', label: 'Approuvée' },
  { value: 'rejected', label: 'Rejetée' },
];

const PAGE_SIZE = 20;

export default function PurchaseRequestsListPage() {
  const router = useRouter();
  const permissions = usePermissions();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<PrStatus | undefined>(undefined);

  const { data, isLoading } = useListPRs({
    page,
    pageSize: PAGE_SIZE,
    status: statusFilter,
    search: search || undefined,
  });

  const columns: DataTableColumn<PurchaseRequest>[] = [
    {
      key: 'prNumber',
      header: 'N° DA',
      cell: (r) => <span className="font-mono text-xs">{r.prNumber}</span>,
      sortable: false,
      width: '140px',
    },
    {
      key: 'description',
      header: 'Objet',
      cell: (r) => <span className="line-clamp-1">{r.description ?? '—'}</span>,
    },
    {
      key: 'status',
      header: 'Statut',
      cell: (r) => <StatusBadge status={r.status} />,
      width: '140px',
    },
    {
      key: 'totalAmount',
      header: 'Total',
      cell: (r) => <AmountDisplay amount={r.totalAmount} currency={r.currency} />,
      align: 'right',
      width: '160px',
    },
    {
      key: 'requestedAt',
      header: 'Date',
      cell: (r) => <DateDisplay value={r.requestedAt} format="short" />,
      width: '120px',
    },
  ];

  return (
    <>
      <PageHeader
        title="Demandes d'achat"
        subtitle="Cycle de validation Procure-to-Pay"
        actions={
          permissions.canCreatePR() && (
            <Button onClick={() => router.push('/procurement/purchase-requests/new')}>
              <FilePlus className="mr-2 h-4 w-4" />
              Nouvelle DA
            </Button>
          )
        }
      />

      <div className="space-y-4 p-8">
        <FilterBar
          search={search}
          onSearchChange={(s) => {
            setSearch(s);
            setPage(1);
          }}
          searchPlaceholder="Rechercher par n° ou description…"
          filters={{ status: statusFilter }}
          options={[
            { key: 'status', label: 'Statut', values: STATUS_FILTER_VALUES },
          ]}
          onFilterChange={(key, value) => {
            if (key === 'status') setStatusFilter(value as PrStatus | undefined);
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
              icon={ShoppingCart}
              title="Aucune demande d'achat"
              description={
                search || statusFilter
                  ? 'Aucun résultat pour ces filtres.'
                  : 'Créez votre première DA pour démarrer un cycle Procure-to-Pay.'
              }
              actionLabel={permissions.canCreatePR() ? 'Créer la première DA' : undefined}
              onAction={
                permissions.canCreatePR()
                  ? () => router.push('/procurement/purchase-requests/new')
                  : undefined
              }
            />
          }
          onRowClick={(r) => router.push(`/procurement/purchase-requests/${r.id}`)}
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

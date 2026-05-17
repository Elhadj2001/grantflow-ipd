'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShoppingCart } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, type DataTableColumn } from '@/components/common/DataTable';
import { StatusBadge } from '@/components/common/StatusBadge';
import { AmountDisplay } from '@/components/common/AmountDisplay';
import { DateDisplay } from '@/components/common/DateDisplay';
import { EmptyState } from '@/components/common/EmptyState';
import { FilterBar } from '@/components/common/FilterBar';
import { useListPOs } from '@/hooks/use-procurement';
import type { PoStatus, PurchaseOrder } from '@/lib/api/procurement';

const PAGE_SIZE = 20;

const STATUS_VALUES: Array<{ value: PoStatus; label: string }> = [
  { value: 'draft', label: 'Brouillon' },
  { value: 'sent', label: 'Envoyé' },
  { value: 'acknowledged', label: 'Confirmé' },
  { value: 'partially_received', label: 'Reçu partiel' },
  { value: 'received', label: 'Reçu' },
  { value: 'invoiced', label: 'Facturé' },
  { value: 'cancelled', label: 'Annulé' },
];

export default function PurchaseOrdersListPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<PoStatus | undefined>();

  const { data, isLoading } = useListPOs({
    page,
    pageSize: PAGE_SIZE,
    status: statusFilter,
    search: search || undefined,
  });

  const columns: DataTableColumn<PurchaseOrder>[] = [
    {
      key: 'poNumber',
      header: 'N° BC',
      cell: (r) => <span className="font-mono text-xs">{r.poNumber}</span>,
      width: '140px',
    },
    { key: 'supplierId', header: 'Fournisseur (UUID)', cell: (r) => <span className="font-mono text-xs">{r.supplierId.slice(0, 8)}…</span> },
    { key: 'status', header: 'Statut', cell: (r) => <StatusBadge status={r.status} />, width: '140px' },
    {
      key: 'totalTtc',
      header: 'Total TTC',
      cell: (r) => <AmountDisplay amount={r.totalTtc} currency={r.currency} />,
      align: 'right',
      width: '160px',
    },
    {
      key: 'orderDate',
      header: 'Date',
      cell: (r) => <DateDisplay value={r.orderDate} format="short" />,
      width: '120px',
    },
  ];

  return (
    <>
      <PageHeader title="Bons de commande" subtitle="Engagements fournisseurs (classe 8 SYSCEBNL)" />
      <div className="space-y-4 p-8">
        <FilterBar
          search={search}
          onSearchChange={(s) => {
            setSearch(s);
            setPage(1);
          }}
          searchPlaceholder="Rechercher par n° ou fournisseur…"
          filters={{ status: statusFilter }}
          options={[{ key: 'status', label: 'Statut', values: STATUS_VALUES }]}
          onFilterChange={(key, value) => {
            if (key === 'status') setStatusFilter(value as PoStatus | undefined);
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
              title="Aucun bon de commande"
              description="Les BC sont créés à partir d'une demande d'achat approuvée. Allez dans Achats → DA pour créer un BC depuis une DA approuvée."
            />
          }
          onRowClick={(r) => router.push(`/procurement/purchase-orders/${r.id}`)}
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

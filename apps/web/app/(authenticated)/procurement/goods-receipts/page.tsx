'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PackageCheck } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, type DataTableColumn } from '@/components/common/DataTable';
import { StatusBadge } from '@/components/common/StatusBadge';
import { DateDisplay } from '@/components/common/DateDisplay';
import { EmptyState } from '@/components/common/EmptyState';
import { FilterBar } from '@/components/common/FilterBar';
import { useListGRs } from '@/hooks/use-procurement';
import type { GoodsReceipt, GrStatus } from '@/lib/api/procurement';

const PAGE_SIZE = 20;
const STATUS_VALUES: Array<{ value: GrStatus; label: string }> = [
  { value: 'draft', label: 'Brouillon' },
  { value: 'partial', label: 'Partielle' },
  { value: 'complete', label: 'Complète' },
  { value: 'rejected', label: 'Rejetée' },
  { value: 'cancelled', label: 'Annulée' },
];

export default function GoodsReceiptsListPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<GrStatus | undefined>();

  const { data, isLoading } = useListGRs({
    page,
    pageSize: PAGE_SIZE,
    status: statusFilter,
  });

  const columns: DataTableColumn<GoodsReceipt>[] = [
    { key: 'grNumber', header: 'N° GR', cell: (r) => <span className="font-mono text-xs">{r.grNumber}</span>, width: '140px' },
    { key: 'poId', header: 'BC associé', cell: (r) => <span className="font-mono text-xs">{r.poId.slice(0, 8)}…</span> },
    { key: 'status', header: 'Statut', cell: (r) => <StatusBadge status={r.status} />, width: '140px' },
    {
      key: 'coldChainRequired',
      header: 'Chaîne du froid',
      cell: (r) => (r.coldChainRequired ? <StatusBadge status="warning" label="Oui" /> : <span className="text-xs text-slate-muted">Non</span>),
      width: '140px',
    },
    {
      key: 'receiptDate',
      header: 'Date réception',
      cell: (r) => <DateDisplay value={r.receiptDate} format="short" />,
      width: '140px',
    },
  ];

  return (
    <>
      <PageHeader title="Réceptions de marchandise" subtitle="Service fait constaté par le magasinier" />
      <div className="space-y-4 p-8">
        <FilterBar
          filters={{ status: statusFilter }}
          options={[{ key: 'status', label: 'Statut', values: STATUS_VALUES }]}
          onFilterChange={(key, value) => {
            if (key === 'status') setStatusFilter(value as GrStatus | undefined);
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
              icon={PackageCheck}
              title="Aucune réception"
              description="Les réceptions sont créées à partir d'un BC envoyé. Allez sur Achats → BC, ouvrez un BC, puis cliquez sur Nouvelle réception."
            />
          }
          onRowClick={(r) => router.push(`/procurement/goods-receipts/${r.id}`)}
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

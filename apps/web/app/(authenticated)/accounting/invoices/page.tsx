'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, Upload } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, type DataTableColumn } from '@/components/common/DataTable';
import { StatusBadge } from '@/components/common/StatusBadge';
import { AmountDisplay } from '@/components/common/AmountDisplay';
import { DateDisplay } from '@/components/common/DateDisplay';
import { EmptyState } from '@/components/common/EmptyState';
import { FilterBar } from '@/components/common/FilterBar';
import { Button } from '@/components/ui/button';
import { useListInvoices } from '@/hooks/use-invoicing';
import { usePermissions } from '@/hooks/use-permissions';
import type { Invoice, InvoiceStatus } from '@/lib/api/invoicing';

const PAGE_SIZE = 20;

const STATUS_VALUES: Array<{ value: InvoiceStatus; label: string }> = [
  { value: 'captured', label: 'Capturée' },
  { value: 'matched', label: 'Rapprochée' },
  { value: 'exception_price', label: 'Écart prix' },
  { value: 'exception_qty', label: 'Écart qté' },
  { value: 'posted', label: 'Comptabilisée' },
  { value: 'paid', label: 'Payée' },
  { value: 'rejected', label: 'Rejetée' },
  { value: 'archived', label: 'Archivée' },
];

export default function InvoicesListPage() {
  const router = useRouter();
  const permissions = usePermissions();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | undefined>();

  const { data, isLoading } = useListInvoices({
    page,
    pageSize: PAGE_SIZE,
    status: statusFilter,
    q: search || undefined,
  });

  const columns: DataTableColumn<Invoice>[] = [
    {
      key: 'invoiceNumber',
      header: 'N° facture',
      cell: (r) => <span className="font-mono text-xs">{r.invoiceNumber}</span>,
      width: '160px',
    },
    {
      key: 'supplierId',
      header: 'Fournisseur',
      cell: (r) => <span className="font-mono text-xs">{r.supplierId.slice(0, 8)}…</span>,
    },
    {
      key: 'status',
      header: 'Statut',
      cell: (r) => <StatusBadge status={r.status} />,
      width: '140px',
    },
    {
      key: 'totalTtc',
      header: 'Total TTC',
      cell: (r) => <AmountDisplay amount={r.totalTtc} currency={r.currency} />,
      align: 'right',
      width: '170px',
    },
    {
      key: 'invoiceDate',
      header: 'Date facture',
      cell: (r) => <DateDisplay value={r.invoiceDate} format="short" />,
      width: '130px',
    },
    {
      key: 'dueDate',
      header: 'Échéance',
      cell: (r) => <DateDisplay value={r.dueDate} format="short" />,
      width: '130px',
    },
    {
      key: 'ocrConfidence',
      header: 'OCR',
      cell: (r) =>
        r.ocrConfidence === null ? (
          <span className="text-xs text-slate-muted">manuelle</span>
        ) : (
          <span className="font-mono text-xs">{Math.round(r.ocrConfidence)}%</span>
        ),
      width: '90px',
    },
  ];

  return (
    <>
      <PageHeader
        title="Factures"
        subtitle="Cycle facturation : capture OCR → rapprochement 3-voies → comptabilisation"
        actions={
          permissions.canUploadInvoice() ? (
            <Button
              onClick={() => router.push('/accounting/invoices/upload')}
              data-testid="invoice-upload-btn"
            >
              <Upload className="mr-2 h-4 w-4" /> Uploader une facture
            </Button>
          ) : undefined
        }
      />
      <div className="space-y-4 p-8">
        <FilterBar
          search={search}
          onSearchChange={(s) => {
            setSearch(s);
            setPage(1);
          }}
          searchPlaceholder="Rechercher par n° facture…"
          filters={{ status: statusFilter }}
          options={[{ key: 'status', label: 'Statut', values: STATUS_VALUES }]}
          onFilterChange={(key, value) => {
            if (key === 'status') setStatusFilter(value as InvoiceStatus | undefined);
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
              icon={FileText}
              title="Aucune facture"
              description={
                permissions.canUploadInvoice()
                  ? 'Uploadez votre première facture PDF pour démarrer le cycle.'
                  : 'Aucune facture accessible avec votre rôle actuel.'
              }
              actionLabel={permissions.canUploadInvoice() ? 'Uploader une facture' : undefined}
              onAction={
                permissions.canUploadInvoice()
                  ? () => router.push('/accounting/invoices/upload')
                  : undefined
              }
            />
          }
          onRowClick={(r) => router.push(`/accounting/invoices/${r.id}`)}
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

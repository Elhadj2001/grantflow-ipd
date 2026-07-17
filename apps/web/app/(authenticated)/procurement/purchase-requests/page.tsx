'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FilePlus, Inbox, ShoppingCart, User } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, type DataTableColumn } from '@/components/common/DataTable';
import { StatusBadge } from '@/components/common/StatusBadge';
import { AmountDisplay } from '@/components/common/AmountDisplay';
import { DateDisplay } from '@/components/common/DateDisplay';
import { EmptyState } from '@/components/common/EmptyState';
import { FilterBar } from '@/components/common/FilterBar';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useListPRs, useListPendingApprovals } from '@/hooks/use-procurement';
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

/**
 * Fix `fix-pr-list-approver-scope` : sur cette page, les validateurs
 * (PI / CG / DAF / CAISSIER, ainsi que SUPER_ADMIN qui cumule ces droits)
 * doivent voir par défaut les DA qu'ILS doivent valider, pas celles
 * qu'ils ont eux-mêmes saisies. La liste standard `GET /purchase-requests`
 * scope par ownership et masque donc tout le travail à faire.
 *
 * Solution : un toggle « Mes DAs » / « À approuver » qui bascule entre
 * `useListPRs` (ownership) et `useListPendingApprovals` (workflow).
 * Le défaut est calculé d'après le rôle :
 *   - validateur → « À approuver » (le motif n°1 de venir sur la page)
 *   - autre      → « Mes DAs » (comportement historique)
 *
 * Le filtre statut reste actif uniquement en scope « Mes DAs » — l'autre
 * scope est par essence déjà filtré par le serveur sur le statut attendu
 * pour le rôle (pending_pi / pending_cg / pending_daf / pending_caissier).
 */
type Scope = 'mine' | 'to-approve';

export default function PurchaseRequestsListPage() {
  const router = useRouter();
  const permissions = usePermissions();

  const isValidator = useMemo(
    () =>
      permissions.canApprovePRAsPi() ||
      permissions.canApprovePRAsCg() ||
      permissions.canApprovePRAsDaf() ||
      permissions.canApprovePRAsCash(),
    [permissions],
  );

  const [scope, setScope] = useState<Scope>(isValidator ? 'to-approve' : 'mine');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<PrStatus | undefined>(undefined);

  const isMineScope = scope === 'mine';

  const mineQuery = useListPRs(
    {
      page,
      pageSize: PAGE_SIZE,
      status: statusFilter,
      search: search || undefined,
    },
    { enabled: isMineScope },
  );

  const pendingQuery = useListPendingApprovals(
    { page, pageSize: PAGE_SIZE },
    { enabled: !isMineScope },
  );

  const activeQuery = isMineScope ? mineQuery : pendingQuery;
  const data = activeQuery.data;
  const isLoading = activeQuery.isLoading;

  const handleScopeChange = (next: Scope) => {
    if (next === scope) return;
    setScope(next);
    setPage(1);
  };

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
      cell: (r) => (
        <AmountDisplay amount={r.totalAmount} currency={r.currency} amountXof={r.total_amount_xof} />
      ),
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
        {isValidator && (
          <div
            role="tablist"
            aria-label="Périmètre de la liste"
            className="inline-flex rounded-md border border-slate-200 bg-white p-1 text-sm"
          >
            <button
              type="button"
              role="tab"
              aria-selected={scope === 'to-approve'}
              onClick={() => handleScopeChange('to-approve')}
              className={cn(
                'inline-flex items-center gap-1.5 rounded px-3 py-1.5 transition',
                scope === 'to-approve'
                  ? 'bg-ipd-50 text-ipd-darker font-medium'
                  : 'text-slate-600 hover:bg-slate-50',
              )}
            >
              <Inbox className="h-3.5 w-3.5" />
              À approuver
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={scope === 'mine'}
              onClick={() => handleScopeChange('mine')}
              className={cn(
                'inline-flex items-center gap-1.5 rounded px-3 py-1.5 transition',
                scope === 'mine'
                  ? 'bg-ipd-50 text-ipd-darker font-medium'
                  : 'text-slate-600 hover:bg-slate-50',
              )}
            >
              <User className="h-3.5 w-3.5" />
              Mes DAs
            </button>
          </div>
        )}

        <FilterBar
          search={isMineScope ? search : ''}
          onSearchChange={
            isMineScope
              ? (s) => {
                  setSearch(s);
                  setPage(1);
                }
              : undefined
          }
          searchPlaceholder="Rechercher par n° ou description…"
          filters={isMineScope ? { status: statusFilter } : {}}
          options={
            isMineScope
              ? [{ key: 'status', label: 'Statut', values: STATUS_FILTER_VALUES }]
              : []
          }
          onFilterChange={(key, value) => {
            if (!isMineScope) return;
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
              title={
                isMineScope
                  ? "Aucune demande d'achat"
                  : 'Aucune DA à approuver'
              }
              description={
                isMineScope
                  ? search || statusFilter
                    ? 'Aucun résultat pour ces filtres.'
                    : "Créez votre première DA pour démarrer un cycle Procure-to-Pay."
                  : 'Plus rien à valider à votre niveau. Revenez plus tard ou consultez vos propres DAs.'
              }
              actionLabel={
                isMineScope && permissions.canCreatePR()
                  ? 'Créer la première DA'
                  : undefined
              }
              onAction={
                isMineScope && permissions.canCreatePR()
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

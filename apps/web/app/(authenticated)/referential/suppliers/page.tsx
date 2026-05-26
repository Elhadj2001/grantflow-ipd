'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Building2,
  Edit,
  Plus,
  RotateCcw,
  Search,
  ShieldOff,
  Trash2,
} from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SupplierForm } from '@/components/referential/SupplierForm';
import { cn } from '@/lib/utils';
import { ApiError } from '@/lib/api-client';
import {
  useCreateSupplier,
  useDeleteSupplier,
  useRestoreSupplier,
  useSuppliersList,
  useUpdateSupplier,
} from '@/hooks/use-referential';
import { usePermissions } from '@/hooks/use-permissions';
import type {
  CreateSupplierInput,
  Supplier,
  UpdateSupplierInput,
} from '@/lib/api/referential';

type StatusFilter = 'active' | 'inactive' | 'all';

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'active', label: 'Actifs' },
  { value: 'inactive', label: 'Inactifs' },
  { value: 'all', label: 'Tous' },
];

/**
 * CRUD Fournisseurs — sprint F5b-c Lot B.
 *
 * Liste paginable (pageSize=50) avec recherche serveur (pg_trgm si `q`)
 * et filtre statut. Création/édition via dialog, soft delete + restore
 * pour DAF/SUPER_ADMIN.
 */
export default function SuppliersListPage() {
  const router = useRouter();
  const perms = usePermissions();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [deleting, setDeleting] = useState<Supplier | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Gating au mount : non autorisé → redirect
  useEffect(() => {
    if (!perms.canManageSuppliers()) {
      router.replace('/dashboard');
    }
  }, [perms, router]);

  const apiQuery = useMemo(() => {
    const base: Record<string, unknown> = { pageSize: 50 };
    if (search.length > 0) base.q = search;
    if (statusFilter === 'active') base.isActive = true;
    else if (statusFilter === 'inactive') {
      base.isActive = false;
      base.includeInactive = true;
    } else {
      base.includeInactive = true;
    }
    return base;
  }, [search, statusFilter]);

  const { data, isLoading, isError } = useSuppliersList(apiQuery);

  const createM = useCreateSupplier();
  // Mutations contextuelles : id passé à useUpdateSupplier au moment de l'édition.
  const updateM = useUpdateSupplier(editing?.id ?? '');
  const deleteM = useDeleteSupplier();
  const restoreM = useRestoreSupplier();

  if (!perms.canManageSuppliers()) {
    return (
      <div className="px-8 py-12 text-center">
        <ShieldOff className="mx-auto h-10 w-10 text-state-error" />
        <p className="mt-2 text-sm text-slate-muted">
          Accès réservé aux rôles ACHETEUR / CONTROLEUR / DAF.
        </p>
      </div>
    );
  }

  const handleCreate = async (input: CreateSupplierInput | UpdateSupplierInput) => {
    setFormError(null);
    try {
      await createM.mutateAsync(input as CreateSupplierInput);
      setCreateOpen(false);
    } catch (e: unknown) {
      setFormError(formatApiError(e));
    }
  };

  const handleUpdate = async (input: CreateSupplierInput | UpdateSupplierInput) => {
    if (!editing) return;
    setFormError(null);
    try {
      await updateM.mutateAsync(input as UpdateSupplierInput);
      setEditing(null);
    } catch (e: unknown) {
      setFormError(formatApiError(e));
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    setDeleteError(null);
    try {
      await deleteM.mutateAsync(deleting.id);
      setDeleting(null);
    } catch (e: unknown) {
      setDeleteError(formatApiError(e));
    }
  };

  const handleRestore = async (s: Supplier) => {
    try {
      await restoreM.mutateAsync(s.id);
    } catch (e) {
      console.error('restore failed', e);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <Building2 className="h-6 w-6 text-ipd-darker" />
            Fournisseurs
          </span>
        }
        subtitle="Référentiel partagé — sourcing achats, paiements, audit"
        actions={
          <Button
            onClick={() => {
              setFormError(null);
              setCreateOpen(true);
            }}
            data-testid="open-create-supplier"
          >
            <Plus className="mr-1 h-4 w-4" />
            Nouveau fournisseur
          </Button>
        }
      />

      <div className="px-8 py-6 space-y-4">
        {/* Filtres */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs uppercase tracking-wide text-slate-muted">
              Recherche (code, nom)
            </Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-muted" />
              <Input
                data-testid="search-suppliers"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="BIOMED, Sénégal…"
                className="w-72 pl-9"
              />
            </div>
          </div>
          <div className="flex gap-1">
            {STATUS_OPTIONS.map((o) => (
              <Button
                key={o.value}
                size="sm"
                variant={statusFilter === o.value ? 'default' : 'outline'}
                onClick={() => setStatusFilter(o.value)}
                data-testid={`supplier-filter-${o.value}`}
              >
                {o.label}
              </Button>
            ))}
          </div>
          <span className="ml-2 text-xs text-slate-muted">
            {data?.total ?? 0} fournisseur{(data?.total ?? 0) > 1 ? 's' : ''}
          </span>
        </div>

        {isLoading && <p className="text-sm text-slate-muted">Chargement…</p>}
        {isError && (
          <p className="text-sm text-state-error">Impossible de charger les fournisseurs.</p>
        )}

        {!isLoading && (data?.data ?? []).length === 0 && (
          <div
            data-testid="suppliers-empty"
            className="rounded-lg border border-dashed border-slate-200 p-12 text-center"
          >
            <p className="text-sm text-slate-muted">Aucun fournisseur correspondant.</p>
          </div>
        )}

        {/* Liste cards */}
        <div
          data-testid="suppliers-list"
          className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3"
        >
          {(data?.data ?? []).map((s) => (
            <SupplierCard
              key={s.id}
              supplier={s}
              canDelete={perms.canDeleteSupplier()}
              onEdit={() => {
                setFormError(null);
                setEditing(s);
              }}
              onDelete={() => {
                setDeleteError(null);
                setDeleting(s);
              }}
              onRestore={() => handleRestore(s)}
              restoring={restoreM.isPending}
            />
          ))}
        </div>
      </div>

      {/* Dialog création */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-3xl" data-testid="create-supplier-dialog">
          <DialogHeader>
            <DialogTitle>Nouveau fournisseur</DialogTitle>
            <DialogDescription>
              Code MAJUSCULES (regex backend) — il sera immuable après création.
            </DialogDescription>
          </DialogHeader>
          <SupplierForm
            mode="create"
            loading={createM.isPending}
            errorMessage={formError}
            onSubmit={handleCreate}
            onCancel={() => setCreateOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Dialog édition */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-3xl" data-testid="edit-supplier-dialog">
          <DialogHeader>
            <DialogTitle>Modifier {editing?.code}</DialogTitle>
            <DialogDescription>
              Champs vidés transmis comme `null` au backend (PATCH = clear).
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <SupplierForm
              mode="edit"
              defaultValues={editing}
              loading={updateM.isPending}
              errorMessage={formError}
              onSubmit={handleUpdate}
              onCancel={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Dialog soft-delete */}
      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent data-testid="delete-supplier-dialog">
          <DialogHeader>
            <DialogTitle>Désactiver {deleting?.code} ?</DialogTitle>
            <DialogDescription>
              Soft-delete réversible (Restaurer disponible plus tard). Refusé si le
              fournisseur a des BC actifs (409 SUPPLIER_HAS_ACTIVE_POS).
            </DialogDescription>
          </DialogHeader>
          {deleteError && (
            <p
              data-testid="delete-supplier-error"
              className="rounded-md border border-state-error/30 bg-state-error/5 px-3 py-2 text-sm text-state-error"
            >
              {deleteError}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Annuler
            </Button>
            <Button
              onClick={handleDelete}
              disabled={deleteM.isPending}
              data-testid="confirm-delete-supplier"
            >
              <Trash2 className="mr-1 h-4 w-4" />
              {deleteM.isPending ? 'Désactivation…' : 'Désactiver'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface SupplierCardProps {
  supplier: Supplier;
  canDelete: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onRestore: () => void;
  restoring: boolean;
}

function SupplierCard({
  supplier,
  canDelete,
  onEdit,
  onDelete,
  onRestore,
  restoring,
}: SupplierCardProps) {
  return (
    <Card
      data-testid={`supplier-card-${supplier.code}`}
      data-active={supplier.isActive ? 'true' : 'false'}
      className={cn(
        'border-2',
        !supplier.isActive && 'bg-slate-50 border-slate-200',
      )}
    >
      <CardContent className="space-y-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-mono text-xs text-slate-muted">{supplier.code}</p>
            <p className="text-sm font-semibold text-ipd-darker">{supplier.name}</p>
          </div>
          {supplier.isActive ? (
            <Badge variant="success">Actif</Badge>
          ) : (
            <Badge variant="muted">Inactif</Badge>
          )}
        </div>
        <p className="text-xs text-slate-muted">
          {supplier.country ?? '—'} · {supplier.currencyDefault} · {supplier.paymentTermsDays}j
        </p>
        {supplier.iban && (
          <p className="text-xs text-slate-muted">
            IBAN : {supplier.iban.slice(0, 4)}… (BIC : {supplier.bic ?? '—'})
          </p>
        )}
        <div className="flex justify-end gap-1 pt-2">
          {supplier.isActive ? (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={onEdit}
                data-testid={`edit-supplier-${supplier.code}`}
              >
                <Edit className="h-3 w-3" />
              </Button>
              {canDelete && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onDelete}
                  data-testid={`delete-supplier-${supplier.code}`}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
            </>
          ) : (
            canDelete && (
              <Button
                size="sm"
                variant="outline"
                onClick={onRestore}
                disabled={restoring}
                data-testid={`restore-supplier-${supplier.code}`}
              >
                <RotateCcw className="mr-1 h-3 w-3" />
                Restaurer
              </Button>
            )
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Convertit une erreur API en message lisible. 409 DUPLICATE_CODE
 * et autres cas métier sont remontés tels quels (le backend renvoie un
 * code stable dans `body.code`).
 */
function formatApiError(e: unknown): string {
  if (e instanceof ApiError) {
    const code = e.body.code ? ` (${e.body.code})` : '';
    return `Erreur ${e.status} — ${e.body.message ?? 'cas métier'}${code}`;
  }
  if (e instanceof Error) return e.message;
  return 'Erreur inconnue';
}

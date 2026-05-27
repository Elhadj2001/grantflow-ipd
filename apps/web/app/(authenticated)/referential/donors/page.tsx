'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Edit,
  HandCoins,
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
import { DonorForm, DONOR_TYPE_LABELS_FR } from '@/components/referential/DonorForm';
import { cn } from '@/lib/utils';
import { ApiError } from '@/lib/api-client';
import {
  useCreateDonor,
  useDeleteDonor,
  useDonorsList,
  useRestoreDonor,
  useUpdateDonor,
} from '@/hooks/use-referential';
import { usePermissions } from '@/hooks/use-permissions';
import type {
  CreateDonorInput,
  Donor,
  DonorType,
  UpdateDonorInput,
} from '@/lib/api/referential';

type StatusFilter = 'active' | 'inactive' | 'all';

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'active', label: 'Actifs' },
  { value: 'inactive', label: 'Inactifs' },
  { value: 'all', label: 'Tous' },
];

/**
 * Sprint F-REF-BAILLEURS-PROJETS — CRUD Bailleurs.
 *
 * Liste paginable (pageSize=100) avec recherche serveur, filtre statut,
 * dialogs create/edit, soft-delete (DAF/SA) + restore.
 */
export default function DonorsListPage() {
  const router = useRouter();
  const perms = usePermissions();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Donor | null>(null);
  const [deleting, setDeleting] = useState<Donor | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Gating au mount : non autorisé → redirect (defense in depth — RBAC
  // backend reste autoritatif).
  useEffect(() => {
    if (perms.roles.length > 0 && !perms.canManageDonors()) {
      router.replace('/dashboard');
    }
  }, [perms, router]);

  const apiQuery = useMemo(() => {
    const base: Record<string, unknown> = { pageSize: 100 };
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

  const { data, isLoading, isError } = useDonorsList(apiQuery);

  const createM = useCreateDonor();
  const updateM = useUpdateDonor(editing?.id ?? '');
  const deleteM = useDeleteDonor();
  const restoreM = useRestoreDonor();

  if (perms.roles.length > 0 && !perms.canManageDonors()) {
    return (
      <div className="px-8 py-12 text-center" data-testid="donors-denied">
        <ShieldOff className="mx-auto h-10 w-10 text-state-error" />
        <p className="mt-2 text-sm text-slate-muted">
          Accès réservé aux rôles CONTROLEUR / DAF / SUPER_ADMIN.
        </p>
      </div>
    );
  }

  const handleCreate = async (input: CreateDonorInput | UpdateDonorInput) => {
    setFormError(null);
    try {
      await createM.mutateAsync(input as CreateDonorInput);
      setCreateOpen(false);
    } catch (e: unknown) {
      setFormError(formatApiError(e));
    }
  };

  const handleUpdate = async (input: CreateDonorInput | UpdateDonorInput) => {
    if (!editing) return;
    setFormError(null);
    try {
      await updateM.mutateAsync(input as UpdateDonorInput);
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

  const handleRestore = async (d: Donor) => {
    try {
      await restoreM.mutateAsync(d.id);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('donor restore failed', e);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <HandCoins className="h-6 w-6 text-ipd-darker" />
            Bailleurs
          </span>
        }
        subtitle="Référentiel — Bill & Melinda Gates Foundation, USAID, OMS, etc."
        actions={
          <Button
            onClick={() => {
              setFormError(null);
              setCreateOpen(true);
            }}
            data-testid="open-create-donor"
          >
            <Plus className="mr-1 h-4 w-4" />
            Nouveau bailleur
          </Button>
        }
      />

      <div className="px-8 py-6 space-y-4">
        {/* Filtres */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs uppercase tracking-wide text-slate-muted">
              Recherche (code, libellé, pays)
            </Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-muted" />
              <Input
                data-testid="search-donors"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="BMGF, GAVI, USAID…"
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
                data-testid={`donor-filter-${o.value}`}
              >
                {o.label}
              </Button>
            ))}
          </div>
          <span className="ml-2 text-xs text-slate-muted">
            {data?.total ?? 0} bailleur{(data?.total ?? 0) > 1 ? 's' : ''}
          </span>
        </div>

        {isLoading && <p className="text-sm text-slate-muted">Chargement…</p>}
        {isError && (
          <p className="text-sm text-state-error">Impossible de charger les bailleurs.</p>
        )}

        {!isLoading && (data?.data ?? []).length === 0 && (
          <div
            data-testid="donors-empty"
            className="rounded-lg border border-dashed border-slate-200 p-12 text-center"
          >
            <p className="text-sm text-slate-muted">Aucun bailleur correspondant.</p>
          </div>
        )}

        {/* Liste cards */}
        <div
          data-testid="donors-list"
          className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3"
        >
          {(data?.data ?? []).map((d) => (
            <DonorCard
              key={d.id}
              donor={d}
              canDelete={perms.canDeleteDonor()}
              onEdit={() => {
                setFormError(null);
                setEditing(d);
              }}
              onDelete={() => {
                setDeleteError(null);
                setDeleting(d);
              }}
              onRestore={() => handleRestore(d)}
              restoring={restoreM.isPending}
            />
          ))}
        </div>
      </div>

      {/* Dialog création */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-2xl" data-testid="create-donor-dialog">
          <DialogHeader>
            <DialogTitle>Nouveau bailleur</DialogTitle>
            <DialogDescription>
              Le code (MAJUSCULES) est l&apos;identifiant naturel du bailleur — il sera immuable.
            </DialogDescription>
          </DialogHeader>
          <DonorForm
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
        <DialogContent className="max-w-2xl" data-testid="edit-donor-dialog">
          <DialogHeader>
            <DialogTitle>Modifier {editing?.code}</DialogTitle>
            <DialogDescription>
              Modification du libellé, type, pays ou e-mail contact.
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <DonorForm
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
        <DialogContent data-testid="delete-donor-dialog">
          <DialogHeader>
            <DialogTitle>Désactiver {deleting?.code} ?</DialogTitle>
            <DialogDescription>
              Soft-delete réversible. Refusé si des grants sont rattachés
              au bailleur — il faudra d&apos;abord clore ou réaffecter ces grants.
            </DialogDescription>
          </DialogHeader>
          {deleteError && (
            <p
              data-testid="delete-donor-error"
              role="alert"
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
              data-testid="confirm-delete-donor"
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

interface DonorCardProps {
  donor: Donor;
  canDelete: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onRestore: () => void;
  restoring: boolean;
}

function DonorCard({
  donor,
  canDelete,
  onEdit,
  onDelete,
  onRestore,
  restoring,
}: DonorCardProps) {
  return (
    <Card
      data-testid={`donor-card-${donor.code}`}
      data-active={donor.isActive ? 'true' : 'false'}
      className={cn('border-2', !donor.isActive && 'bg-slate-50 border-slate-200')}
    >
      <CardContent className="space-y-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-mono text-xs text-slate-muted">{donor.code}</p>
            <p className="text-sm font-semibold text-ipd-darker">{donor.label}</p>
          </div>
          {donor.isActive ? (
            <Badge variant="success">Actif</Badge>
          ) : (
            <Badge variant="muted">Inactif</Badge>
          )}
        </div>
        <p className="text-xs text-slate-muted">
          {DONOR_TYPE_LABELS_FR[donor.type as DonorType]}
          {donor.country ? ` · ${donor.country}` : ''}
        </p>
        {donor.contactEmail && (
          <p className="truncate text-xs text-slate-muted">{donor.contactEmail}</p>
        )}
        <div className="flex justify-end gap-1 pt-2">
          {donor.isActive ? (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={onEdit}
                data-testid={`edit-donor-${donor.code}`}
              >
                <Edit className="h-3 w-3" />
              </Button>
              {canDelete && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onDelete}
                  data-testid={`delete-donor-${donor.code}`}
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
                data-testid={`restore-donor-${donor.code}`}
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

/** Format ApiError → message lisible (idem pattern Suppliers). */
function formatApiError(e: unknown): string {
  if (e instanceof ApiError) {
    const code = e.body.code ? ` (${e.body.code})` : '';
    return `Erreur ${e.status} — ${e.body.message ?? 'cas métier'}${code}`;
  }
  if (e instanceof Error) return e.message;
  return 'Erreur inconnue';
}

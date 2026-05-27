'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Edit,
  FolderKanban,
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
import {
  ProjectForm,
  PROJECT_STATUS_LABELS_FR,
} from '@/components/referential/ProjectForm';
import { cn } from '@/lib/utils';
import { ApiError } from '@/lib/api-client';
import {
  useCreateProject,
  useDeleteProject,
  useProjectsList,
  useRestoreProject,
  useUpdateProject,
} from '@/hooks/use-referential';
import { usePermissions } from '@/hooks/use-permissions';
import type {
  CreateProjectInput,
  Project,
  UpdateProjectInput,
} from '@/lib/api/referential';

type StatusFilter = 'active' | 'closed' | 'all';

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'active', label: 'Actifs' },
  { value: 'closed', label: 'Clos' },
  { value: 'all', label: 'Tous' },
];

/** Format date FR (DD/MM/YYYY) à partir d'une ISO YYYY-MM-DD. */
function formatDateFr(isoDate: string | null): string {
  if (!isoDate) return '—';
  const [y, m, d] = isoDate.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

export default function ProjectsListPage() {
  const router = useRouter();
  const perms = usePermissions();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState<Project | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (perms.roles.length > 0 && !perms.canManageProjects()) {
      router.replace('/dashboard');
    }
  }, [perms, router]);

  const apiQuery = useMemo(() => {
    const base: Record<string, unknown> = { pageSize: 100 };
    if (search.length > 0) base.q = search;
    if (statusFilter === 'active') base.status = 'active';
    else if (statusFilter === 'closed') base.status = 'closed';
    // 'all' : on lève le filtre d'activation (le backend gère via isActive
    // côté query — ici on accepte tous les statuts en omettant le filtre).
    return base;
  }, [search, statusFilter]);

  const { data, isLoading, isError } = useProjectsList(apiQuery);

  const createM = useCreateProject();
  const updateM = useUpdateProject(editing?.id ?? '');
  const deleteM = useDeleteProject();
  const restoreM = useRestoreProject();

  if (perms.roles.length > 0 && !perms.canManageProjects()) {
    return (
      <div className="px-8 py-12 text-center" data-testid="projects-denied">
        <ShieldOff className="mx-auto h-10 w-10 text-state-error" />
        <p className="mt-2 text-sm text-slate-muted">
          Accès réservé aux rôles CONTROLEUR / DAF / SUPER_ADMIN.
        </p>
      </div>
    );
  }

  const handleCreate = async (input: CreateProjectInput | UpdateProjectInput) => {
    setFormError(null);
    try {
      await createM.mutateAsync(input as CreateProjectInput);
      setCreateOpen(false);
    } catch (e: unknown) {
      setFormError(formatApiError(e));
    }
  };

  const handleUpdate = async (input: CreateProjectInput | UpdateProjectInput) => {
    if (!editing) return;
    setFormError(null);
    try {
      await updateM.mutateAsync(input as UpdateProjectInput);
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

  const handleRestore = async (p: Project) => {
    try {
      await restoreM.mutateAsync(p.id);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('project restore failed', e);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <FolderKanban className="h-6 w-6 text-ipd-darker" />
            Projets
          </span>
        }
        subtitle="Référentiel — programmes scientifiques porteurs de conventions"
        actions={
          <Button
            onClick={() => {
              setFormError(null);
              setCreateOpen(true);
            }}
            data-testid="open-create-project"
          >
            <Plus className="mr-1 h-4 w-4" />
            Nouveau projet
          </Button>
        }
      />

      <div className="px-8 py-6 space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs uppercase tracking-wide text-slate-muted">
              Recherche (code, titre)
            </Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-muted" />
              <Input
                data-testid="search-projects"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="MADIBA, PALU-DAKAR…"
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
                data-testid={`project-filter-${o.value}`}
              >
                {o.label}
              </Button>
            ))}
          </div>
          <span className="ml-2 text-xs text-slate-muted">
            {data?.total ?? 0} projet{(data?.total ?? 0) > 1 ? 's' : ''}
          </span>
        </div>

        {isLoading && <p className="text-sm text-slate-muted">Chargement…</p>}
        {isError && (
          <p className="text-sm text-state-error">Impossible de charger les projets.</p>
        )}

        {!isLoading && (data?.data ?? []).length === 0 && (
          <div
            data-testid="projects-empty"
            className="rounded-lg border border-dashed border-slate-200 p-12 text-center"
          >
            <p className="text-sm text-slate-muted">Aucun projet correspondant.</p>
          </div>
        )}

        <div
          data-testid="projects-list"
          className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3"
        >
          {(data?.data ?? []).map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              canDelete={perms.canDeleteProject()}
              onEdit={() => {
                setFormError(null);
                setEditing(p);
              }}
              onDelete={() => {
                setDeleteError(null);
                setDeleting(p);
              }}
              onRestore={() => handleRestore(p)}
              restoring={restoreM.isPending}
            />
          ))}
        </div>
      </div>

      {/* Dialog création */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-2xl" data-testid="create-project-dialog">
          <DialogHeader>
            <DialogTitle>Nouveau projet</DialogTitle>
            <DialogDescription>
              Le code (MAJUSCULES) est l&apos;identifiant naturel — immuable après création.
            </DialogDescription>
          </DialogHeader>
          <ProjectForm
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
        <DialogContent className="max-w-2xl" data-testid="edit-project-dialog">
          <DialogHeader>
            <DialogTitle>Modifier {editing?.code}</DialogTitle>
            <DialogDescription>
              Champs vidés transmis comme `null` au backend (PATCH = clear).
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <ProjectForm
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
        <DialogContent data-testid="delete-project-dialog">
          <DialogHeader>
            <DialogTitle>Fermer le projet {deleting?.code} ?</DialogTitle>
            <DialogDescription>
              Soft-delete (status=closed) réversible via Restaurer. Refusé si
              au moins un grant actif est rattaché (PROJECT_HAS_ACTIVE_GRANTS) —
              il faudra clore ou réaffecter les grants d&apos;abord.
            </DialogDescription>
          </DialogHeader>
          {deleteError && (
            <p
              data-testid="delete-project-error"
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
              data-testid="confirm-delete-project"
            >
              <Trash2 className="mr-1 h-4 w-4" />
              {deleteM.isPending ? 'Fermeture…' : 'Fermer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface ProjectCardProps {
  project: Project;
  canDelete: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onRestore: () => void;
  restoring: boolean;
}

function ProjectCard({
  project,
  canDelete,
  onEdit,
  onDelete,
  onRestore,
  restoring,
}: ProjectCardProps) {
  const isClosed = project.status === 'closed';
  const statusVariant = isClosed
    ? 'muted'
    : project.status === 'suspended'
      ? 'warning'
      : 'success';
  return (
    <Card
      data-testid={`project-card-${project.code}`}
      data-status={project.status}
      className={cn('border-2', isClosed && 'bg-slate-50 border-slate-200')}
    >
      <CardContent className="space-y-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-mono text-xs text-slate-muted">{project.code}</p>
            <p className="truncate text-sm font-semibold text-ipd-darker">{project.title}</p>
          </div>
          <Badge variant={statusVariant}>
            {PROJECT_STATUS_LABELS_FR[project.status]}
          </Badge>
        </div>
        <p className="text-xs text-slate-muted">
          {formatDateFr(project.startDate)} →{' '}
          {project.endDate ? formatDateFr(project.endDate) : '∞'}
        </p>
        {project.description && (
          <p className="line-clamp-2 text-xs text-slate-muted">{project.description}</p>
        )}
        <div className="flex justify-end gap-1 pt-2">
          {!isClosed ? (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={onEdit}
                data-testid={`edit-project-${project.code}`}
              >
                <Edit className="h-3 w-3" />
              </Button>
              {canDelete && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onDelete}
                  data-testid={`delete-project-${project.code}`}
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
                data-testid={`restore-project-${project.code}`}
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

function formatApiError(e: unknown): string {
  if (e instanceof ApiError) {
    const code = e.body.code ? ` (${e.body.code})` : '';
    return `Erreur ${e.status} — ${e.body.message ?? 'cas métier'}${code}`;
  }
  if (e instanceof Error) return e.message;
  return 'Erreur inconnue';
}

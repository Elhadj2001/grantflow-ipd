'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  KeyRound,
  Loader2,
  Plus,
  Power,
  RotateCcw,
  Search,
  ShieldOff,
  UserCog,
  Users,
} from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/button';
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
import { Badge } from '@/components/ui/badge';
import { AdminUserForm } from '@/components/admin/AdminUserForm';
import { AdminUserRolesBadges } from '@/components/admin/AdminUserRoleSelector';
import { useToast } from '@/hooks/use-toast';
import { ApiError } from '@/lib/api-client';
import {
  useActivateAdminUser,
  useAdminUsersList,
  useCreateAdminUser,
  useDeactivateAdminUser,
  useResetAdminUserPassword,
  useSetUserRoles,
  useUpdateAdminUser,
} from '@/hooks/use-admin-users';
import { usePermissions } from '@/hooks/use-permissions';
import type {
  AdminUser,
  CreateAdminUserInput,
  GrantflowRoleCode,
  UpdateAdminUserInput,
} from '@/lib/api/admin-users';

type StatusFilter = 'active' | 'inactive' | 'all';

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'active', label: 'Actifs' },
  { value: 'inactive', label: 'Inactifs' },
  { value: 'all', label: 'Tous' },
];

/**
 * Sprint F-ADMIN-USERS Lot D — page d'administration des utilisateurs.
 *
 * Liste paginée (pageSize=50) avec recherche serveur + filtre statut.
 * Dialogs create/edit/deactivate/reset-password. Tous les boutons gates
 * par canManageUsers() — un user non autorisé est redirigé.
 *
 * Garde-fou anti-self-deactivate : on désactive le bouton si l'id de la
 * cible = l'id de la session (le backend renvoie 409 de toute façon, mais
 * une UX préventive vaut mieux qu'un toast d'erreur après clic).
 */
export default function AdminUsersListPage() {
  const router = useRouter();
  const perms = usePermissions();
  const { data: session } = useSession();
  const { toast } = useToast();
  const meId = session?.userId ?? '';

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [deactivating, setDeactivating] = useState<AdminUser | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  // Gating au mount : non autorisé → redirect (RBAC déjà côté serveur,
  // ceci empêche juste le flash d'écran)
  useEffect(() => {
    if (perms.roles.length > 0 && !perms.canManageUsers()) {
      router.replace('/dashboard');
    }
  }, [perms, router]);

  const apiQuery = useMemo(() => {
    const base: Record<string, unknown> = { pageSize: 50 };
    if (search.length > 0) base.q = search;
    if (statusFilter === 'active') base.status = 'active';
    else if (statusFilter === 'inactive') {
      base.status = 'inactive';
      base.includeInactive = true;
    } else {
      base.includeInactive = true;
    }
    return base;
  }, [search, statusFilter]);

  const { data, isLoading, isError } = useAdminUsersList(apiQuery);

  const createM = useCreateAdminUser();
  const updateM = useUpdateAdminUser(editing?.id ?? '');
  const setRolesM = useSetUserRoles(editing?.id ?? '');
  const activateM = useActivateAdminUser();
  const deactivateM = useDeactivateAdminUser();
  const resetPasswordM = useResetAdminUserPassword();

  // Comptage des SUPER_ADMIN actifs visibles dans la page courante —
  // sert au garde-fou UI (verrouille SUPER_ADMIN si l'utilisateur édité
  // est le dernier). Le backend reste l'autorité.
  const lockedRolesForEdit = useMemo<GrantflowRoleCode[]>(() => {
    if (!editing) return [];
    const otherActiveSuperAdmins = (data?.data ?? []).filter(
      (u) =>
        u.id !== editing.id && u.status === 'active' && u.roles.includes('SUPER_ADMIN'),
    ).length;
    return editing.roles.includes('SUPER_ADMIN') && otherActiveSuperAdmins === 0
      ? ['SUPER_ADMIN']
      : [];
  }, [editing, data]);

  if (perms.roles.length > 0 && !perms.canManageUsers()) {
    return (
      <div className="px-8 py-12 text-center" data-testid="admin-users-denied">
        <ShieldOff className="mx-auto h-10 w-10 text-state-error" />
        <p className="mt-2 text-sm text-slate-muted">
          Accès réservé aux rôles SUPER_ADMIN / DAF.
        </p>
      </div>
    );
  }

  /**
   * Signature unifiée imposée par `AdminUserForm.onSubmit` : on reçoit
   * un payload `profile` typé `CreateAdminUserInput | UpdateAdminUserInput`.
   * On narrow ici selon le mode (create vs edit) avant l'appel mutation.
   */
  const handleCreate = async (input: {
    profile: CreateAdminUserInput | UpdateAdminUserInput;
    roles: GrantflowRoleCode[];
    rolesChanged: boolean;
  }) => {
    setFormError(null);
    // En mode create, le form garantit `email` + `roles` non-vides via Zod
    // + validation manuelle. Cast sûr.
    const createInput = input.profile as CreateAdminUserInput;
    try {
      const out = await createM.mutateAsync(createInput);
      toast({
        title: 'Utilisateur créé',
        description: out.invitationEmailSent
          ? 'Un e-mail de définition de mot de passe a été envoyé.'
          : "Compte créé. L'envoi de l'e-mail d'invitation a échoué — réessayer depuis le détail.",
      });
      setCreateOpen(false);
    } catch (e: unknown) {
      setFormError(formatApiError(e));
    }
  };

  const handleEdit = async (input: {
    profile: CreateAdminUserInput | UpdateAdminUserInput;
    roles: GrantflowRoleCode[];
    rolesChanged: boolean;
  }) => {
    if (!editing) return;
    setFormError(null);
    // En mode edit, le form construit un payload PATCH (UpdateAdminUserInput).
    const updateInput = input.profile as UpdateAdminUserInput;
    try {
      await updateM.mutateAsync(updateInput);
      if (input.rolesChanged) {
        await setRolesM.mutateAsync({ roles: input.roles });
      }
      toast({ title: 'Utilisateur mis à jour' });
      setEditing(null);
    } catch (e: unknown) {
      setFormError(formatApiError(e));
    }
  };

  const handleDeactivate = async () => {
    if (!deactivating) return;
    setConfirmError(null);
    try {
      await deactivateM.mutateAsync(deactivating.id);
      toast({ title: 'Compte désactivé' });
      setDeactivating(null);
    } catch (e) {
      setConfirmError(formatApiError(e));
    }
  };

  const handleActivate = async (u: AdminUser) => {
    try {
      await activateM.mutateAsync(u.id);
      toast({ title: 'Compte réactivé' });
    } catch (e) {
      toast({
        title: 'Réactivation impossible',
        description: formatApiError(e),
        variant: 'destructive',
      });
    }
  };

  const handleResetPassword = async (u: AdminUser) => {
    try {
      await resetPasswordM.mutateAsync(u.id);
      toast({
        title: 'E-mail envoyé',
        description: 'Un e-mail de définition de mot de passe a été envoyé à l\'utilisateur.',
      });
    } catch (e) {
      toast({
        title: 'Envoi impossible',
        description: formatApiError(e),
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <Users className="h-6 w-6 text-ipd-darker" />
            Utilisateurs
          </span>
        }
        subtitle="Administration des comptes — hybride Keycloak + base applicative"
        actions={
          <Button
            onClick={() => {
              setFormError(null);
              setCreateOpen(true);
            }}
            data-testid="open-create-admin-user"
          >
            <Plus className="mr-1 h-4 w-4" />
            Nouvel utilisateur
          </Button>
        }
      />

      <div className="px-8 py-6 space-y-4">
        {/* Filtres */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs uppercase tracking-wide text-slate-muted">
              Recherche (e-mail, nom, code RH)
            </Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-muted" />
              <Input
                data-testid="search-admin-users"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="diop, IPD-00, @pasteur.sn…"
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
                data-testid={`admin-user-filter-${o.value}`}
              >
                {o.label}
              </Button>
            ))}
          </div>
          <span className="ml-2 text-xs text-slate-muted">
            {data?.total ?? 0} utilisateur{(data?.total ?? 0) > 1 ? 's' : ''}
          </span>
        </div>

        {isLoading && (
          <p className="text-sm text-slate-muted">
            <Loader2 className="inline h-3 w-3 animate-spin" /> Chargement…
          </p>
        )}
        {isError && (
          <p className="text-sm text-state-error">Impossible de charger les utilisateurs.</p>
        )}

        {!isLoading && (data?.data ?? []).length === 0 && (
          <div
            data-testid="admin-users-empty"
            className="rounded-lg border border-dashed border-slate-200 p-12 text-center"
          >
            <p className="text-sm text-slate-muted">Aucun utilisateur correspondant.</p>
          </div>
        )}

        {/* Liste */}
        <div data-testid="admin-users-list" className="grid grid-cols-1 gap-3">
          {(data?.data ?? []).map((u) => (
            <UserRow
              key={u.id}
              user={u}
              isSelf={u.id === meId}
              onEdit={() => {
                setFormError(null);
                setEditing(u);
              }}
              onDeactivate={() => {
                setConfirmError(null);
                setDeactivating(u);
              }}
              onActivate={() => handleActivate(u)}
              onResetPassword={() => handleResetPassword(u)}
              isResetPending={resetPasswordM.isPending}
              isActivatePending={activateM.isPending}
            />
          ))}
        </div>
      </div>

      {/* Dialog création */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-3xl" data-testid="create-admin-user-dialog">
          <DialogHeader>
            <DialogTitle>Nouvel utilisateur</DialogTitle>
            <DialogDescription>
              L&apos;e-mail sera l&apos;identifiant Keycloak. Un mail de définition de mot
              de passe sera envoyé automatiquement.
            </DialogDescription>
          </DialogHeader>
          <AdminUserForm
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
        <DialogContent className="max-w-3xl" data-testid="edit-admin-user-dialog">
          <DialogHeader>
            <DialogTitle>Modifier {editing?.fullName}</DialogTitle>
            <DialogDescription>
              Profil + rôles. Les changements de rôles s&apos;appliquent à Keycloak ET à la
              base applicative.
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <AdminUserForm
              mode="edit"
              defaultValues={editing}
              loading={updateM.isPending || setRolesM.isPending}
              errorMessage={formError}
              lockedRoles={lockedRolesForEdit}
              onSubmit={handleEdit}
              onCancel={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Dialog désactivation */}
      <Dialog open={!!deactivating} onOpenChange={(o) => !o && setDeactivating(null)}>
        <DialogContent data-testid="deactivate-admin-user-dialog">
          <DialogHeader>
            <DialogTitle>Désactiver {deactivating?.fullName} ?</DialogTitle>
            <DialogDescription>
              L&apos;utilisateur ne pourra plus se connecter à Keycloak (enabled=false).
              L&apos;opération est réversible — l&apos;historique des actions est conservé.
            </DialogDescription>
          </DialogHeader>
          {confirmError && (
            <p
              data-testid="deactivate-admin-user-error"
              role="alert"
              className="rounded-md border border-state-error/30 bg-state-error/5 px-3 py-2 text-sm text-state-error"
            >
              {confirmError}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeactivating(null)}>
              Annuler
            </Button>
            <Button
              onClick={handleDeactivate}
              disabled={deactivateM.isPending}
              data-testid="confirm-deactivate-admin-user"
            >
              <Power className="mr-1 h-4 w-4" />
              {deactivateM.isPending ? 'Désactivation…' : 'Désactiver'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface UserRowProps {
  user: AdminUser;
  isSelf: boolean;
  onEdit: () => void;
  onDeactivate: () => void;
  onActivate: () => void;
  onResetPassword: () => void;
  isResetPending: boolean;
  isActivatePending: boolean;
}

function UserRow({
  user,
  isSelf,
  onEdit,
  onDeactivate,
  onActivate,
  onResetPassword,
  isResetPending,
  isActivatePending,
}: UserRowProps) {
  const isInactive = user.status === 'inactive';
  return (
    <Card
      data-testid={`admin-user-row-${user.email}`}
      data-status={user.status}
      data-is-self={isSelf ? 'true' : 'false'}
      className={isInactive ? 'border-slate-200 bg-slate-50' : ''}
    >
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold text-ipd-darker">
              {user.fullName}
            </p>
            {isInactive ? (
              <Badge variant="muted">Inactif</Badge>
            ) : (
              <Badge variant="success">Actif</Badge>
            )}
            {isSelf && (
              <Badge variant="muted" data-testid="badge-self">
                Vous
              </Badge>
            )}
            {!user.enabled && !isInactive && (
              <Badge variant="warning" title="Désynchro Keycloak ↔ AppUser">
                KC désactivé
              </Badge>
            )}
          </div>
          <p className="truncate text-xs text-slate-muted">{user.email}</p>
          {(user.department || user.employeeCode) && (
            <p className="text-xs text-slate-muted">
              {user.department ?? '—'}
              {user.employeeCode ? ` · ${user.employeeCode}` : ''}
            </p>
          )}
          <AdminUserRolesBadges roles={user.roles} />
        </div>

        <div className="flex gap-1">
          <Button
            size="sm"
            variant="outline"
            onClick={onEdit}
            data-testid={`edit-admin-user-${user.email}`}
          >
            <UserCog className="mr-1 h-3 w-3" /> Modifier
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onResetPassword}
            disabled={isResetPending}
            data-testid={`reset-password-${user.email}`}
            title="Envoyer un e-mail de définition de mot de passe via Keycloak"
          >
            <KeyRound className="mr-1 h-3 w-3" /> MDP
          </Button>
          {isInactive ? (
            <Button
              size="sm"
              variant="outline"
              onClick={onActivate}
              disabled={isActivatePending}
              data-testid={`activate-admin-user-${user.email}`}
            >
              <RotateCcw className="mr-1 h-3 w-3" /> Réactiver
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={onDeactivate}
              disabled={isSelf}
              title={isSelf ? 'Impossible de se désactiver soi-même' : 'Désactiver le compte'}
              data-testid={`deactivate-admin-user-${user.email}`}
            >
              <Power className="mr-1 h-3 w-3" /> Désactiver
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/** Convertit une erreur API en message lisible (cf. SuppliersListPage). */
function formatApiError(e: unknown): string {
  if (e instanceof ApiError) {
    const code = e.body.code ? ` (${e.body.code})` : '';
    return `Erreur ${e.status} — ${e.body.message ?? 'cas métier'}${code}`;
  }
  if (e instanceof Error) return e.message;
  return 'Erreur inconnue';
}

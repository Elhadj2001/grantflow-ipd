'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { AdminUserRoleSelector } from './AdminUserRoleSelector';
import type {
  AdminUser,
  CreateAdminUserInput,
  GrantflowRoleCode,
  UpdateAdminUserInput,
} from '@/lib/api/admin-users';

/** Schéma aligné sur CreateAdminUserDto + UpdateAdminUserDto backend. */
const AdminUserFormSchema = z.object({
  email: z.string().email('Adresse e-mail invalide').min(3).max(255),
  fullName: z.string().min(2, 'Min 2 caractères').max(255),
  department: z.string().max(128).optional().or(z.literal('')),
  employeeCode: z.string().max(64).optional().or(z.literal('')),
});

export type AdminUserFormValues = z.infer<typeof AdminUserFormSchema>;

export interface AdminUserFormProps {
  mode: 'create' | 'edit';
  defaultValues?: AdminUser;
  loading?: boolean;
  errorMessage?: string | null;
  /**
   * Sous-soumet la combinaison (profil, rôles). Le parent décide si
   * l'envoi va vers createAdminUser (POST), updateAdminUser (PATCH)
   * ou les deux (cas typique : "create" envoie POST direct ; "edit"
   * envoie PATCH puis PUT roles en cas de changement).
   */
  onSubmit: (input: {
    profile: CreateAdminUserInput | UpdateAdminUserInput;
    roles: GrantflowRoleCode[];
    rolesChanged: boolean;
  }) => Promise<void> | void;
  onCancel?: () => void;
  className?: string;
}

/**
 * Form combiné profil + rôles. Conserve son propre state pour les rôles
 * (les boutons toggleables ne s'intègrent pas naturellement à RHF).
 * Au submit, on calcule rolesChanged pour signaler au parent si un PUT
 * /roles doit suivre le PATCH profil (en edit). En create, les deux
 * partent dans la même payload POST.
 *
 * Garde-fou anti-lock-out géré côté UI : si l'utilisateur édité est le
 * dernier SUPER_ADMIN, on lock SUPER_ADMIN dans le selector. Le parent
 * passe `lockedRoles=['SUPER_ADMIN']` dans ce cas — décision parent
 * car il a accès au count cross-users.
 */
export function AdminUserForm({
  mode,
  defaultValues,
  loading,
  errorMessage,
  lockedRoles,
  onSubmit,
  onCancel,
  className,
}: AdminUserFormProps & { lockedRoles?: GrantflowRoleCode[] }) {
  const initialRoles: GrantflowRoleCode[] =
    (defaultValues?.roles as GrantflowRoleCode[] | undefined) ?? [];
  const [roles, setRoles] = useState<GrantflowRoleCode[]>(initialRoles);
  const [rolesError, setRolesError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<AdminUserFormValues>({
    resolver: zodResolver(AdminUserFormSchema),
    defaultValues: {
      email: defaultValues?.email ?? '',
      fullName: defaultValues?.fullName ?? '',
      department: defaultValues?.department ?? '',
      employeeCode: defaultValues?.employeeCode ?? '',
    },
  });

  // Re-sync si defaultValues arrive async (fetch détail user)
  useEffect(() => {
    if (defaultValues && mode === 'edit') {
      reset({
        email: defaultValues.email,
        fullName: defaultValues.fullName,
        department: defaultValues.department ?? '',
        employeeCode: defaultValues.employeeCode ?? '',
      });
      setRoles((defaultValues.roles as GrantflowRoleCode[]) ?? []);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(defaultValues), mode]);

  const submit = handleSubmit((values) => {
    if (roles.length === 0) {
      setRolesError('Au moins un rôle est obligatoire');
      return;
    }
    setRolesError(null);

    const cleanCreate = (v: string | undefined): string | undefined =>
      v && v.length > 0 ? v : undefined;
    const cleanUpdate = (v: string | undefined): string | undefined | null =>
      v && v.length > 0 ? v : null;

    if (mode === 'create') {
      const payload: CreateAdminUserInput = {
        email: values.email,
        fullName: values.fullName,
        department: cleanCreate(values.department),
        employeeCode: cleanCreate(values.employeeCode),
        roles,
      };
      void onSubmit({ profile: payload, roles, rolesChanged: true });
    } else {
      const payload: UpdateAdminUserInput = {
        fullName: values.fullName,
        department: cleanUpdate(values.department),
        employeeCode: cleanUpdate(values.employeeCode),
      };
      const rolesChanged =
        roles.length !== initialRoles.length ||
        roles.some((r) => !initialRoles.includes(r));
      void onSubmit({ profile: payload, roles, rolesChanged });
    }
  });

  return (
    <form
      onSubmit={submit}
      data-testid={`admin-user-form-${mode}`}
      className={cn('space-y-4', className)}
    >
      {/* E-mail (read-only en edit — Keycloak `username` lié) */}
      <div className="space-y-1">
        <Label htmlFor="admin-user-email" className="text-xs uppercase tracking-wide">
          E-mail <span className="text-state-error">*</span>
        </Label>
        <Input
          id="admin-user-email"
          type="email"
          placeholder="prenom.nom@pasteur.sn"
          {...register('email')}
          readOnly={mode === 'edit'}
          data-testid="admin-user-email-input"
          className={cn(mode === 'edit' && 'bg-slate-50 text-slate-muted')}
        />
        {errors.email && (
          <p className="text-xs text-state-error" role="alert">
            {errors.email.message}
          </p>
        )}
        {mode === 'edit' && (
          <p className="text-xs text-slate-muted">
            L&apos;e-mail est lié au compte Keycloak — non modifiable depuis ce formulaire.
          </p>
        )}
      </div>

      {/* fullName */}
      <div className="space-y-1">
        <Label htmlFor="admin-user-fullname" className="text-xs uppercase tracking-wide">
          Nom complet <span className="text-state-error">*</span>
        </Label>
        <Input
          id="admin-user-fullname"
          placeholder="Aïssatou DIALLO"
          {...register('fullName')}
          data-testid="admin-user-fullname-input"
        />
        {errors.fullName && (
          <p className="text-xs text-state-error" role="alert">
            {errors.fullName.message}
          </p>
        )}
      </div>

      {/* Department / employeeCode */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="admin-user-department" className="text-xs uppercase tracking-wide">
            Service
          </Label>
          <Input
            id="admin-user-department"
            placeholder="Finance & Comptabilité"
            {...register('department')}
            data-testid="admin-user-department-input"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="admin-user-employeecode" className="text-xs uppercase tracking-wide">
            Code RH
          </Label>
          <Input
            id="admin-user-employeecode"
            placeholder="IPD-0042"
            {...register('employeeCode')}
            data-testid="admin-user-employeecode-input"
          />
        </div>
      </div>

      {/* Rôles */}
      <div className="space-y-1">
        <Label className="text-xs uppercase tracking-wide">
          Rôles <span className="text-state-error">*</span>
        </Label>
        <AdminUserRoleSelector
          value={roles}
          onChange={setRoles}
          readonlyRoles={lockedRoles}
        />
        {rolesError && (
          <p className="text-xs text-state-error" role="alert">
            {rolesError}
          </p>
        )}
      </div>

      {/* Erreur globale (renvoyée par le backend) */}
      {errorMessage && (
        <p
          data-testid="admin-user-form-error"
          role="alert"
          className="rounded-md border border-state-error/30 bg-state-error/5 px-3 py-2 text-sm text-state-error"
        >
          {errorMessage}
        </p>
      )}

      {mode === 'create' && (
        <p className="rounded-md border border-ipd-50 bg-ipd-50/30 px-3 py-2 text-xs text-ipd-darker">
          À la création, un e-mail de définition de mot de passe sera envoyé à
          l&apos;adresse fournie via Keycloak (action UPDATE_PASSWORD).
        </p>
      )}

      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
            Annuler
          </Button>
        )}
        <Button type="submit" disabled={loading} data-testid="admin-user-form-submit">
          <Save className="mr-1 h-4 w-4" />
          {loading ? 'Enregistrement…' : mode === 'create' ? 'Créer' : 'Enregistrer'}
        </Button>
      </div>
    </form>
  );
}

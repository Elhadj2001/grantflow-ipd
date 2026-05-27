'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  PROJECT_STATUSES,
  type CreateProjectInput,
  type Project,
  type ProjectStatus,
  type UpdateProjectInput,
} from '@/lib/api/referential';

// Aligné sur CreateProjectDto backend (cf.
// apps/api/src/referential/project/dto/create-project.dto.ts).
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const ProjectFormSchema = z
  .object({
    code: z
      .string()
      .regex(/^[A-Z][A-Z0-9-]{2,63}$/, 'Code MAJUSCULES, 3-64 caractères (ex: MADIBA-VAC-2026)'),
    title: z.string().min(5, 'Min 5 caractères').max(255),
    startDate: z.string().regex(ISO_DATE, 'Date ISO YYYY-MM-DD requise'),
    endDate: z.string().regex(ISO_DATE).optional().or(z.literal('')),
    status: z.enum(PROJECT_STATUSES),
    description: z.string().max(2000).optional().or(z.literal('')),
  })
  // Le backend valide aussi endDate > startDate (refine au niveau DTO).
  // On reproduit ici pour un feedback immédiat sans aller-retour.
  .refine(
    (v) => !v.endDate || v.endDate === '' || v.endDate > v.startDate,
    { message: 'La date de fin doit être strictement après la date de début', path: ['endDate'] },
  );

export type ProjectFormValues = z.infer<typeof ProjectFormSchema>;

/** Libellés FR des statuts projet. */
export const PROJECT_STATUS_LABELS_FR: Record<ProjectStatus, string> = {
  active: 'Actif',
  suspended: 'Suspendu',
  closed: 'Clos',
};

export interface ProjectFormProps {
  mode: 'create' | 'edit';
  defaultValues?: Project;
  loading?: boolean;
  errorMessage?: string | null;
  onSubmit: (input: CreateProjectInput | UpdateProjectInput) => Promise<void> | void;
  onCancel?: () => void;
  className?: string;
}

/**
 * Formulaire Projet (create + edit). Le code est immuable en édition
 * (identifiant naturel utilisé dans les codes de DA/BC consolidés).
 *
 * piUserId / programId NE sont PAS exposés dans le form simple : ils
 * relèvent du paramétrage projet (assignation PI / programme parent)
 * accessible ailleurs. Pour rester minimal, on n'expose ici que les
 * champs strictement nécessaires à la création d'un projet ; on pourra
 * étendre ultérieurement avec un picker PI (canViewPI).
 */
export function ProjectForm({
  mode,
  defaultValues,
  loading,
  errorMessage,
  onSubmit,
  onCancel,
  className,
}: ProjectFormProps) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ProjectFormValues>({
    resolver: zodResolver(ProjectFormSchema),
    defaultValues: {
      code: defaultValues?.code ?? '',
      title: defaultValues?.title ?? '',
      startDate: defaultValues?.startDate?.slice(0, 10) ?? '',
      endDate: defaultValues?.endDate?.slice(0, 10) ?? '',
      status: defaultValues?.status ?? 'active',
      description: defaultValues?.description ?? '',
    },
  });

  useEffect(() => {
    if (defaultValues && mode === 'edit') {
      reset({
        code: defaultValues.code,
        title: defaultValues.title,
        startDate: defaultValues.startDate.slice(0, 10),
        endDate: defaultValues.endDate?.slice(0, 10) ?? '',
        status: defaultValues.status,
        description: defaultValues.description ?? '',
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(defaultValues), mode]);

  const submit = handleSubmit((values) => {
    const cleanStr = (v: string | undefined): string | undefined =>
      v && v.length > 0 ? v : undefined;
    const cleanForUpdate = (v: string | undefined): string | undefined | null =>
      v && v.length > 0 ? v : null;

    if (mode === 'create') {
      const payload: CreateProjectInput = {
        code: values.code,
        title: values.title,
        startDate: values.startDate,
        endDate: cleanStr(values.endDate),
        status: values.status,
        description: cleanStr(values.description),
      };
      void onSubmit(payload);
    } else {
      // En PATCH, on permet d'effacer endDate / description via null.
      const payload: UpdateProjectInput = {
        title: values.title,
        startDate: values.startDate,
        endDate: cleanForUpdate(values.endDate),
        status: values.status,
        description: cleanForUpdate(values.description),
      };
      void onSubmit(payload);
    }
  });

  return (
    <form
      onSubmit={submit}
      data-testid={`project-form-${mode}`}
      className={cn('space-y-4', className)}
    >
      {/* Code (immuable en edit) */}
      <div className="space-y-1">
        <Label htmlFor="project-code" className="text-xs uppercase tracking-wide">
          Code <span className="text-state-error">*</span>
        </Label>
        <Input
          id="project-code"
          placeholder="MADIBA-VAC-2026"
          {...register('code')}
          readOnly={mode === 'edit'}
          data-testid="project-code-input"
          className={cn(mode === 'edit' && 'bg-slate-50 text-slate-muted uppercase')}
        />
        {errors.code && (
          <p className="text-xs text-state-error" role="alert">
            {errors.code.message}
          </p>
        )}
        {mode === 'edit' && (
          <p className="text-xs text-slate-muted">
            Le code projet est l&apos;identifiant naturel — non modifiable après création.
          </p>
        )}
      </div>

      {/* Title */}
      <div className="space-y-1">
        <Label htmlFor="project-title" className="text-xs uppercase tracking-wide">
          Titre <span className="text-state-error">*</span>
        </Label>
        <Input
          id="project-title"
          placeholder="Madiba Vaccine Platform 2026-2029"
          {...register('title')}
          data-testid="project-title-input"
        />
        {errors.title && (
          <p className="text-xs text-state-error" role="alert">
            {errors.title.message}
          </p>
        )}
      </div>

      {/* StartDate + EndDate + Status */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="project-start" className="text-xs uppercase tracking-wide">
            Date de début <span className="text-state-error">*</span>
          </Label>
          <Input
            id="project-start"
            type="date"
            {...register('startDate')}
            data-testid="project-startdate-input"
          />
          {errors.startDate && (
            <p className="text-xs text-state-error" role="alert">
              {errors.startDate.message}
            </p>
          )}
        </div>
        <div className="space-y-1">
          <Label htmlFor="project-end" className="text-xs uppercase tracking-wide">
            Date de fin
          </Label>
          <Input
            id="project-end"
            type="date"
            {...register('endDate')}
            data-testid="project-enddate-input"
          />
          {errors.endDate && (
            <p className="text-xs text-state-error" role="alert">
              {errors.endDate.message}
            </p>
          )}
        </div>
        <div className="space-y-1">
          <Label htmlFor="project-status" className="text-xs uppercase tracking-wide">
            Statut <span className="text-state-error">*</span>
          </Label>
          <select
            id="project-status"
            {...register('status')}
            data-testid="project-status-select"
            className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ipd-dark"
          >
            {PROJECT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {PROJECT_STATUS_LABELS_FR[s]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Description */}
      <div className="space-y-1">
        <Label htmlFor="project-desc" className="text-xs uppercase tracking-wide">
          Description
        </Label>
        <textarea
          id="project-desc"
          rows={3}
          placeholder="Objectifs, partenaires, programme scientifique…"
          {...register('description')}
          data-testid="project-description-input"
          className="flex w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ipd-dark"
        />
        {errors.description && (
          <p className="text-xs text-state-error" role="alert">
            {errors.description.message}
          </p>
        )}
      </div>

      {errorMessage && (
        <p
          data-testid="project-form-error"
          role="alert"
          className="rounded-md border border-state-error/30 bg-state-error/5 px-3 py-2 text-sm text-state-error"
        >
          {errorMessage}
        </p>
      )}

      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
            Annuler
          </Button>
        )}
        <Button type="submit" disabled={loading} data-testid="project-form-submit">
          <Save className="mr-1 h-4 w-4" />
          {loading ? 'Enregistrement…' : mode === 'create' ? 'Créer' : 'Enregistrer'}
        </Button>
      </div>
    </form>
  );
}

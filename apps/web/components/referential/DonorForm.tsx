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
  DONOR_TYPES,
  type CreateDonorInput,
  type Donor,
  type DonorType,
  type UpdateDonorInput,
} from '@/lib/api/referential';

// Schéma Zod aligné sur CreateDonorDto backend (cf.
// apps/api/src/referential/donor/dto/create-donor.dto.ts). On accepte
// chaîne vide pour les champs optionnels et on les nettoie au submit.
const DonorFormSchema = z.object({
  code: z
    .string()
    .regex(/^[A-Z0-9][A-Z0-9-]{1,31}$/, 'Code MAJUSCULES (2-32 caractères, chiffres et - autorisés)'),
  label: z.string().min(2, 'Min 2 caractères').max(255),
  type: z.enum(DONOR_TYPES),
  country: z.string().min(2).max(64).optional().or(z.literal('')),
  contactEmail: z.string().email('E-mail invalide').max(255).optional().or(z.literal('')),
});

export type DonorFormValues = z.infer<typeof DonorFormSchema>;

/** Libellés FR des DonorType — séparés du backend (côté front uniquement). */
export const DONOR_TYPE_LABELS_FR: Record<DonorType, string> = {
  public_intl: 'Public international',
  private_foundation: 'Fondation privée',
  bilateral: 'Bailleur bilatéral',
  multilateral: 'Bailleur multilatéral',
  government: 'Gouvernement',
  own_funds: 'Fonds propres',
};

export interface DonorFormProps {
  mode: 'create' | 'edit';
  defaultValues?: Donor;
  loading?: boolean;
  errorMessage?: string | null;
  /** Submit nettoyé (chaînes vides → undefined). */
  onSubmit: (input: CreateDonorInput | UpdateDonorInput) => Promise<void> | void;
  onCancel?: () => void;
  className?: string;
}

/**
 * Formulaire Bailleur (create + edit). Code immuable en édition (cf.
 * convention métier — le code sert d'identifiant naturel dans les
 * exports / le mapping bailleur SYSCEBNL).
 */
export function DonorForm({
  mode,
  defaultValues,
  loading,
  errorMessage,
  onSubmit,
  onCancel,
  className,
}: DonorFormProps) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<DonorFormValues>({
    resolver: zodResolver(DonorFormSchema),
    defaultValues: {
      code: defaultValues?.code ?? '',
      label: defaultValues?.label ?? '',
      type: defaultValues?.type ?? 'public_intl',
      country: defaultValues?.country ?? '',
      contactEmail: defaultValues?.contactEmail ?? '',
    },
  });

  useEffect(() => {
    if (defaultValues && mode === 'edit') {
      reset({
        code: defaultValues.code,
        label: defaultValues.label,
        type: defaultValues.type,
        country: defaultValues.country ?? '',
        contactEmail: defaultValues.contactEmail ?? '',
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(defaultValues), mode]);

  const submit = handleSubmit((values) => {
    const cleanStr = (v: string | undefined): string | undefined =>
      v && v.length > 0 ? v : undefined;

    if (mode === 'create') {
      const payload: CreateDonorInput = {
        code: values.code,
        label: values.label,
        type: values.type,
        country: cleanStr(values.country),
        contactEmail: cleanStr(values.contactEmail),
      };
      void onSubmit(payload);
    } else {
      // En PATCH, on n'envoie que les champs explicitement modifiés.
      // Pour rester simple ici, on envoie tout — le backend gère
      // l'idempotence. Code reste éditable côté form mais le bouton
      // serait invalidé côté backend si on retire DUPLICATE_CODE → reste
      // un cas que l'UI signale (toast).
      const payload: UpdateDonorInput = {
        code: values.code,
        label: values.label,
        type: values.type,
        country: cleanStr(values.country),
        contactEmail: cleanStr(values.contactEmail),
      };
      void onSubmit(payload);
    }
  });

  return (
    <form
      onSubmit={submit}
      data-testid={`donor-form-${mode}`}
      className={cn('space-y-4', className)}
    >
      {/* Code (immuable en edit) */}
      <div className="space-y-1">
        <Label htmlFor="donor-code" className="text-xs uppercase tracking-wide">
          Code <span className="text-state-error">*</span>
        </Label>
        <Input
          id="donor-code"
          placeholder="BMGF, EDCTP, USAID…"
          {...register('code')}
          readOnly={mode === 'edit'}
          data-testid="donor-code-input"
          className={cn(mode === 'edit' && 'bg-slate-50 text-slate-muted uppercase')}
        />
        {errors.code && (
          <p className="text-xs text-state-error" role="alert">
            {errors.code.message}
          </p>
        )}
        {mode === 'edit' && (
          <p className="text-xs text-slate-muted">
            Le code est l&apos;identifiant naturel du bailleur — non modifiable après création.
          </p>
        )}
      </div>

      {/* Label */}
      <div className="space-y-1">
        <Label htmlFor="donor-label" className="text-xs uppercase tracking-wide">
          Libellé <span className="text-state-error">*</span>
        </Label>
        <Input
          id="donor-label"
          placeholder="Bill & Melinda Gates Foundation"
          {...register('label')}
          data-testid="donor-label-input"
        />
        {errors.label && (
          <p className="text-xs text-state-error" role="alert">
            {errors.label.message}
          </p>
        )}
      </div>

      {/* Type */}
      <div className="space-y-1">
        <Label htmlFor="donor-type" className="text-xs uppercase tracking-wide">
          Type <span className="text-state-error">*</span>
        </Label>
        <select
          id="donor-type"
          {...register('type')}
          data-testid="donor-type-select"
          className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ipd-dark"
        >
          {DONOR_TYPES.map((t) => (
            <option key={t} value={t}>
              {DONOR_TYPE_LABELS_FR[t]}
            </option>
          ))}
        </select>
        {errors.type && (
          <p className="text-xs text-state-error" role="alert">
            {errors.type.message}
          </p>
        )}
      </div>

      {/* Country + ContactEmail */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="donor-country" className="text-xs uppercase tracking-wide">
            Pays
          </Label>
          <Input
            id="donor-country"
            placeholder="US, FR, SN…"
            {...register('country')}
            data-testid="donor-country-input"
          />
          {errors.country && (
            <p className="text-xs text-state-error" role="alert">
              {errors.country.message}
            </p>
          )}
        </div>
        <div className="space-y-1">
          <Label htmlFor="donor-email" className="text-xs uppercase tracking-wide">
            E-mail contact
          </Label>
          <Input
            id="donor-email"
            type="email"
            placeholder="audit@bailleur.org"
            {...register('contactEmail')}
            data-testid="donor-email-input"
          />
          {errors.contactEmail && (
            <p className="text-xs text-state-error" role="alert">
              {errors.contactEmail.message}
            </p>
          )}
        </div>
      </div>

      {errorMessage && (
        <p
          data-testid="donor-form-error"
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
        <Button type="submit" disabled={loading} data-testid="donor-form-submit">
          <Save className="mr-1 h-4 w-4" />
          {loading ? 'Enregistrement…' : mode === 'create' ? 'Créer' : 'Enregistrer'}
        </Button>
      </div>
    </form>
  );
}

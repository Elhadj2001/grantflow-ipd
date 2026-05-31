'use client';

import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Link from 'next/link';
import { AlertTriangle, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { DonorPicker } from '@/components/procurement/pickers/DonorPicker';
import { ProjectPicker } from '@/components/procurement/pickers/ProjectPicker';
import type { CreateGrantInput, Grant } from '@/lib/api/referential';

const GRANT_STATUS = ['draft', 'active'] as const;
const SUPPORTED_CURRENCIES = ['XOF', 'EUR', 'USD', 'GBP', 'CHF'] as const;

const GrantFormSchema = z.object({
  reference: z
    .string()
    .min(3, 'Référence requise (≥ 3 caractères)')
    .max(64, 'Référence trop longue'),
  donorId: z.string().uuid('Bailleur (UUID) requis'),
  projectId: z.string().uuid('Projet (UUID) requis'),
  amount: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, 'Montant invalide (max 2 décimales)'),
  currency: z.enum(SUPPORTED_CURRENCIES),
  overheadRate: z
    .number({ invalid_type_error: 'Taux numérique requis' })
    .min(0, '≥ 0')
    .max(1, '≤ 1 (ex: 0.15 pour 15%)'),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date début (YYYY-MM-DD)'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date fin (YYYY-MM-DD)'),
  status: z.enum(GRANT_STATUS),
  signedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
  notes: z.string().max(2000).optional().or(z.literal('')),
}).refine((v) => v.startDate <= v.endDate, {
  message: 'Date de fin doit être ≥ date de début',
  path: ['endDate'],
});

export type GrantFormValues = z.infer<typeof GrantFormSchema>;

export interface GrantFormProps {
  defaultValues?: Partial<GrantFormValues>;
  /** Mode édition : limite l'édition si transactions présentes. */
  mode?: 'create' | 'edit';
  /** Indique si le grant a des écritures comptables (édition limitée). */
  hasActiveTransactions?: boolean;
  /** Bouton "Annuler" cliquable. */
  onCancel?: () => void;
  /** Soumission — caller appelle createGrant ou updateGrant. */
  onSubmit: (values: GrantFormValues) => Promise<void> | void;
  /** Désactive les inputs (mutation in flight). */
  loading?: boolean;
  /** Message d'erreur serveur à afficher. */
  errorMessage?: string | null;
  className?: string;
}

/**
 * Formulaire création / édition d'une convention bailleur (Grant).
 *
 * Validation Zod stricte (montants, dates, FK UUID). Mode édition :
 * si `hasActiveTransactions=true`, on désactive donor/project/currency/
 * dates pour éviter les incohérences comptables (les écritures
 * existantes pointent vers ces FK). Status, overhead, notes restent
 * modifiables.
 *
 * Pour le sprint F-PILOTAGE, donorId et projectId sont saisis en UUID
 * brut (champ texte) — un picker dédié peut être ajouté dans un sprint
 * suivant (réutilisant ProjectPicker existant côté procurement).
 */
export function GrantForm({
  defaultValues,
  mode = 'create',
  hasActiveTransactions = false,
  onCancel,
  onSubmit,
  loading,
  errorMessage,
  className,
}: GrantFormProps) {
  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors },
  } = useForm<GrantFormValues>({
    resolver: zodResolver(GrantFormSchema),
    defaultValues: {
      reference: '',
      donorId: '',
      projectId: '',
      amount: '0',
      currency: 'XOF',
      overheadRate: 0.15,
      startDate: '',
      endDate: '',
      status: 'draft',
      signedAt: '',
      notes: '',
      ...defaultValues,
    },
  });

  // Re-sync defaults si le caller passe des values async (fetch puis edit).
  useEffect(() => {
    if (defaultValues) {
      reset({ ...defaultValues } as GrantFormValues);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(defaultValues)]);

  const lockHard = mode === 'edit' && hasActiveTransactions;

  const submitting = handleSubmit(async (values) => {
    await onSubmit(values);
  });

  return (
    <form
      data-testid="grant-form"
      data-mode={mode}
      data-locked={lockHard ? 'true' : 'false'}
      onSubmit={submitting}
      className={cn('space-y-4', className)}
    >
      {lockHard && (
        <div
          data-testid="grant-form-lock-banner"
          className="flex items-start gap-2 rounded-md border border-state-warning/30 bg-state-warning/5 px-3 py-2 text-sm text-state-warning"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4" />
          <p>
            Convention active — édition limitée. Les imputations comptables existantes
            interdisent la modification du bailleur, du projet, de la devise et des dates.
          </p>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Identification</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Field
            label="Référence (ex. BMGF-2026-001)"
            error={errors.reference?.message}
          >
            <Input
              data-testid="field-reference"
              {...register('reference')}
              disabled={loading}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            {/* Sprint F-REF-BAILLEURS-PROJETS : UUID brut remplacé par
                un DonorPicker (combobox CODE — label). La valeur
                envoyée reste l'UUID, l'utilisateur ne le voit pas. */}
            <Field label="Bailleur" error={errors.donorId?.message}>
              <Controller
                control={control}
                name="donorId"
                render={({ field }) => (
                  <div data-testid="field-donor">
                    <DonorPicker
                      value={field.value || null}
                      onChange={(id) => field.onChange(id ?? '')}
                      disabled={loading || lockHard}
                    />
                    <p className="mt-1 text-xs text-slate-muted">
                      Pas de bailleur disponible ?{' '}
                      <Link
                        href="/referential/donors"
                        className="text-ipd-darker underline-offset-2 hover:underline"
                      >
                        Créer un bailleur
                      </Link>
                    </p>
                  </div>
                )}
              />
            </Field>
            {/* Sprint F-REF-BAILLEURS-PROJETS : idem côté Projet — ProjectPicker
                était déjà disponible côté procurement, on le réutilise. */}
            <Field label="Projet" error={errors.projectId?.message}>
              <Controller
                control={control}
                name="projectId"
                render={({ field }) => (
                  <div data-testid="field-project">
                    <ProjectPicker
                      value={field.value || null}
                      onChange={(id) => field.onChange(id ?? '')}
                      disabled={loading || lockHard}
                      autoSelectSingle={false}
                    />
                    <p className="mt-1 text-xs text-slate-muted">
                      Pas de projet disponible ?{' '}
                      <Link
                        href="/referential/projects"
                        className="text-ipd-darker underline-offset-2 hover:underline"
                      >
                        Créer un projet
                      </Link>
                    </p>
                  </div>
                )}
              />
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Montants &amp; Période</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Montant" error={errors.amount?.message}>
              <Input
                data-testid="field-amount"
                {...register('amount')}
                disabled={loading || lockHard}
              />
            </Field>
            <Field label="Devise" error={errors.currency?.message}>
              <select
                data-testid="field-currency"
                {...register('currency')}
                disabled={loading || lockHard}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
              >
                {SUPPORTED_CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date début (YYYY-MM-DD)" error={errors.startDate?.message}>
              <Input
                data-testid="field-startdate"
                type="date"
                {...register('startDate')}
                disabled={loading || lockHard}
              />
            </Field>
            <Field label="Date fin (YYYY-MM-DD)" error={errors.endDate?.message}>
              <Input
                data-testid="field-enddate"
                type="date"
                {...register('endDate')}
                disabled={loading || lockHard}
              />
            </Field>
          </div>
          <Field
            label="Taux d'overhead (0.15 = 15%)"
            error={errors.overheadRate?.message}
          >
            <Input
              data-testid="field-overhead"
              type="number"
              step="0.0001"
              {...register('overheadRate', { valueAsNumber: true })}
              disabled={loading}
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Statut &amp; Notes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Field label="Statut initial" error={errors.status?.message}>
            <select
              data-testid="field-status"
              {...register('status')}
              disabled={loading}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
            >
              {GRANT_STATUS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Date de signature (optionnel)" error={errors.signedAt?.message}>
            <Input
              data-testid="field-signedat"
              type="date"
              {...register('signedAt')}
              disabled={loading}
            />
          </Field>
          <Field label="Notes (optionnel)" error={errors.notes?.message}>
            <textarea
              data-testid="field-notes"
              {...register('notes')}
              disabled={loading}
              rows={3}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </Field>
        </CardContent>
      </Card>

      {errorMessage && (
        <p
          data-testid="grant-form-error"
          className="rounded-md border border-state-error/30 bg-state-error/5 px-3 py-2 text-sm text-state-error"
        >
          {errorMessage}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
            Annuler
          </Button>
        )}
        <Button type="submit" disabled={loading} data-testid="grant-form-submit">
          <Save className="mr-1 h-4 w-4" />
          {mode === 'create' ? 'Créer la convention' : 'Enregistrer'}
        </Button>
      </div>
    </form>
  );
}

interface FieldProps {
  label: string;
  error?: string;
  children: React.ReactNode;
}

function Field({ label, error, children }: FieldProps) {
  return (
    <div className="space-y-1">
      <Label className="text-xs uppercase tracking-wide text-slate-muted">{label}</Label>
      {children}
      {error && <p className="text-xs text-state-error">{error}</p>}
    </div>
  );
}

/**
 * Convertit un `Grant` (response API) en valeurs initiales du formulaire.
 */
export function grantToFormValues(g: Grant): Partial<GrantFormValues> {
  return {
    reference: g.reference,
    donorId: g.donorId,
    projectId: g.projectId,
    amount: g.amount,
    currency: (SUPPORTED_CURRENCIES as readonly string[]).includes(g.currency)
      ? (g.currency as typeof SUPPORTED_CURRENCIES[number])
      : 'XOF',
    overheadRate: Number(g.overheadRate),
    startDate: g.startDate.slice(0, 10),
    endDate: g.endDate.slice(0, 10),
    // edit ne propose pas closed/suspended (workflow dédié — actions)
    status: g.status === 'closed' || g.status === 'suspended' ? 'active' : (g.status as 'draft' | 'active'),
    signedAt: g.signedAt ? g.signedAt.slice(0, 10) : '',
    notes: g.notes ?? '',
  };
}

/**
 * Convertit les valeurs du formulaire en payload accepté par
 * POST /grants. Les champs OPTIONNELS vides (signedAt, notes) sont
 * envoyés comme `undefined` — JSON.stringify les retire alors du body,
 * ce qui évite que Zod côté backend rejette `null` sur un `.optional()`.
 *
 * Fix create-grant-nullable : le backend a été migré à `.nullish()` (donc
 * accepte null) mais on garde cette normalisation côté front en
 * ceinture+bretelles. Si une future API change `.optional()` → null
 * refusé, le front continuera à fonctionner.
 */
export function formValuesToCreateInput(v: GrantFormValues): CreateGrantInput {
  const cleanOptional = (s: string | undefined): string | undefined => {
    const trimmed = s?.trim?.();
    return trimmed && trimmed.length > 0 ? trimmed : undefined;
  };
  return {
    reference: v.reference,
    donorId: v.donorId,
    projectId: v.projectId,
    amount: v.amount,
    currency: v.currency,
    overheadRate: v.overheadRate,
    startDate: v.startDate,
    endDate: v.endDate,
    status: v.status,
    signedAt: cleanOptional(v.signedAt),
    notes: cleanOptional(v.notes),
  };
}

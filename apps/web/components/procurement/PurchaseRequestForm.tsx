'use client';

import * as React from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Trash2 } from 'lucide-react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { AmountDisplay } from '@/components/common/AmountDisplay';
import { cn } from '@/lib/utils';
import type { CreatePurchaseRequestInput, PrType } from '@/lib/api/procurement';

const LineSchema = z.object({
  description: z.string().min(2, 'Description trop courte'),
  quantity: z.coerce.number().positive('Quantité doit être > 0'),
  unit: z.string().default('unit'),
  unitPrice: z.coerce.number().nonnegative('Prix unitaire ≥ 0'),
  budgetLineId: z.string().uuid('Ligne budgétaire requise'),
});

const PrFormSchema = z.object({
  description: z.string().min(5, 'Description min 5 caractères'),
  projectId: z.string().uuid('Projet requis'),
  grantId: z.string().uuid('Convention requise'),
  costCenterId: z.string().uuid().or(z.literal('')).optional(),
  activityId: z.string().uuid().or(z.literal('')).optional(),
  neededBy: z.string().optional(),
  currency: z.string().default('XOF'),
  requestType: z.enum(['standard', 'petty_cash', 'cash_advance']).default('standard'),
  lines: z.array(LineSchema).min(1, 'Au moins une ligne requise'),
});

export type PrFormValues = z.infer<typeof PrFormSchema>;

export interface PurchaseRequestFormProps {
  defaultValues?: Partial<PrFormValues>;
  onSubmit: (values: CreatePurchaseRequestInput) => void | Promise<void>;
  submitting?: boolean;
  /** Label du bouton submit. */
  submitLabel?: string;
  /** Slot pour boutons additionnels (Annuler, Sauvegarder brouillon, …). */
  extraActions?: React.ReactNode;
}

const PETTY_CASH_CEILING = 100_000;

/**
 * Formulaire DA — version sprint F2 minimaliste mais fonctionnelle :
 *  - Champs principaux (description, projet, grant, neededBy, currency)
 *  - Type DA : standard / petty_cash / cash_advance (toggle)
 *  - Lignes éditables (description, qty, unitPrice, budgetLineId)
 *  - Total calculé live (sum qty*unitPrice)
 *  - Alerte si petty_cash ET total > 100 000 XOF
 *  - Validation Zod via @hookform/resolvers
 *
 * Sprint F2 : les IDs (projectId, grantId, budgetLineId) sont saisis
 * en UUID brut. Sprint F2.x : on remplace par des Combobox alimentées
 * par /referential/projects, /grants, /budget-lines.
 */
export function PurchaseRequestForm({
  defaultValues,
  onSubmit,
  submitting = false,
  submitLabel = 'Enregistrer le brouillon',
  extraActions,
}: PurchaseRequestFormProps) {
  const form = useForm<PrFormValues>({
    resolver: zodResolver(PrFormSchema),
    defaultValues: {
      description: '',
      projectId: '',
      grantId: '',
      costCenterId: '',
      activityId: '',
      neededBy: '',
      currency: 'XOF',
      requestType: 'standard',
      lines: [
        { description: '', quantity: 1, unit: 'unit', unitPrice: 0, budgetLineId: '' },
      ],
      ...defaultValues,
    },
  });
  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = form;
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });

  const watchedLines = watch('lines');
  const watchedType = watch('requestType') as PrType;
  const total = watchedLines.reduce((s, l) => {
    const q = Number(l.quantity) || 0;
    const p = Number(l.unitPrice) || 0;
    return s + q * p;
  }, 0);
  const pettyCashExceeded = watchedType === 'petty_cash' && total > PETTY_CASH_CEILING;

  const submit = handleSubmit(async (values) => {
    // Normalise : enlève les chaînes vides des champs optionnels
    const payload: CreatePurchaseRequestInput = {
      description: values.description,
      projectId: values.projectId,
      grantId: values.grantId,
      costCenterId: values.costCenterId && values.costCenterId !== '' ? values.costCenterId : undefined,
      activityId: values.activityId && values.activityId !== '' ? values.activityId : undefined,
      neededBy: values.neededBy && values.neededBy !== '' ? values.neededBy : undefined,
      currency: values.currency,
      requestType: values.requestType,
      lines: values.lines.map((l) => ({
        description: l.description,
        quantity: Number(l.quantity),
        unit: l.unit || 'unit',
        unitPrice: Number(l.unitPrice),
        budgetLineId: l.budgetLineId,
      })),
    };
    await onSubmit(payload);
  });

  return (
    <form onSubmit={submit} className="space-y-6" data-testid="pr-form">
      {/* Type DA */}
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <Label className="mb-2 block text-sm font-medium">Type de demande</Label>
        <div className="flex flex-wrap gap-2">
          {(['standard', 'petty_cash', 'cash_advance'] as const).map((t) => (
            <button
              type="button"
              key={t}
              data-testid={`pr-type-${t}`}
              onClick={() => setValue('requestType', t, { shouldValidate: false })}
              className={cn(
                'rounded-full border px-4 py-1.5 text-sm font-medium transition-colors',
                watchedType === t
                  ? 'border-ipd-dark bg-ipd-50 text-ipd-darker'
                  : 'border-slate-200 bg-white text-slate-muted hover:border-ipd-dark hover:text-ipd-darker',
              )}
            >
              {t === 'standard' ? 'Standard' : t === 'petty_cash' ? 'Petite caisse' : 'Avance mission'}
            </button>
          ))}
          {watchedType === 'petty_cash' && (
            <Badge variant="secondary" className="ml-auto">
              Plafond {PETTY_CASH_CEILING.toLocaleString('fr-FR')} XOF
            </Badge>
          )}
        </div>
      </div>

      {/* Champs principaux */}
      <div className="grid grid-cols-1 gap-4 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <Label htmlFor="description">Objet de la demande *</Label>
          <Input id="description" {...register('description')} placeholder="Achat de réactifs…" />
          {errors.description && (
            <p className="mt-1 text-xs text-state-error">{errors.description.message}</p>
          )}
        </div>
        <div>
          <Label htmlFor="projectId">Projet (UUID) *</Label>
          <Input id="projectId" {...register('projectId')} placeholder="00000000-…" />
          {errors.projectId && (
            <p className="mt-1 text-xs text-state-error">{errors.projectId.message}</p>
          )}
        </div>
        <div>
          <Label htmlFor="grantId">Convention (UUID) *</Label>
          <Input id="grantId" {...register('grantId')} placeholder="00000000-…" />
          {errors.grantId && (
            <p className="mt-1 text-xs text-state-error">{errors.grantId.message}</p>
          )}
        </div>
        <div>
          <Label htmlFor="costCenterId">Centre de coût (UUID, optionnel)</Label>
          <Input id="costCenterId" {...register('costCenterId')} />
        </div>
        <div>
          <Label htmlFor="activityId">Activité (UUID, optionnel)</Label>
          <Input id="activityId" {...register('activityId')} />
        </div>
        <div>
          <Label htmlFor="neededBy">Date souhaitée</Label>
          <Input id="neededBy" type="date" {...register('neededBy')} />
        </div>
        <div>
          <Label htmlFor="currency">Devise</Label>
          <select
            id="currency"
            {...register('currency')}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            {['XOF', 'EUR', 'USD', 'CHF', 'GBP'].map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Lignes */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
        <div className="flex items-center justify-between">
          <Label>Lignes ({fields.length})</Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              append({
                description: '',
                quantity: 1,
                unit: 'unit',
                unitPrice: 0,
                budgetLineId: '',
              })
            }
            data-testid="add-line"
          >
            <Plus className="mr-1 h-4 w-4" /> Ajouter une ligne
          </Button>
        </div>
        {errors.lines && typeof errors.lines.message === 'string' && (
          <p className="text-xs text-state-error">{errors.lines.message}</p>
        )}
        <div className="space-y-3">
          {fields.map((f, i) => (
            <div
              key={f.id}
              data-testid={`pr-line-${i}`}
              className="grid grid-cols-1 gap-2 rounded-md border border-slate-100 bg-slate-50 p-3 md:grid-cols-12 md:items-end"
            >
              <div className="md:col-span-4">
                <Label className="text-xs">Description</Label>
                <Input {...register(`lines.${i}.description` as const)} />
              </div>
              <div className="md:col-span-1">
                <Label className="text-xs">Qté</Label>
                <Input type="number" step="0.01" {...register(`lines.${i}.quantity` as const)} />
              </div>
              <div className="md:col-span-1">
                <Label className="text-xs">Unité</Label>
                <Input {...register(`lines.${i}.unit` as const)} />
              </div>
              <div className="md:col-span-2">
                <Label className="text-xs">Prix unit.</Label>
                <Input type="number" step="0.01" {...register(`lines.${i}.unitPrice` as const)} />
              </div>
              <div className="md:col-span-3">
                <Label className="text-xs">Ligne budgétaire (UUID)</Label>
                <Input {...register(`lines.${i}.budgetLineId` as const)} />
              </div>
              <div className="md:col-span-1 flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Supprimer ligne ${i + 1}`}
                  onClick={() => remove(i)}
                  disabled={fields.length === 1}
                  data-testid={`remove-line-${i}`}
                >
                  <Trash2 className="h-4 w-4 text-state-error" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Total + alerte petty cash */}
      <div
        className={cn(
          'flex flex-col gap-2 rounded-lg border bg-white p-4 sm:flex-row sm:items-center sm:justify-between',
          pettyCashExceeded ? 'border-state-error' : 'border-slate-200',
        )}
      >
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-muted">Total estimé</p>
          <AmountDisplay amount={total} currency={watch('currency')} className="text-2xl" />
        </div>
        {pettyCashExceeded && (
          <p
            role="alert"
            data-testid="petty-cash-warning"
            className="text-sm font-medium text-state-error"
          >
            ⚠ Le total dépasse le plafond petty cash ({PETTY_CASH_CEILING.toLocaleString('fr-FR')} XOF).
          </p>
        )}
      </div>

      <div className="flex items-center justify-end gap-2">
        {extraActions}
        <Button type="submit" disabled={submitting || pettyCashExceeded} data-testid="pr-submit">
          {submitting ? 'Enregistrement…' : submitLabel}
        </Button>
      </div>
    </form>
  );
}

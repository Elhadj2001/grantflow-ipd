'use client';

import * as React from 'react';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Trash2 } from 'lucide-react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { AmountDisplay } from '@/components/common/AmountDisplay';
import { Combobox } from '@/components/ui/combobox';
import { ProjectPicker } from '@/components/procurement/pickers/ProjectPicker';
import { GrantPicker } from '@/components/procurement/pickers/GrantPicker';
import { BudgetLinePicker } from '@/components/procurement/pickers/BudgetLinePicker';
import { useExpenseNatures, useGrant, useGrantDashboard } from '@/hooks/use-referential';
import { cn } from '@/lib/utils';
import type { CreatePurchaseRequestInput, PrType } from '@/lib/api/procurement';
import { convertAmount, FX_SUPPORTED_CURRENCIES } from '@/lib/fx-fallback';

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
  // US-064 — éligibilité : structure seule (le métier est jugé par
  // l'EligibilityEngine au submit, ADR-007).
  expenseNatureCode: z.string().optional(),
  pasteurParisReimbursed: z.boolean().default(false),
  supplierInvoiceNumber: z.string().optional(),
  lines: z.array(LineSchema).min(1, 'Au moins une ligne requise'),
});

export type PrFormValues = z.infer<typeof PrFormSchema>;

export interface PurchaseRequestFormProps {
  defaultValues?: Partial<PrFormValues>;
  onSubmit: (values: CreatePurchaseRequestInput) => void | Promise<void>;
  submitting?: boolean;
  submitLabel?: string;
  extraActions?: React.ReactNode;
}

const PETTY_CASH_CEILING = 100_000;

/**
 * Formulaire DA — sprint F2.x : les saisies UUID brutes ont été
 * remplacées par des combobox alimentées par /referential/*.
 *
 * Cascade analytique au niveau header :
 *   ProjectPicker  →  GrantPicker  →  (devise auto, currency=grant.currency)
 *
 * À chaque ligne, BudgetLinePicker filtré par le grantId du header.
 * La disponibilité (`available`) vient du même endpoint
 * `/grants/:id/dashboard` (cache TanStack partagé) — on affiche un
 * badge "Solde insuffisant" et on désactive le submit si nécessaire.
 *
 * Les champs costCenterId / activityId sont conservés dans le schéma
 * mais masqués (sprint F2.y dédié quand `analytical-axes` exposera
 * sa hiérarchie). Pré-remplissage possible via `defaultValues`.
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
      expenseNatureCode: '',
      pasteurParisReimbursed: false,
      supplierInvoiceNumber: '',
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
  const watchedGrantId = watch('grantId');
  const watchedProjectId = watch('projectId');
  const watchedCurrency = watch('currency');

  // Charge le dashboard du grant courant : sert à mapper budgetLineId → available
  // pour le contrôle "Solde insuffisant" par ligne. Cache partagé avec
  // les BudgetLinePicker en aval (même clé TanStack Query).
  const { data: grantDashboard } = useGrantDashboard(watchedGrantId || null);
  // US-064 : catalogue des natures de dépense (staleTime 5 min, cache
  // référentiel partagé). Le select alimente expense_nature_code (US-054).
  const { data: expenseNatures, isLoading: naturesLoading } = useExpenseNatures();
  // Fix da-multi-currency : on a besoin de la devise convention pour
  // (a) afficher l'alerte "devise différente" et (b) convertir les
  // line totals avant la comparaison budgétaire. `useGrantDashboard`
  // n'expose pas la devise, donc on charge le grant complet via useGrant.
  const { data: grant } = useGrant(watchedGrantId || null);
  const grantCurrency = grant?.currency ?? null;
  const currencyMismatch =
    grantCurrency != null &&
    watchedCurrency.length > 0 &&
    watchedCurrency !== grantCurrency;

  const availableByLine = React.useMemo(() => {
    const m = new Map<string, { available: number; budgeted: number }>();
    for (const e of grantDashboard?.byBudgetLine ?? []) {
      m.set(e.budgetLineId, { available: e.available, budgeted: e.budgeted });
    }
    return m;
  }, [grantDashboard]);

  const linesWithComputed = watchedLines.map((l) => {
    const q = Number(l.quantity) || 0;
    const p = Number(l.unitPrice) || 0;
    const lineTotal = q * p;
    const ref = l.budgetLineId ? availableByLine.get(l.budgetLineId) : null;
    // Fix da-multi-currency : `available` est exprimé dans la devise de
    // la convention (grantCurrency). Si la DA est dans une autre devise,
    // on convertit lineTotal AVANT la comparaison budgétaire. Si la
    // conversion échoue (devise inconnue) on désactive le contrôle UI —
    // le serveur reste autoritatif (re-vérifie au submit avec les vrais
    // taux du jour).
    let lineTotalInGrantCurrency: number | null = lineTotal;
    if (grantCurrency && watchedCurrency && watchedCurrency !== grantCurrency) {
      lineTotalInGrantCurrency = convertAmount(lineTotal, watchedCurrency, grantCurrency);
    }
    const insufficient =
      !!ref && lineTotalInGrantCurrency != null && lineTotalInGrantCurrency > ref.available;
    return { lineTotal, available: ref?.available ?? null, insufficient };
  });

  const total = linesWithComputed.reduce((s, l) => s + l.lineTotal, 0);
  const pettyCashExceeded = watchedType === 'petty_cash' && total > PETTY_CASH_CEILING;
  const anyLineInsufficient = linesWithComputed.some((l) => l.insufficient);
  const submitDisabled = submitting || pettyCashExceeded || anyLineInsufficient;

  const submit = handleSubmit(async (values) => {
    const payload: CreatePurchaseRequestInput = {
      description: values.description,
      projectId: values.projectId,
      grantId: values.grantId,
      costCenterId: values.costCenterId && values.costCenterId !== '' ? values.costCenterId : undefined,
      activityId: values.activityId && values.activityId !== '' ? values.activityId : undefined,
      neededBy: values.neededBy && values.neededBy !== '' ? values.neededBy : undefined,
      currency: values.currency,
      requestType: values.requestType,
      expenseNatureCode:
        values.expenseNatureCode && values.expenseNatureCode !== ''
          ? values.expenseNatureCode
          : undefined,
      pasteurParisReimbursed: values.pasteurParisReimbursed ?? false,
      supplierInvoiceNumber:
        values.supplierInvoiceNumber && values.supplierInvoiceNumber !== ''
          ? values.supplierInvoiceNumber
          : undefined,
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

      {/* Champs principaux + imputation analytique */}
      <div className="grid grid-cols-1 gap-4 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <Label htmlFor="description">Objet de la demande *</Label>
          <Input id="description" {...register('description')} placeholder="Achat de réactifs…" />
          {errors.description && (
            <p className="mt-1 text-xs text-state-error">{errors.description.message}</p>
          )}
        </div>
        <div>
          <Label className="mb-1.5 block text-sm font-medium">Projet *</Label>
          <Controller
            control={control}
            name="projectId"
            render={({ field }) => (
              <ProjectPicker
                value={field.value || null}
                onChange={(id) => {
                  field.onChange(id ?? '');
                  // Cascade : vider grant + budget lines des items
                  setValue('grantId', '', { shouldValidate: false });
                  for (let i = 0; i < watchedLines.length; i++) {
                    setValue(`lines.${i}.budgetLineId`, '', { shouldValidate: false });
                  }
                }}
              />
            )}
          />
          {errors.projectId && (
            <p className="mt-1 text-xs text-state-error">{errors.projectId.message}</p>
          )}
        </div>
        <div>
          <Label className="mb-1.5 block text-sm font-medium">Convention *</Label>
          <Controller
            control={control}
            name="grantId"
            render={({ field }) => (
              <GrantPicker
                projectId={watchedProjectId || null}
                value={field.value || null}
                onChange={(id, grant) => {
                  field.onChange(id ?? '');
                  // Auto-set devise depuis la convention sélectionnée
                  if (grant?.currency) setValue('currency', grant.currency, { shouldValidate: false });
                  // Vider les budget lines des items (cascade)
                  for (let i = 0; i < watchedLines.length; i++) {
                    setValue(`lines.${i}.budgetLineId`, '', { shouldValidate: false });
                  }
                }}
              />
            )}
          />
          {errors.grantId && (
            <p className="mt-1 text-xs text-state-error">{errors.grantId.message}</p>
          )}
        </div>
        <div>
          <Label htmlFor="neededBy">Date souhaitée</Label>
          <Input id="neededBy" type="date" {...register('neededBy')} />
        </div>
        <div>
          <Label htmlFor="currency">Devise</Label>
          {/*
            Fix da-multi-currency : la devise hérite par défaut de la
            convention (auto-fill via GrantPicker.onChange L.229) mais
            peut être OVERRIDE manuellement. Cas réel SYSCEBNL : convention
            bailleur en USD, dépense locale en XOF chez un fournisseur
            sénégalais. La conversion se fait à la comptabilisation au
            taux BCEAO (côté serveur, source de vérité).
          */}
          <select
            id="currency"
            {...register('currency')}
            data-testid="pr-currency"
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
          >
            {FX_SUPPORTED_CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          {currencyMismatch ? (
            <p
              data-testid="pr-currency-mismatch"
              className="mt-1 text-xs text-state-warning"
            >
              ⚠ Devise différente de la convention ({grantCurrency}). La
              conversion se fera à la comptabilisation au taux BCEAO.
            </p>
          ) : (
            <p className="mt-1 text-xs text-slate-muted">
              Pré-remplie depuis la convention — modifiable si la dépense
              locale est dans une autre devise.
            </p>
          )}
        </div>
      </div>

      {/* US-064 — Éligibilité bailleur (ADR-007). Ces champs alimentent les
          colonnes US-054 ; l'EligibilityEngine statue au SUBMIT (le
          formulaire ne duplique aucune règle métier). */}
      <div className="grid grid-cols-1 gap-4 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <Label className="text-sm font-medium">Éligibilité bailleur</Label>
          <p className="mt-0.5 text-xs text-slate-muted">
            Contrôlée par le moteur d&apos;éligibilité à la soumission, selon la
            Note Technique active de la convention.
          </p>
        </div>
        <div>
          <Label className="mb-1.5 block text-sm font-medium">Nature de dépense</Label>
          <Controller
            control={control}
            name="expenseNatureCode"
            render={({ field }) => (
              <Combobox
                options={(expenseNatures ?? []).map((n) => ({
                  value: n.code,
                  label: `${n.label} — ${n.category}`,
                }))}
                value={field.value || null}
                onChange={(code) => field.onChange(code ?? '')}
                placeholder="Sélectionner une nature…"
                searchPlaceholder="Rechercher une nature…"
                loading={naturesLoading}
                testId="pr-expense-nature"
              />
            )}
          />
        </div>
        <div>
          <Label htmlFor="supplierInvoiceNumber">N° facture fournisseur (optionnel)</Label>
          <Input
            id="supplierInvoiceNumber"
            {...register('supplierInvoiceNumber')}
            placeholder="ex. INV-2026-0042"
            data-testid="pr-supplier-invoice-number"
          />
          <p className="mt-1 text-xs text-slate-muted">
            Si déjà connu — sert au contrôle de doublon inter-projets.
          </p>
        </div>
        <label className="flex items-start gap-2 md:col-span-2">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-input accent-ipd-bleu"
            {...register('pasteurParisReimbursed')}
            data-testid="pr-pasteur-paris"
          />
          <span className="text-sm">
            Dépense refacturée à Pasteur Paris
            <span className="block text-xs text-slate-muted">
              Une dépense déjà remboursée par Pasteur Paris n&apos;est pas imputable
              à la convention.
            </span>
          </span>
        </label>
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
          {fields.map((f, i) => {
            const computed = linesWithComputed[i];
            return (
              <div
                key={f.id}
                data-testid={`pr-line-${i}`}
                className={cn(
                  'grid grid-cols-1 gap-2 rounded-md border bg-slate-50 p-3 md:grid-cols-12 md:items-end',
                  computed?.insufficient ? 'border-state-error' : 'border-slate-100',
                )}
              >
                <div className="md:col-span-3">
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
                <div className="md:col-span-4">
                  <Label className="text-xs">Ligne budgétaire</Label>
                  <Controller
                    control={control}
                    name={`lines.${i}.budgetLineId` as const}
                    render={({ field }) => (
                      <BudgetLinePicker
                        grantId={watchedGrantId || null}
                        value={field.value || null}
                        requestedAmount={computed?.lineTotal ?? 0}
                        currency={watchedCurrency}
                        onChange={(id) => field.onChange(id ?? '')}
                        testId={`budget-line-picker-${i}`}
                      />
                    )}
                  />
                  {computed?.insufficient && (
                    <p
                      data-testid={`pr-line-${i}-insufficient`}
                      className="mt-1 text-xs font-medium text-state-error"
                    >
                      Solde insuffisant — {computed.available !== null && (
                        <>disponible <AmountDisplay amount={computed.available} currency={watchedCurrency} /></>
                      )}
                    </p>
                  )}
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
            );
          })}
        </div>
      </div>

      {/* Total + alerte petty cash */}
      <div
        className={cn(
          'flex flex-col gap-2 rounded-lg border bg-white p-4 sm:flex-row sm:items-center sm:justify-between',
          pettyCashExceeded || anyLineInsufficient ? 'border-state-error' : 'border-slate-200',
        )}
      >
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-muted">Total estimé</p>
          <AmountDisplay amount={total} currency={watchedCurrency} className="text-2xl" />
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
        {anyLineInsufficient && !pettyCashExceeded && (
          <p
            role="alert"
            data-testid="form-budget-insufficient"
            className="text-sm font-medium text-state-error"
          >
            ⚠ Au moins une ligne dépasse le solde budgétaire disponible.
          </p>
        )}
      </div>

      <div className="flex items-center justify-end gap-2">
        {extraActions}
        <Button type="submit" disabled={submitDisabled} data-testid="pr-submit">
          {submitting ? 'Enregistrement…' : submitLabel}
        </Button>
      </div>
    </form>
  );
}

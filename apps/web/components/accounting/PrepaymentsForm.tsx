'use client';

import { useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type {
  PrepaymentDirection,
  PrepaymentEntryInput,
  RunPrepaymentsInput,
} from '@/lib/api/accounting';

const PrepaymentEntrySchema = z.object({
  direction: z.enum(['CCA', 'PCA']),
  accountCode: z.string().min(1, 'Compte requis').max(16),
  amount: z.number().positive('Montant > 0').max(1e15),
  label: z.string().min(3, 'Libellé min 3 caractères').max(255),
  sourceReference: z.string().max(64).optional().or(z.literal('')),
  grantId: z.string().uuid().optional().or(z.literal('')),
  budgetLineId: z.string().uuid().optional().or(z.literal('')),
});

const FormSchema = z.object({
  entries: z.array(PrepaymentEntrySchema).min(1, 'Au moins une régularisation requise'),
});

type FormValues = z.infer<typeof FormSchema>;

export interface PrepaymentsFormProps {
  loading?: boolean;
  errorMessage?: string | null;
  onSubmit: (input: RunPrepaymentsInput) => Promise<void> | void;
  onCancel?: () => void;
  className?: string;
}

/**
 * Formulaire de saisie groupée de régularisations CCA/PCA.
 *
 * CCA = Charge Constatée d'Avance (compte 6x à neutraliser → 476 actif)
 * PCA = Produit Constaté d'Avance (compte 7x à neutraliser → 477 passif)
 *
 * La validation finale du préfixe (6x pour CCA, 7x pour PCA) est faite
 * côté backend (PrepaymentService) — on remonte les erreurs via
 * errorMessage si invalide.
 */
export function PrepaymentsForm({
  loading,
  errorMessage,
  onSubmit,
  onCancel,
  className,
}: PrepaymentsFormProps) {
  const [touched, setTouched] = useState(false);
  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      entries: [
        { direction: 'CCA', accountCode: '', amount: 0, label: '', sourceReference: '' },
      ],
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'entries' });

  const submit = handleSubmit((values) => {
    setTouched(true);
    const input: RunPrepaymentsInput = {
      entries: values.entries.map<PrepaymentEntryInput>((e) => ({
        direction: e.direction as PrepaymentDirection,
        accountCode: e.accountCode,
        amount: e.amount,
        label: e.label,
        sourceReference: e.sourceReference?.trim() || undefined,
        grantId: e.grantId?.trim() || undefined,
        budgetLineId: e.budgetLineId?.trim() || undefined,
      })),
    };
    return onSubmit(input);
  });

  return (
    <form
      data-testid="prepayments-form"
      onSubmit={submit}
      className={className}
    >
      <div className="space-y-3">
        {fields.map((field, idx) => (
          <Card key={field.id} data-testid={`prepayment-entry-${idx}`}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Régularisation #{idx + 1}</CardTitle>
                {fields.length > 1 && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    data-testid={`prepayment-remove-${idx}`}
                    onClick={() => remove(idx)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field
                label="Type"
                error={errors.entries?.[idx]?.direction?.message}
              >
                <select
                  data-testid={`prepayment-direction-${idx}`}
                  {...register(`entries.${idx}.direction`)}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="CCA">CCA — Charge constatée d&apos;avance</option>
                  <option value="PCA">PCA — Produit constaté d&apos;avance</option>
                </select>
              </Field>
              <Field
                label="Compte SYSCEBNL (6x pour CCA, 7x pour PCA)"
                error={errors.entries?.[idx]?.accountCode?.message}
              >
                <Input
                  data-testid={`prepayment-account-${idx}`}
                  {...register(`entries.${idx}.accountCode`)}
                  placeholder="622 (loyer) ou 754 (subvention)"
                />
              </Field>
              <Field
                label="Montant XOF"
                error={errors.entries?.[idx]?.amount?.message}
              >
                <Input
                  data-testid={`prepayment-amount-${idx}`}
                  type="number"
                  step="0.01"
                  {...register(`entries.${idx}.amount`, { valueAsNumber: true })}
                  placeholder="100000"
                />
              </Field>
              <Field
                label="Libellé"
                error={errors.entries?.[idx]?.label?.message}
              >
                <Input
                  data-testid={`prepayment-label-${idx}`}
                  {...register(`entries.${idx}.label`)}
                  placeholder="Loyer Q1 2027 prépayé"
                />
              </Field>
              <Field
                label="Référence source (facture / OD, optionnel)"
                error={errors.entries?.[idx]?.sourceReference?.message}
              >
                <Input
                  data-testid={`prepayment-source-${idx}`}
                  {...register(`entries.${idx}.sourceReference`)}
                  placeholder="FACT-2026-098"
                />
              </Field>
              <Field
                label="Grant UUID (optionnel, imputation analytique)"
                error={errors.entries?.[idx]?.grantId?.message}
              >
                <Input
                  data-testid={`prepayment-grant-${idx}`}
                  {...register(`entries.${idx}.grantId`)}
                  placeholder=""
                />
              </Field>
            </CardContent>
          </Card>
        ))}

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            append({
              direction: 'CCA',
              accountCode: '',
              amount: 0,
              label: '',
              sourceReference: '',
            })
          }
          data-testid="prepayment-add"
        >
          <Plus className="mr-1 h-3 w-3" />
          Ajouter une régularisation
        </Button>

        {errors.entries?.root?.message && (
          <p className="text-xs text-state-error">{errors.entries.root.message}</p>
        )}
        {errorMessage && touched && (
          <p
            data-testid="prepayments-error"
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
          <Button type="submit" disabled={loading} data-testid="prepayments-submit">
            <Save className="mr-1 h-4 w-4" />
            {loading ? 'Enregistrement…' : `Comptabiliser ${fields.length} régularisation${fields.length > 1 ? 's' : ''}`}
          </Button>
        </div>
      </div>
    </form>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs uppercase tracking-wide text-slate-muted">{label}</Label>
      {children}
      {error && <p className="text-xs text-state-error">{error}</p>}
    </div>
  );
}

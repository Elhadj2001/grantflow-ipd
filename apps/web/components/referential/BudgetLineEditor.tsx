'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Check, Edit, Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { ApiError } from '@/lib/api-client';
import { formatAmount } from '@/lib/api/pilotage';
import {
  useCreateBudgetLine,
  useDeleteBudgetLine,
  useUpdateBudgetLine,
} from '@/hooks/use-referential';
import { usePermissions } from '@/hooks/use-permissions';
import type { BudgetLine } from '@/lib/api/referential';

/**
 * Schéma Zod aligné sur CreateBudgetLineDto backend.
 *   - code regex : `^[A-Z0-9][A-Z0-9-]{1,31}$` (PAS d'underscore — différent
 *     du supplier code).
 *   - label min 3, max 255.
 *   - budgetedAmount > 0 (décimal max 4 décimales côté backend).
 *   - defaultAccount : compte SYSCEBNL — clé du mapping bailleur.
 */
const BudgetLineSchema = z.object({
  code: z
    .string()
    .regex(/^[A-Z0-9][A-Z0-9-]{1,31}$/, 'Code MAJUSCULES (chiffres et - autorisés)'),
  label: z.string().min(3, 'Min 3 caractères').max(255),
  budgetedAmount: z
    .number({ invalid_type_error: 'Montant requis' })
    .positive('Doit être > 0'),
  defaultAccount: z.string().max(16).optional().or(z.literal('')),
  isOverheadEligible: z.boolean().default(true),
});

type FormValues = z.infer<typeof BudgetLineSchema>;

export interface BudgetLineEditorProps {
  grantId: string;
  /**
   * Lignes budgétaires existantes. On affiche aussi les inactives (greyed)
   * — le backend ne renvoie que les actives en lecture, mais on prévoit
   * l'extension future.
   */
  lines: BudgetLine[];
  /**
   * Montant total de la convention (en XOF). Affiché pour donner du
   * contexte au CG : la somme des lignes ne peut pas dépasser ce plafond
   * (le backend lève BUDGET_LINES_EXCEED_GRANT sinon).
   */
  grantAmount: number;
  className?: string;
}

/**
 * Section éditable des lignes budgétaires d'une convention — sprint F5b-c Lot C.
 *
 * Visible UNIQUEMENT si `canManageBudgetLines` (CG/DAF/SA, pas ACHETEUR).
 * Cohabite avec la `BudgetVarianceTable` du dashboard qui reste affichée
 * en lecture seule (consommation/engagé/variance) pour tous les rôles
 * autorisés (cf. /pilotage/conventions/[id]/page.tsx).
 *
 * Gère les 2 erreurs 409 spécifiques :
 *   - BUDGET_LINES_EXCEED_GRANT : somme > montant convention
 *   - BUDGET_LINE_HAS_USAGE : ligne référencée par une DA/BC/écriture
 * Messages rendus explicites pour ne pas effrayer le CG (pas de stack).
 */
export function BudgetLineEditor({
  grantId,
  lines,
  grantAmount,
  className,
}: BudgetLineEditorProps) {
  const perms = usePermissions();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Hooks DOIVENT être appelés dans le même ordre à chaque render
  // (eslint-plugin-react-hooks). On les déclare AVANT tout early return
  // — l'early return basé sur les permissions intervient ensuite.
  const createM = useCreateBudgetLine(grantId);
  const updateM = useUpdateBudgetLine(grantId);
  const deleteM = useDeleteBudgetLine(grantId);

  // Vérification défense-en-profondeur (le caller gate déjà côté page).
  if (!perms.canManageBudgetLines()) return null;

  const totalBudgeted = lines.reduce((s, l) => s + Number(l.budgetedAmount), 0);
  const remaining = grantAmount - totalBudgeted;

  const handleCreate = async (values: FormValues) => {
    setError(null);
    try {
      await createM.mutateAsync({
        code: values.code,
        label: values.label,
        budgetedAmount: values.budgetedAmount,
        defaultAccount: values.defaultAccount?.trim() || undefined,
        isOverheadEligible: values.isOverheadEligible,
      });
      setAdding(false);
    } catch (e) {
      setError(formatBudgetLineError(e));
    }
  };

  const handleUpdate = async (id: string, values: FormValues) => {
    setError(null);
    try {
      await updateM.mutateAsync({
        id,
        input: {
          code: values.code,
          label: values.label,
          budgetedAmount: values.budgetedAmount,
          defaultAccount: values.defaultAccount?.trim() || null,
          isOverheadEligible: values.isOverheadEligible,
        },
      });
      setEditingId(null);
    } catch (e) {
      setError(formatBudgetLineError(e));
    }
  };

  const handleDelete = async (id: string) => {
    setError(null);
    try {
      await deleteM.mutateAsync(id);
    } catch (e) {
      setError(formatBudgetLineError(e));
    }
  };

  return (
    <Card
      data-testid="budget-line-editor"
      data-grant-id={grantId}
      className={cn(className)}
    >
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Paramétrage des lignes budgétaires</CardTitle>
          {!adding && (
            <Button
              size="sm"
              onClick={() => {
                setError(null);
                setAdding(true);
              }}
              data-testid="add-budget-line"
            >
              <Plus className="mr-1 h-3 w-3" />
              Ajouter une ligne
            </Button>
          )}
        </div>
        <p className="text-xs text-slate-muted">
          Total budgété : <strong>{formatAmount(totalBudgeted)}</strong> sur{' '}
          {formatAmount(grantAmount)} ·{' '}
          <span
            className={cn(
              remaining < 0 ? 'text-state-error font-semibold' : 'text-slate-700',
            )}
          >
            Reste : {formatAmount(remaining)}
          </span>
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <p
            data-testid="budget-line-editor-error"
            className="rounded-md border border-state-error/30 bg-state-error/5 px-3 py-2 text-sm text-state-error"
          >
            {error}
          </p>
        )}

        <table className="w-full text-sm" data-testid="budget-line-table">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-muted">
            <tr>
              <th className="px-3 py-2 text-left">Code</th>
              <th className="px-3 py-2 text-left">Libellé</th>
              <th className="px-3 py-2 text-right">Budgété</th>
              <th className="px-3 py-2 text-left">Compte SYSCEBNL</th>
              <th className="px-3 py-2 text-center">OH</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {lines.length === 0 && !adding && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-slate-muted">
                  Aucune ligne budgétaire. Cliquez sur « Ajouter » pour commencer.
                </td>
              </tr>
            )}

            {lines.map((l) =>
              editingId === l.id ? (
                <EditableRow
                  key={l.id}
                  defaultValues={l}
                  loading={updateM.isPending}
                  onSubmit={(v) => handleUpdate(l.id, v)}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <ReadOnlyRow
                  key={l.id}
                  line={l}
                  canDelete={perms.canDeleteBudgetLine()}
                  onEdit={() => {
                    setError(null);
                    setEditingId(l.id);
                  }}
                  onDelete={() => handleDelete(l.id)}
                />
              ),
            )}

            {adding && (
              <EditableRow
                loading={createM.isPending}
                onSubmit={handleCreate}
                onCancel={() => setAdding(false)}
              />
            )}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

interface ReadOnlyRowProps {
  line: BudgetLine;
  canDelete: boolean;
  onEdit: () => void;
  onDelete: () => void;
}

function ReadOnlyRow({ line, canDelete, onEdit, onDelete }: ReadOnlyRowProps) {
  return (
    <tr data-testid={`bl-row-${line.code}`} className="hover:bg-slate-50">
      <td className="px-3 py-2 font-mono text-xs text-ipd-darker">{line.code}</td>
      <td className="px-3 py-2 text-slate-700">{line.label}</td>
      <td className="px-3 py-2 text-right text-slate-700">
        {formatAmount(Number(line.budgetedAmount))}
      </td>
      <td className="px-3 py-2 font-mono text-xs text-slate-muted">
        {line.defaultAccount ?? '—'}
      </td>
      <td className="px-3 py-2 text-center">
        {line.isOverheadEligible ? (
          <Check className="mx-auto h-3 w-3 text-state-success" />
        ) : (
          <X className="mx-auto h-3 w-3 text-slate-300" />
        )}
      </td>
      <td className="px-3 py-2 text-right">
        <div className="flex justify-end gap-1">
          <Button
            size="sm"
            variant="outline"
            onClick={onEdit}
            data-testid={`bl-edit-${line.code}`}
          >
            <Edit className="h-3 w-3" />
          </Button>
          {canDelete && (
            <Button
              size="sm"
              variant="outline"
              onClick={onDelete}
              data-testid={`bl-delete-${line.code}`}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}

interface EditableRowProps {
  defaultValues?: BudgetLine;
  loading?: boolean;
  onSubmit: (values: FormValues) => void;
  onCancel: () => void;
}

function EditableRow({ defaultValues, loading, onSubmit, onCancel }: EditableRowProps) {
  const isCreate = !defaultValues;
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(BudgetLineSchema),
    defaultValues: defaultValues
      ? {
          code: defaultValues.code,
          label: defaultValues.label,
          budgetedAmount: Number(defaultValues.budgetedAmount),
          defaultAccount: defaultValues.defaultAccount ?? '',
          isOverheadEligible: defaultValues.isOverheadEligible,
        }
      : {
          code: '',
          label: '',
          budgetedAmount: 0,
          defaultAccount: '',
          isOverheadEligible: true,
        },
  });

  return (
    <tr
      data-testid={isCreate ? 'bl-row-new' : `bl-row-edit-${defaultValues!.code}`}
      data-mode={isCreate ? 'create' : 'edit'}
      className="bg-ipd-50/30"
    >
      <td className="px-3 py-2">
        <Input
          data-testid="bl-form-code"
          {...register('code')}
          disabled={!isCreate}
          placeholder="L01"
          className="h-8 font-mono"
        />
        {errors.code && <p className="text-[10px] text-state-error">{errors.code.message}</p>}
      </td>
      <td className="px-3 py-2">
        <Input
          data-testid="bl-form-label"
          {...register('label')}
          placeholder="Consommables labo"
          className="h-8"
        />
        {errors.label && (
          <p className="text-[10px] text-state-error">{errors.label.message}</p>
        )}
      </td>
      <td className="px-3 py-2 text-right">
        <Input
          data-testid="bl-form-amount"
          type="number"
          step="0.01"
          {...register('budgetedAmount', { valueAsNumber: true })}
          className="h-8 text-right"
        />
        {errors.budgetedAmount && (
          <p className="text-[10px] text-state-error">{errors.budgetedAmount.message}</p>
        )}
      </td>
      <td className="px-3 py-2">
        <Input
          data-testid="bl-form-default-account"
          {...register('defaultAccount')}
          placeholder="604"
          className="h-8 font-mono"
        />
        <Label className="text-[9px] text-slate-muted">Mapping bailleur</Label>
      </td>
      <td className="px-3 py-2 text-center">
        <input
          type="checkbox"
          data-testid="bl-form-overhead"
          {...register('isOverheadEligible')}
          className="mt-2"
        />
      </td>
      <td className="px-3 py-2">
        <div className="flex justify-end gap-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onCancel}
            disabled={loading}
            data-testid="bl-form-cancel"
          >
            <X className="h-3 w-3" />
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleSubmit(onSubmit)}
            disabled={loading}
            data-testid="bl-form-submit"
          >
            <Check className="h-3 w-3" />
          </Button>
        </div>
      </td>
    </tr>
  );
}

/**
 * Convertit une ApiError en message FR explicite. Couvre les 2 cas
 * 409 spécifiques aux lignes budgétaires :
 *   - BUDGET_LINES_EXCEED_GRANT : somme > montant convention
 *   - BUDGET_LINE_HAS_USAGE     : ligne référencée (DA/BC/écriture)
 */
function formatBudgetLineError(e: unknown): string {
  if (e instanceof ApiError) {
    const code = e.body.code;
    if (code === 'BUSINESS.BUDGET_LINES_EXCEED_GRANT') {
      return (
        'Le total des lignes budgétaires dépasse le montant de la convention. ' +
        'Réduisez un budget ou supprimez une ligne avant d\'ajouter.'
      );
    }
    if (code === 'BUSINESS.BUDGET_LINE_HAS_USAGE') {
      return (
        'Cette ligne est déjà référencée par une DA, un BC ou une écriture ' +
        'comptable — la suppression n\'est plus possible. ' +
        'Vous pouvez la rendre inactive plus tard depuis l\'admin.'
      );
    }
    if (code === 'BUSINESS.DUPLICATE_CODE') {
      return 'Ce code est déjà utilisé sur une autre ligne de cette convention.';
    }
    return `Erreur ${e.status} — ${e.body.message ?? 'cas métier'}${code ? ` (${code})` : ''}`;
  }
  if (e instanceof Error) return e.message;
  return 'Erreur inconnue';
}

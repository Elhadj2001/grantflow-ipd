'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, Plus, Save, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { REPORT_CURRENCIES } from '@/lib/api/reporting';
import { useCreateDonorTemplate } from '@/hooks/use-reporting';
import { usePermissions } from '@/hooks/use-permissions';
import { ApiError } from '@/lib/api-client';

const TEMPLATE_CODE_REGEX = /^[A-Z0-9][A-Z0-9_-]{1,63}$/;

const Schema = z.object({
  code: z
    .string()
    .regex(TEMPLATE_CODE_REGEX, 'Code MAJUSCULE (lettres/chiffres/_/-)'),
  name: z.string().min(3, 'Min 3 caractères').max(255),
  donorId: z.string().uuid('UUID requis').or(z.literal('')),
  currency: z.enum(REPORT_CURRENCIES),
  categories: z
    .array(
      z.object({
        code: z.string().min(1, 'Requis').max(64),
        label: z.string().min(1, 'Requis').max(255),
        parentCode: z.string().optional(),
        sortOrder: z.number().int().min(0).max(9999).default(0),
      }),
    )
    .max(100),
});

type FormValues = z.infer<typeof Schema>;

/**
 * Création d'un template bailleur (CG / SUPER_ADMIN).
 *
 * Le backend accepte la création du template + les catégories en un
 * seul POST. Pas d'ajout de mappings ici — on passe par /[id]/edit
 * une fois le template créé (le détail backend fait deux passes pour
 * résoudre les parentCode).
 */
export default function NewTemplatePage() {
  const router = useRouter();
  const perms = usePermissions();
  const createM = useCreateDonorTemplate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!perms.canManageDonorTemplate()) {
      router.replace('/reporting/templates');
    }
  }, [perms, router]);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(Schema),
    defaultValues: {
      code: '',
      name: '',
      donorId: '',
      currency: 'XOF',
      categories: [],
    },
  });

  const categories = watch('categories');

  const addCategory = () => {
    setValue('categories', [
      ...categories,
      { code: '', label: '', parentCode: '', sortOrder: categories.length * 10 },
    ]);
  };
  const removeCategory = (idx: number) => {
    setValue(
      'categories',
      categories.filter((_, i) => i !== idx),
    );
  };
  const updateCategory = (idx: number, patch: Partial<FormValues['categories'][number]>) => {
    setValue(
      'categories',
      categories.map((c, i) => (i === idx ? { ...c, ...patch } : c)),
    );
  };

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      const tpl = await createM.mutateAsync({
        code: values.code,
        name: values.name,
        donorId: values.donorId || null,
        currency: values.currency,
        categories: values.categories.map((c) => ({
          code: c.code,
          label: c.label,
          parentCode: c.parentCode || undefined,
          sortOrder: c.sortOrder,
        })),
      });
      router.push(`/reporting/templates/${tpl.id}`);
    } catch (e: unknown) {
      if (e instanceof ApiError) {
        setError(`Erreur ${e.status} — ${e.body.message ?? 'cas métier'}`);
      } else if (e instanceof Error) {
        setError(e.message);
      } else {
        setError('Erreur inconnue');
      }
    }
  });

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHeader
        title="Nouveau template bailleur"
        subtitle="Définissez le code, le bailleur, la devise et les catégories"
        actions={
          <Button variant="outline" onClick={() => router.push('/reporting/templates')}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            Retour
          </Button>
        }
      />

      <form
        data-testid="new-template-form"
        onSubmit={onSubmit}
        className="mx-auto max-w-4xl space-y-4 px-8 py-6"
      >
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Identification</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Code (ex. USAID_FFR425)" error={errors.code?.message}>
                <Input
                  data-testid="template-code"
                  {...register('code')}
                  placeholder="USAID_FFR425"
                />
              </Field>
              <Field label="Devise" error={errors.currency?.message}>
                <select
                  data-testid="template-currency"
                  {...register('currency')}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {REPORT_CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Nom complet" error={errors.name?.message}>
              <Input
                data-testid="template-name"
                {...register('name')}
                placeholder="USAID Federal Financial Report"
              />
            </Field>
            <Field
              label="Bailleur (UUID — vide pour template multi-bailleurs)"
              error={errors.donorId?.message}
            >
              <Input data-testid="template-donor" {...register('donorId')} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Catégories bailleur</CardTitle>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={addCategory}
                data-testid="add-category"
              >
                <Plus className="mr-1 h-3 w-3" />
                Ajouter
              </Button>
            </div>
            <p className="text-xs text-slate-muted">
              Code, libellé et parent (par code). L&apos;ordre d&apos;affichage suit `sortOrder`.
              Les catégories sont immutables après création — pensez-y bien.
            </p>
          </CardHeader>
          <CardContent>
            {categories.length === 0 ? (
              <p className="rounded-md border border-dashed border-slate-200 px-3 py-6 text-center text-sm text-slate-muted">
                Aucune catégorie. Cliquez sur « Ajouter » pour commencer.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wide text-slate-muted">
                  <tr>
                    <th className="px-2 py-1 text-left">Code</th>
                    <th className="px-2 py-1 text-left">Libellé</th>
                    <th className="px-2 py-1 text-left">Parent</th>
                    <th className="px-2 py-1 text-left">Order</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {categories.map((c, idx) => (
                    <tr key={idx} data-testid={`cat-row-${idx}`}>
                      <td className="px-2 py-1">
                        <Input
                          data-testid={`cat-code-${idx}`}
                          value={c.code}
                          onChange={(e) => updateCategory(idx, { code: e.target.value })}
                          placeholder="LINE_01"
                          className="h-8"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <Input
                          data-testid={`cat-label-${idx}`}
                          value={c.label}
                          onChange={(e) => updateCategory(idx, { label: e.target.value })}
                          placeholder="Personnel"
                          className="h-8"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <Input
                          data-testid={`cat-parent-${idx}`}
                          value={c.parentCode ?? ''}
                          onChange={(e) => updateCategory(idx, { parentCode: e.target.value })}
                          placeholder="(racine)"
                          className="h-8"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <Input
                          data-testid={`cat-order-${idx}`}
                          type="number"
                          value={c.sortOrder}
                          onChange={(e) =>
                            updateCategory(idx, { sortOrder: Number(e.target.value) || 0 })
                          }
                          className="h-8 w-20"
                        />
                      </td>
                      <td className="px-2 py-1 text-right">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => removeCategory(idx)}
                          data-testid={`cat-remove-${idx}`}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        {error && (
          <p
            data-testid="form-error"
            className="rounded-md border border-state-error/30 bg-state-error/5 px-3 py-2 text-sm text-state-error"
          >
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push('/reporting/templates')}
          >
            Annuler
          </Button>
          <Button type="submit" disabled={createM.isPending} data-testid="submit-template">
            <Save className="mr-1 h-4 w-4" />
            {createM.isPending ? 'Création…' : 'Créer le template'}
          </Button>
        </div>
      </form>
    </div>
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

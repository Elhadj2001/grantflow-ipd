'use client';

import { useMemo, useState } from 'react';
import {
  FormProvider,
  useForm,
  useFormContext,
  type SubmitHandler,
} from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Check, ChevronLeft, ChevronRight, FileSpreadsheet, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { formatAmount } from '@/lib/api/pilotage';
import type { Grant } from '@/lib/api/referential';
import type { DonorTemplateSummary } from '@/lib/api/reporting';
import { OFFICIAL_TEMPLATE_CODES } from '@/lib/api/reporting';

// ---------------------------------------------------------------------
// Schéma cross-steps — un seul useForm partagé via FormProvider
// ---------------------------------------------------------------------

export const WizardSchema = z
  .object({
    grantId: z.string().uuid('Convention requise'),
    templateId: z.string().uuid('Template requis'),
    periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date début (YYYY-MM-DD)'),
    periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date fin (YYYY-MM-DD)'),
    notes: z.string().max(2000).optional().or(z.literal('')),
  })
  .refine((v) => v.periodStart <= v.periodEnd, {
    message: 'periodEnd doit être ≥ periodStart',
    path: ['periodEnd'],
  });

export type WizardValues = z.infer<typeof WizardSchema>;

export interface DonorReportWizardProps {
  /** Liste complète des grants (filtrés actifs côté caller). */
  grants: Grant[];
  /** Liste complète des templates. */
  templates: DonorTemplateSummary[];
  /** Soumis lors du clic "Créer le rapport" sur l'étape 4. */
  onSubmit: SubmitHandler<WizardValues>;
  /** Désactive les actions pendant la mutation. */
  loading?: boolean;
  /** Erreur serveur à afficher au step Preview. */
  errorMessage?: string | null;
  className?: string;
}

const STEPS = [
  { key: 'grant', label: 'Convention', icon: FileSpreadsheet },
  { key: 'template', label: 'Template', icon: FileSpreadsheet },
  { key: 'period', label: 'Période', icon: FileSpreadsheet },
  { key: 'preview', label: 'Aperçu', icon: Send },
] as const;
type StepKey = (typeof STEPS)[number]['key'];

/**
 * Wizard 4-step de création d'un rapport bailleur.
 *
 * Un seul useForm est partagé entre les 4 étapes via FormProvider —
 * approche react-hook-form choisie pour Sprint F5a (cohérent avec
 * GrantForm). La validation Zod globale s'applique au submit final ;
 * chaque step valide localement ses champs pour activer "Suivant".
 *
 * Le step 2 (Template) filtre les templates par bailleur quand le
 * grant choisi a un donor connu (sinon affiche tout). Le step 3
 * propose des presets trimestriels Q1/Q2/Q3/Q4 sur l'année en cours
 * pour accélérer la saisie.
 */
export function DonorReportWizard({
  grants,
  templates,
  onSubmit,
  loading,
  errorMessage,
  className,
}: DonorReportWizardProps) {
  const methods = useForm<WizardValues>({
    resolver: zodResolver(WizardSchema),
    mode: 'onChange',
    defaultValues: {
      grantId: '',
      templateId: '',
      periodStart: '',
      periodEnd: '',
      notes: '',
    },
  });

  const [currentIdx, setCurrentIdx] = useState(0);
  const stepKey: StepKey = STEPS[currentIdx].key;

  const canGoNext = useStepIsValid(methods, stepKey);
  const handleNext = async () => {
    const fieldsForStep = FIELDS_FOR_STEP[stepKey];
    const valid = await methods.trigger(fieldsForStep);
    if (valid) setCurrentIdx((i) => Math.min(i + 1, STEPS.length - 1));
  };
  const handlePrev = () => setCurrentIdx((i) => Math.max(i - 1, 0));

  return (
    <FormProvider {...methods}>
      <form
        data-testid="donor-report-wizard"
        data-step={stepKey}
        data-step-idx={currentIdx}
        onSubmit={methods.handleSubmit(onSubmit)}
        className={cn('space-y-6', className)}
      >
        <ProgressBar currentIdx={currentIdx} />

        {stepKey === 'grant' && <StepGrant grants={grants} />}
        {stepKey === 'template' && <StepTemplate templates={templates} grants={grants} />}
        {stepKey === 'period' && <StepPeriod grants={grants} />}
        {stepKey === 'preview' && (
          <StepPreview grants={grants} templates={templates} errorMessage={errorMessage} />
        )}

        <div className="flex items-center justify-between border-t border-slate-100 pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={handlePrev}
            disabled={currentIdx === 0 || loading}
            data-testid="wizard-prev"
          >
            <ChevronLeft className="mr-1 h-4 w-4" />
            Précédent
          </Button>

          {currentIdx < STEPS.length - 1 ? (
            <Button
              type="button"
              onClick={handleNext}
              disabled={!canGoNext || loading}
              data-testid="wizard-next"
            >
              Suivant
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          ) : (
            <Button
              type="submit"
              disabled={loading || !methods.formState.isValid}
              data-testid="wizard-submit"
            >
              <Send className="mr-1 h-4 w-4" />
              Créer le rapport
            </Button>
          )}
        </div>
      </form>
    </FormProvider>
  );
}

// ---------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------

const FIELDS_FOR_STEP: Record<StepKey, Array<keyof WizardValues>> = {
  grant: ['grantId'],
  template: ['templateId'],
  period: ['periodStart', 'periodEnd'],
  preview: [], // submit final
};

function useStepIsValid(
  methods: ReturnType<typeof useForm<WizardValues>>,
  stepKey: StepKey,
): boolean {
  const values = methods.watch();
  switch (stepKey) {
    case 'grant':
      return !!values.grantId;
    case 'template':
      return !!values.templateId;
    case 'period':
      return (
        !!values.periodStart &&
        !!values.periodEnd &&
        /^\d{4}-\d{2}-\d{2}$/.test(values.periodStart) &&
        /^\d{4}-\d{2}-\d{2}$/.test(values.periodEnd) &&
        values.periodStart <= values.periodEnd
      );
    case 'preview':
      return methods.formState.isValid;
  }
}

function ProgressBar({ currentIdx }: { currentIdx: number }) {
  return (
    <ol
      data-testid="wizard-progress"
      data-current-idx={currentIdx}
      className="flex items-center gap-2"
    >
      {STEPS.map((s, idx) => {
        const completed = idx < currentIdx;
        const active = idx === currentIdx;
        return (
          <li
            key={s.key}
            data-testid={`wizard-step-${s.key}`}
            data-active={active ? 'true' : 'false'}
            data-completed={completed ? 'true' : 'false'}
            className="flex flex-1 items-center gap-2"
          >
            <span
              className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold',
                completed && 'border-state-success bg-state-success text-white',
                active && 'border-ipd-dark bg-ipd-50 text-ipd-darker',
                !completed && !active && 'border-slate-200 bg-white text-slate-muted',
              )}
            >
              {completed ? <Check className="h-3 w-3" /> : idx + 1}
            </span>
            <span
              className={cn(
                'text-xs font-medium',
                active ? 'text-ipd-darker' : 'text-slate-muted',
              )}
            >
              {s.label}
            </span>
            {idx < STEPS.length - 1 && (
              <span
                className={cn(
                  'h-px flex-1',
                  completed ? 'bg-state-success' : 'bg-slate-200',
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function StepGrant({ grants }: { grants: Grant[] }) {
  const { register, watch, setValue, formState } = useFormContext<WizardValues>();
  const selected = watch('grantId');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">1. Choisir la convention</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <input type="hidden" {...register('grantId')} />
        {grants.length === 0 && (
          <p className="text-sm text-state-warning">
            Aucune convention active disponible. Créez ou réactivez une convention via Pilotage.
          </p>
        )}
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {grants.map((g) => (
            <button
              key={g.id}
              type="button"
              data-testid={`grant-option-${g.id}`}
              data-selected={selected === g.id ? 'true' : 'false'}
              onClick={() => setValue('grantId', g.id, { shouldValidate: true })}
              className={cn(
                'rounded-md border p-3 text-left transition',
                selected === g.id
                  ? 'border-ipd-dark bg-ipd-50'
                  : 'border-slate-200 hover:border-ipd',
              )}
            >
              <p className="font-semibold text-ipd-darker">{g.reference}</p>
              <p className="text-xs text-slate-muted">
                {g.currency} · {g.startDate} → {g.endDate}
              </p>
              <p className="text-xs text-slate-700">
                Montant : {formatAmount(Number(g.amount), g.currency)}
              </p>
            </button>
          ))}
        </div>
        {formState.errors.grantId && (
          <p className="text-xs text-state-error">{formState.errors.grantId.message}</p>
        )}
      </CardContent>
    </Card>
  );
}

function StepTemplate({
  templates,
  grants,
}: {
  templates: DonorTemplateSummary[];
  grants: Grant[];
}) {
  const { register, watch, setValue } = useFormContext<WizardValues>();
  const grantId = watch('grantId');
  const selected = watch('templateId');

  const selectedGrant = grants.find((g) => g.id === grantId);

  // Filtre par donor si le grant a un donor lié (cf. backend : template
  // peut être null donor → multi-bailleurs)
  const filtered = useMemo(() => {
    if (!selectedGrant) return templates;
    return templates.filter(
      (t) => t.donorId === null || t.donorId === selectedGrant.donorId,
    );
  }, [templates, selectedGrant]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">2. Choisir le template bailleur</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <input type="hidden" {...register('templateId')} />
        {filtered.length === 0 && (
          <p className="text-sm text-state-warning">
            Aucun template compatible avec le bailleur de la convention sélectionnée.
          </p>
        )}
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {filtered.map((t) => {
            const isOfficial = OFFICIAL_TEMPLATE_CODES.has(t.code);
            return (
              <button
                key={t.id}
                type="button"
                data-testid={`template-option-${t.id}`}
                data-selected={selected === t.id ? 'true' : 'false'}
                onClick={() => setValue('templateId', t.id, { shouldValidate: true })}
                className={cn(
                  'rounded-md border p-3 text-left transition',
                  selected === t.id
                    ? 'border-ipd-dark bg-ipd-50'
                    : 'border-slate-200 hover:border-ipd',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold text-ipd-darker">{t.code}</p>
                  {isOfficial && (
                    <span className="rounded-full bg-state-success/15 px-2 py-0.5 text-[10px] font-semibold text-state-success">
                      Officiel
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-700">{t.name}</p>
                <p className="text-xs text-slate-muted">
                  {t._count.categories} cat. · {t._count.mappings} mappings · {t.currency}
                </p>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function StepPeriod({ grants }: { grants: Grant[] }) {
  const { register, watch, setValue, formState } = useFormContext<WizardValues>();
  const grantId = watch('grantId');
  const selectedGrant = grants.find((g) => g.id === grantId);

  const applyQuarter = (q: 1 | 2 | 3 | 4) => {
    const year = new Date().getFullYear();
    const startMonth = (q - 1) * 3;
    const start = new Date(Date.UTC(year, startMonth, 1));
    const end = new Date(Date.UTC(year, startMonth + 3, 0));
    setValue('periodStart', start.toISOString().slice(0, 10), { shouldValidate: true });
    setValue('periodEnd', end.toISOString().slice(0, 10), { shouldValidate: true });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">3. Définir la période</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {[1, 2, 3, 4].map((q) => (
            <Button
              key={q}
              type="button"
              size="sm"
              variant="outline"
              data-testid={`preset-q${q}`}
              onClick={() => applyQuarter(q as 1 | 2 | 3 | 4)}
            >
              Q{q} {new Date().getFullYear()}
            </Button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs uppercase tracking-wide text-slate-muted">
              Début
            </Label>
            <Input
              data-testid="period-start"
              type="date"
              {...register('periodStart')}
            />
            {formState.errors.periodStart && (
              <p className="text-xs text-state-error">{formState.errors.periodStart.message}</p>
            )}
          </div>
          <div className="space-y-1">
            <Label className="text-xs uppercase tracking-wide text-slate-muted">Fin</Label>
            <Input data-testid="period-end" type="date" {...register('periodEnd')} />
            {formState.errors.periodEnd && (
              <p className="text-xs text-state-error">{formState.errors.periodEnd.message}</p>
            )}
          </div>
        </div>
        {selectedGrant && (
          <p className="text-xs text-slate-muted">
            Convention {selectedGrant.reference} actif du {selectedGrant.startDate} au{' '}
            {selectedGrant.endDate}. La période doit être incluse dans cette plage.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function StepPreview({
  grants,
  templates,
  errorMessage,
}: {
  grants: Grant[];
  templates: DonorTemplateSummary[];
  errorMessage?: string | null;
}) {
  const { register, watch } = useFormContext<WizardValues>();
  const values = watch();
  const grant = grants.find((g) => g.id === values.grantId);
  const template = templates.find((t) => t.id === values.templateId);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">4. Aperçu avant création</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="grid grid-cols-2 gap-3 rounded-md bg-slate-50 p-3 text-sm">
          <Field label="Convention" value={grant?.reference} />
          <Field
            label="Bailleur"
            value={template?.donor?.label ?? 'Multi-bailleurs (template générique)'}
          />
          <Field label="Template" value={template ? `${template.code} — ${template.name}` : '—'} />
          <Field label="Devise rapport" value={template?.currency ?? '—'} />
          <Field label="Période" value={`${values.periodStart} → ${values.periodEnd}`} />
          <Field
            label="Mappings"
            value={template ? `${template._count.mappings} mappings actifs` : '—'}
          />
        </dl>

        {template?._count.mappings === 0 && (
          <p
            data-testid="preview-empty-mappings-warning"
            className="rounded-md border border-state-warning/30 bg-state-warning/5 px-3 py-2 text-sm text-state-warning"
          >
            ⚠ Ce template n&apos;a aucun mapping. Le rapport généré ne contiendra aucune ligne.
            Ajoutez d&apos;abord les mappings comptes SYSCEBNL → catégories.
          </p>
        )}

        <div className="space-y-1">
          <Label className="text-xs uppercase tracking-wide text-slate-muted">
            Notes (optionnel)
          </Label>
          <textarea
            data-testid="wizard-notes"
            {...register('notes')}
            rows={3}
            className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            placeholder="Ex. Premier rapport Q2 2026 — inclut overhead recalculé"
          />
        </div>

        {errorMessage && (
          <p
            data-testid="wizard-error"
            className="rounded-md border border-state-error/30 bg-state-error/5 px-3 py-2 text-sm text-state-error"
          >
            {errorMessage}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string | undefined }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-slate-muted">{label}</dt>
      <dd className="text-sm font-medium text-slate-700">{value ?? '—'}</dd>
    </div>
  );
}

// re-export for tests
export { FIELDS_FOR_STEP, STEPS };

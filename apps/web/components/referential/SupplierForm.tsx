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
  SUPPLIER_CURRENCIES,
  type CreateSupplierInput,
  type Supplier,
  type SupplierCurrency,
  type UpdateSupplierInput,
} from '@/lib/api/referential';

// Schéma Zod aligné sur CreateSupplierDto backend (cf.
// apps/api/src/referential/supplier/dto/create-supplier.dto.ts).
// On laisse le backend valider l'IBAN/BIC en final — ici on n'impose
// que la longueur minimale pour ne pas refuser inutilement.
const SupplierFormSchema = z.object({
  code: z
    .string()
    .regex(
      /^[A-Z0-9][A-Z0-9_-]{1,31}$/,
      'Code MAJUSCULES (chiffres, _, - autorisés)',
    ),
  name: z.string().min(3, 'Min 3 caractères').max(255),
  vatNumber: z.string().min(2).max(64).optional().or(z.literal('')),
  address: z.string().max(512).optional().or(z.literal('')),
  country: z.string().min(2).max(64).optional().or(z.literal('')),
  iban: z.string().min(15).max(34).optional().or(z.literal('')),
  bic: z.string().min(8).max(11).optional().or(z.literal('')),
  bankName: z.string().max(255).optional().or(z.literal('')),
  paymentTermsDays: z
    .number({ invalid_type_error: 'Nombre requis' })
    .int()
    .min(0)
    .max(120),
  currencyDefault: z.enum(SUPPLIER_CURRENCIES),
  riskScore: z.number().int().min(0).max(100),
  // Sprint F-PO-EMAIL : destinataire du PDF du BC. Optionnel — si vide,
  // l'envoi e-mail est skippé (l'engagement classe 8 et la transition
  // `sent` se font quand même côté backend).
  // On utilise un `refine` plutôt qu'une union pour que RHF reçoive un
  // FieldError "plat" avec notre message lisible (l'union produit des
  // erreurs imbriquées qui ne propagent pas joliment dans formState.errors).
  contactEmail: z
    .string()
    .max(255)
    .refine(
      (v) => v.length === 0 || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
      { message: 'Adresse e-mail invalide' },
    )
    .optional(),
});

export type SupplierFormValues = z.infer<typeof SupplierFormSchema>;

export interface SupplierFormProps {
  /** Mode : create (champs vides) ou edit (préremplit depuis `defaultValues`). */
  mode: 'create' | 'edit';
  defaultValues?: Supplier;
  loading?: boolean;
  errorMessage?: string | null;
  /** Soumis avec les valeurs nettoyées (chaînes vides → undefined). */
  onSubmit: (input: CreateSupplierInput | UpdateSupplierInput) => Promise<void> | void;
  onCancel?: () => void;
  className?: string;
}

export function SupplierForm({
  mode,
  defaultValues,
  loading,
  errorMessage,
  onSubmit,
  onCancel,
  className,
}: SupplierFormProps) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<SupplierFormValues>({
    resolver: zodResolver(SupplierFormSchema),
    defaultValues: {
      code: defaultValues?.code ?? '',
      name: defaultValues?.name ?? '',
      vatNumber: defaultValues?.vatNumber ?? '',
      address: defaultValues?.address ?? '',
      country: defaultValues?.country ?? '',
      iban: defaultValues?.iban ?? '',
      bic: defaultValues?.bic ?? '',
      bankName: defaultValues?.bankName ?? '',
      paymentTermsDays: defaultValues?.paymentTermsDays ?? 30,
      currencyDefault: (defaultValues?.currencyDefault as SupplierCurrency) ?? 'XOF',
      riskScore: defaultValues?.riskScore ?? 0,
      contactEmail: defaultValues?.contactEmail ?? '',
    },
  });

  // En mode edit, si defaultValues arrive async (fetch), on re-sync.
  useEffect(() => {
    if (defaultValues && mode === 'edit') {
      reset({
        code: defaultValues.code,
        name: defaultValues.name,
        vatNumber: defaultValues.vatNumber ?? '',
        address: defaultValues.address ?? '',
        country: defaultValues.country ?? '',
        iban: defaultValues.iban ?? '',
        bic: defaultValues.bic ?? '',
        bankName: defaultValues.bankName ?? '',
        paymentTermsDays: defaultValues.paymentTermsDays,
        currencyDefault: defaultValues.currencyDefault as SupplierCurrency,
        riskScore: defaultValues.riskScore ?? 0,
        contactEmail: defaultValues.contactEmail ?? '',
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(defaultValues), mode]);

  const submit = handleSubmit((values) => {
    // Nettoie les chaînes vides en undefined (create) ou null (update).
    // Pour PATCH on garde "" → null pour permettre le clear côté backend.
    const cleanStr = (v: string | undefined): string | undefined =>
      v && v.length > 0 ? v : undefined;
    const cleanForUpdate = (v: string | undefined): string | undefined | null =>
      v && v.length > 0 ? v : null;

    if (mode === 'create') {
      const payload: CreateSupplierInput = {
        code: values.code,
        name: values.name,
        vatNumber: cleanStr(values.vatNumber),
        address: cleanStr(values.address),
        country: cleanStr(values.country),
        iban: cleanStr(values.iban),
        bic: cleanStr(values.bic),
        bankName: cleanStr(values.bankName),
        paymentTermsDays: values.paymentTermsDays,
        currencyDefault: values.currencyDefault,
        riskScore: values.riskScore,
        contactEmail: cleanStr(values.contactEmail),
      };
      return onSubmit(payload);
    }
    const updatePayload: UpdateSupplierInput = {
      // Note : code n'est pas modifiable en édition (clé d'unicité) —
      // on l'envoie quand même si changé ; backend lèvera 409 si conflit.
      code: values.code,
      name: values.name,
      vatNumber: cleanForUpdate(values.vatNumber),
      address: cleanForUpdate(values.address),
      country: cleanForUpdate(values.country),
      iban: cleanForUpdate(values.iban),
      bic: cleanForUpdate(values.bic),
      bankName: cleanForUpdate(values.bankName),
      paymentTermsDays: values.paymentTermsDays,
      currencyDefault: values.currencyDefault,
      riskScore: values.riskScore,
      contactEmail: cleanForUpdate(values.contactEmail),
    };
    return onSubmit(updatePayload);
  });

  return (
    <form
      data-testid="supplier-form"
      data-mode={mode}
      onSubmit={submit}
      // noValidate : laisse Zod faire toute la validation (sinon l'input
      // type="email" bloque le submit silencieusement sur les saisies
      // invalides avant que RHF voie l'erreur).
      noValidate
      className={cn('space-y-3', className)}
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field
          label="Code (MAJUSCULES, ex. BIOMED_SN)"
          error={errors.code?.message}
        >
          <Input
            data-testid="supplier-code"
            {...register('code')}
            disabled={mode === 'edit'}
            placeholder="BIOMED_SN"
          />
          {mode === 'edit' && (
            <p className="text-xs text-slate-muted">
              Le code est immuable après création.
            </p>
          )}
        </Field>
        <Field label="Nom complet" error={errors.name?.message}>
          <Input
            data-testid="supplier-name"
            {...register('name')}
            placeholder="BioMed Sénégal SARL"
          />
        </Field>
        <Field label="Pays (code ISO-2 ou nom)" error={errors.country?.message}>
          <Input
            data-testid="supplier-country"
            {...register('country')}
            placeholder="SN"
          />
        </Field>
        <Field label="Devise par défaut" error={errors.currencyDefault?.message}>
          <select
            data-testid="supplier-currency"
            {...register('currencyDefault')}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            {SUPPLIER_CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Délai de paiement (jours, 0-120)"
          error={errors.paymentTermsDays?.message}
        >
          <Input
            data-testid="supplier-payment-days"
            type="number"
            min={0}
            max={120}
            {...register('paymentTermsDays', { valueAsNumber: true })}
          />
        </Field>
        <Field label="Score de risque (0-100)" error={errors.riskScore?.message}>
          <Input
            data-testid="supplier-risk-score"
            type="number"
            min={0}
            max={100}
            {...register('riskScore', { valueAsNumber: true })}
          />
        </Field>
        <Field
          label="E-mail de contact (optionnel — destinataire du PDF du BC)"
          error={errors.contactEmail?.message}
        >
          <Input
            data-testid="supplier-contact-email"
            type="email"
            {...register('contactEmail')}
            placeholder="achats@fournisseur.sn"
          />
        </Field>
        <Field label="Numéro TVA (optionnel)" error={errors.vatNumber?.message}>
          <Input data-testid="supplier-vat" {...register('vatNumber')} />
        </Field>
        <Field label="Adresse (optionnel)" error={errors.address?.message}>
          <Input data-testid="supplier-address" {...register('address')} />
        </Field>
        <Field label="IBAN (optionnel)" error={errors.iban?.message}>
          <Input
            data-testid="supplier-iban"
            {...register('iban')}
            placeholder="SN08 SN10 0152 0000 ..."
          />
        </Field>
        <Field label="BIC (optionnel)" error={errors.bic?.message}>
          <Input data-testid="supplier-bic" {...register('bic')} placeholder="ECOCSNDA" />
        </Field>
        <Field label="Nom de la banque (optionnel)" error={errors.bankName?.message}>
          <Input data-testid="supplier-bank-name" {...register('bankName')} />
        </Field>
      </div>

      {errorMessage && (
        <p
          data-testid="supplier-form-error"
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
        <Button type="submit" disabled={loading} data-testid="supplier-form-submit">
          <Save className="mr-1 h-4 w-4" />
          {loading
            ? 'Enregistrement…'
            : mode === 'create'
              ? 'Créer le fournisseur'
              : 'Enregistrer'}
        </Button>
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

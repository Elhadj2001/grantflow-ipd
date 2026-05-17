'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useCreatePoFromPr, usePR } from '@/hooks/use-procurement';
import { AmountDisplay } from '@/components/common/AmountDisplay';
import { StatusBadge } from '@/components/common/StatusBadge';

const Schema = z.object({
  supplierId: z.string().uuid('Fournisseur (UUID) requis'),
  expectedDate: z.string().optional(),
  incoterm: z.string().optional(),
  deliveryAddress: z.string().optional(),
});

type FormVals = z.infer<typeof Schema>;

/**
 * Création d'un BC à partir d'une DA approuvée. Reçoit ?fromPR=<id>.
 * Si fromPR absent → message d'erreur.
 */
export default function NewPurchaseOrderPage() {
  const router = useRouter();
  const search = useSearchParams();
  const fromPR = search?.get('fromPR') ?? null;
  const pr = usePR(fromPR);
  const createM = useCreatePoFromPr();
  const [submitErr, setSubmitErr] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormVals>({ resolver: zodResolver(Schema) });

  if (!fromPR) {
    return (
      <>
        <PageHeader
          title="Nouveau bon de commande"
          subtitle="Sélectionnez d'abord une DA approuvée."
          actions={
            <Button variant="outline" onClick={() => router.push('/procurement/purchase-requests')}>
              <ArrowLeft className="mr-2 h-4 w-4" /> Aller aux DA
            </Button>
          }
        />
        <div className="p-8 text-sm text-slate-muted">
          La création d'un BC se fait depuis le détail d'une DA approuvée.
          Allez sur <code className="rounded bg-slate-100 px-1.5 py-0.5">/procurement/purchase-requests</code>,
          ouvrez une DA <code>approved</code>, puis cliquez sur <em>Créer un BC</em>.
        </div>
      </>
    );
  }

  const onSubmit = handleSubmit(async (values) => {
    setSubmitErr(null);
    try {
      const result = await createM.mutateAsync({
        prId: fromPR,
        input: {
          supplierId: values.supplierId,
          expectedDate: values.expectedDate || undefined,
          incoterm: values.incoterm || undefined,
          deliveryAddress: values.deliveryAddress || undefined,
        },
      });
      router.push(`/procurement/purchase-orders/${result.id}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erreur inconnue';
      setSubmitErr(msg);
    }
  });

  return (
    <>
      <PageHeader
        title="Nouveau bon de commande"
        subtitle={pr.data ? `À partir de ${pr.data.prNumber}` : 'Chargement de la DA…'}
        actions={
          <Button
            variant="outline"
            onClick={() => router.push(`/procurement/purchase-requests/${fromPR}`)}
          >
            <ArrowLeft className="mr-2 h-4 w-4" /> Retour DA
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-6 p-8 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <form onSubmit={onSubmit} className="space-y-6" data-testid="po-form">
            <Card>
              <CardHeader>
                <CardTitle>Informations BC</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="md:col-span-2">
                  <Label htmlFor="supplierId">Fournisseur (UUID) *</Label>
                  <Input id="supplierId" {...register('supplierId')} placeholder="00000000-…" />
                  {errors.supplierId && (
                    <p className="mt-1 text-xs text-state-error">{errors.supplierId.message}</p>
                  )}
                </div>
                <div>
                  <Label htmlFor="expectedDate">Date livraison souhaitée</Label>
                  <Input id="expectedDate" type="date" {...register('expectedDate')} />
                </div>
                <div>
                  <Label htmlFor="incoterm">Incoterm</Label>
                  <Input id="incoterm" {...register('incoterm')} placeholder="DDP, FOB, CIF…" />
                </div>
                <div className="md:col-span-2">
                  <Label htmlFor="deliveryAddress">Adresse de livraison</Label>
                  <Input id="deliveryAddress" {...register('deliveryAddress')} />
                </div>
              </CardContent>
            </Card>

            {submitErr && (
              <div className="rounded-md border border-state-error/40 bg-state-error/10 px-4 py-2 text-sm text-state-error">
                {submitErr}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button type="submit" disabled={createM.isPending} data-testid="po-submit">
                {createM.isPending ? 'Création…' : 'Créer le BC'}
              </Button>
            </div>
          </form>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>DA source</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {pr.data ? (
              <>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs">{pr.data.prNumber}</span>
                  <StatusBadge status={pr.data.status} />
                </div>
                <p className="text-slate-muted">{pr.data.description ?? '—'}</p>
                <div className="pt-2">
                  <span className="text-xs text-slate-muted">Total DA :</span>{' '}
                  <AmountDisplay amount={pr.data.totalAmount} currency={pr.data.currency} />
                </div>
                <p className="pt-2 text-xs text-slate-muted">
                  Les lignes du BC seront pré-remplies à partir de la DA. Les quantités
                  et prix unitaires sont reportés, le compte fournisseur et la TVA
                  sont à compléter après création.
                </p>
              </>
            ) : (
              <p className="text-slate-muted">Chargement…</p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

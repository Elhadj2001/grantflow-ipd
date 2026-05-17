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
import { useCreateGrFromPo, usePO } from '@/hooks/use-procurement';
import { StatusBadge } from '@/components/common/StatusBadge';

const Schema = z.object({
  receiptDate: z.string().optional(),
  deliveryNoteRef: z.string().optional(),
  coldChainRequired: z.boolean().optional(),
  notes: z.string().optional(),
});
type FormVals = z.infer<typeof Schema>;

export default function NewGoodsReceiptPage() {
  const router = useRouter();
  const search = useSearchParams();
  const fromPO = search?.get('fromPO') ?? null;
  const po = usePO(fromPO);
  const createM = useCreateGrFromPo();
  const [err, setErr] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
  } = useForm<FormVals>({ resolver: zodResolver(Schema), defaultValues: { coldChainRequired: false } });

  if (!fromPO) {
    return (
      <>
        <PageHeader title="Nouvelle réception" subtitle="Sélectionnez d'abord un BC." />
        <div className="p-8 text-sm text-slate-muted">
          Une réception se crée depuis le détail d'un BC. Allez sur{' '}
          <code className="rounded bg-slate-100 px-1.5 py-0.5">/procurement/purchase-orders</code>,
          ouvrez un BC <em>sent</em> ou <em>partially_received</em>, puis cliquez
          sur <em>Nouvelle réception</em>.
        </div>
      </>
    );
  }

  const onSubmit = handleSubmit(async (values) => {
    setErr(null);
    try {
      const result = await createM.mutateAsync({
        poId: fromPO,
        input: {
          receiptDate: values.receiptDate || undefined,
          deliveryNoteRef: values.deliveryNoteRef || undefined,
          coldChainRequired: values.coldChainRequired,
          notes: values.notes || undefined,
        },
      });
      router.push(`/procurement/goods-receipts/${result.id}`);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Erreur inconnue');
    }
  });

  return (
    <>
      <PageHeader
        title="Nouvelle réception"
        subtitle={po.data ? `À partir de ${po.data.poNumber}` : 'Chargement du BC…'}
        actions={
          <Button
            variant="outline"
            onClick={() => router.push(`/procurement/purchase-orders/${fromPO}`)}
          >
            <ArrowLeft className="mr-2 h-4 w-4" /> Retour BC
          </Button>
        }
      />
      <div className="grid grid-cols-1 gap-6 p-8 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <form onSubmit={onSubmit} className="space-y-4" data-testid="gr-form">
            <Card>
              <CardHeader>
                <CardTitle>Informations réception</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <Label htmlFor="receiptDate">Date de réception</Label>
                  <Input id="receiptDate" type="date" {...register('receiptDate')} />
                </div>
                <div>
                  <Label htmlFor="deliveryNoteRef">N° bon de livraison</Label>
                  <Input id="deliveryNoteRef" {...register('deliveryNoteRef')} placeholder="BL-2026-…" />
                </div>
                <div className="md:col-span-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" {...register('coldChainRequired')} className="h-4 w-4" />
                    <span>Chaîne du froid requise (réactifs / vaccins biomédicaux)</span>
                  </label>
                </div>
                <div className="md:col-span-2">
                  <Label htmlFor="notes">Notes</Label>
                  <Input id="notes" {...register('notes')} />
                </div>
              </CardContent>
            </Card>

            {err && (
              <div className="rounded-md border border-state-error/40 bg-state-error/10 px-4 py-2 text-sm text-state-error">
                {err}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button type="submit" disabled={createM.isPending} data-testid="gr-submit">
                {createM.isPending ? 'Création…' : 'Créer la réception'}
              </Button>
            </div>
          </form>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>BC source</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {po.data ? (
              <>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs">{po.data.poNumber}</span>
                  <StatusBadge status={po.data.status} />
                </div>
                <p className="text-slate-muted">{po.data.lines.length} ligne(s)</p>
                <p className="pt-2 text-xs text-slate-muted">
                  Les quantités à recevoir sont pré-remplies à 0 ;
                  le magasinier renseigne les quantités effectives + lot + péremption
                  à l'étape suivante via le détail.
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

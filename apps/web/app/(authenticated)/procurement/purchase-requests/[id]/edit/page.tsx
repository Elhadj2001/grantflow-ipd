'use client';

import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PurchaseRequestForm } from '@/components/procurement/PurchaseRequestForm';
import { usePR, useUpdatePR } from '@/hooks/use-procurement';

export default function EditPurchaseRequestPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id ?? '';
  const pr = usePR(id);
  const updateM = useUpdatePR(id);

  if (pr.isLoading || !pr.data) {
    return (
      <>
        <PageHeader title="Modifier la DA" subtitle="Chargement…" />
        <div className="p-8">
          <Skeleton className="h-96 w-full" />
        </div>
      </>
    );
  }
  const data = pr.data;
  if (data.status !== 'draft') {
    return (
      <>
        <PageHeader
          title="Modification impossible"
          subtitle="Cette DA n'est plus en brouillon."
          actions={
            <Button
              variant="outline"
              onClick={() => router.push(`/procurement/purchase-requests/${id}`)}
            >
              <ArrowLeft className="mr-2 h-4 w-4" /> Retour au détail
            </Button>
          }
        />
        <div className="p-8 text-sm text-slate-muted">
          Statut actuel : <strong>{data.status}</strong>. Seules les DA en
          <em> draft</em> peuvent être modifiées.
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            <span className="font-mono text-base text-slate-muted">{data.prNumber}</span>
            <span className="text-base">— modifier</span>
          </span>
        }
        actions={
          <Button
            variant="outline"
            onClick={() => router.push(`/procurement/purchase-requests/${id}`)}
          >
            <ArrowLeft className="mr-2 h-4 w-4" /> Annuler
          </Button>
        }
      />
      <div className="p-8">
        <PurchaseRequestForm
          submitting={updateM.isPending}
          submitLabel="Enregistrer les modifications"
          defaultValues={{
            description: data.description ?? '',
            projectId: data.projectId,
            grantId: data.grantId,
            costCenterId: data.costCenterId ?? '',
            activityId: data.activityId ?? '',
            neededBy: data.neededBy ?? '',
            currency: data.currency,
            requestType: (data.requestType ?? 'standard') as 'standard' | 'petty_cash' | 'cash_advance',
            lines: data.lines.map((l) => ({
              description: l.description,
              quantity: Number(l.quantity),
              unit: l.unit ?? 'unit',
              unitPrice: Number(l.unitPrice),
              budgetLineId: l.budgetLineId,
            })),
          }}
          onSubmit={async (values) => {
            await updateM.mutateAsync(values);
            router.push(`/procurement/purchase-requests/${id}`);
          }}
        />
      </div>
    </>
  );
}

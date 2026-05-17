'use client';

import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/button';
import { PurchaseRequestForm } from '@/components/procurement/PurchaseRequestForm';
import { useCreatePR } from '@/hooks/use-procurement';
import { usePermissions } from '@/hooks/use-permissions';

export default function NewPurchaseRequestPage() {
  const router = useRouter();
  const permissions = usePermissions();
  const createMutation = useCreatePR();

  // Garde côté UI : si l'utilisateur n'a pas le droit de créer, redirige
  if (permissions.roles.length > 0 && !permissions.canCreatePR()) {
    router.replace('/procurement/purchase-requests');
    return null;
  }

  return (
    <>
      <PageHeader
        title="Nouvelle demande d'achat"
        subtitle="Renseignez l'imputation analytique et les lignes."
        actions={
          <Button
            variant="outline"
            onClick={() => router.push('/procurement/purchase-requests')}
          >
            <ArrowLeft className="mr-2 h-4 w-4" /> Retour
          </Button>
        }
      />
      <div className="p-8">
        <PurchaseRequestForm
          submitting={createMutation.isPending}
          onSubmit={async (values) => {
            const result = await createMutation.mutateAsync(values);
            router.push(`/procurement/purchase-requests/${result.id}`);
          }}
        />
      </div>
    </>
  );
}

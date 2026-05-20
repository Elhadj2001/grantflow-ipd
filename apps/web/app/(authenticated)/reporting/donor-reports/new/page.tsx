'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/button';
import {
  DonorReportWizard,
  type WizardValues,
} from '@/components/reporting/DonorReportWizard';
import { useGrantsList } from '@/hooks/use-referential';
import { useDonorTemplates, useCreateDonorReport } from '@/hooks/use-reporting';
import { usePermissions } from '@/hooks/use-permissions';
import { ApiError } from '@/lib/api-client';

/**
 * Création d'un rapport bailleur — wizard 4 steps.
 *
 * Réservé CG / DAF / SUPER_ADMIN (canCreateDonorReport). Le wizard
 * agrège les données nécessaires (grants actifs + templates) avant
 * de laisser l'utilisateur composer son rapport.
 *
 * Après création (status=draft), redirection vers le détail où le CG
 * peut déclencher lock + send.
 */
export default function NewDonorReportPage() {
  const router = useRouter();
  const perms = usePermissions();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!perms.canCreateDonorReport()) {
      router.replace('/reporting/donor-reports');
    }
  }, [perms, router]);

  const grantsQuery = useGrantsList({ status: 'active', pageSize: 100 });
  const templatesQuery = useDonorTemplates();
  const createM = useCreateDonorReport();

  const handleSubmit = async (values: WizardValues) => {
    setError(null);
    try {
      const report = await createM.mutateAsync({
        grantId: values.grantId,
        templateId: values.templateId,
        periodStart: values.periodStart,
        periodEnd: values.periodEnd,
        notes: values.notes && values.notes.length > 0 ? values.notes : undefined,
      });
      router.push(`/reporting/donor-reports/${report.id}`);
    } catch (e: unknown) {
      if (e instanceof ApiError) {
        setError(`Erreur ${e.status} — ${e.body.message ?? 'cas métier'}`);
      } else if (e instanceof Error) {
        setError(e.message);
      } else {
        setError('Erreur inconnue lors de la création.');
      }
    }
  };

  const loading = grantsQuery.isLoading || templatesQuery.isLoading;
  const grants = grantsQuery.data?.data ?? [];
  const templates = templatesQuery.data ?? [];

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHeader
        title="Nouveau rapport bailleur"
        subtitle="Wizard 4 étapes : convention → template → période → aperçu"
        actions={
          <Button variant="outline" onClick={() => router.push('/reporting/donor-reports')}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            Retour
          </Button>
        }
      />

      <div className="mx-auto max-w-4xl px-8 py-6">
        {loading && <p className="text-sm text-slate-muted">Chargement des conventions et templates…</p>}
        {!loading && (
          <DonorReportWizard
            grants={grants}
            templates={templates}
            loading={createM.isPending}
            errorMessage={error}
            onSubmit={handleSubmit}
          />
        )}
      </div>
    </div>
  );
}

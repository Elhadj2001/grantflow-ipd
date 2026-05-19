'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, FileCode2 } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { SepaPreview } from '@/components/treasury/SepaPreview';
import {
  useDownloadSepa,
  useGenerateSepa,
  useMarkSepaSent,
  usePaymentRun,
} from '@/hooks/use-treasury';
import { usePermissions } from '@/hooks/use-permissions';

/**
 * Page d'aperçu + téléchargement du XML SEPA pain.001.001.03.
 *
 * Le XML est récupéré via GET /payment-runs/:id/sepa, qui renvoie 409
 * SEPA_NOT_GENERATED si pas encore généré. Dans ce cas on affiche un
 * bouton pour lancer la génération.
 */
export default function PaymentRunSepaPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id ?? '';
  const permissions = usePermissions();
  const run = usePaymentRun(id);
  const downloadM = useDownloadSepa();
  const generateM = useGenerateSepa(id);
  const markSentM = useMarkSepaSent(id);
  const [xml, setXml] = React.useState<string | null>(null);

  // Charge le XML à l'arrivée si déjà généré
  React.useEffect(() => {
    if (run.data?.sepaGeneratedAt && !xml) {
      downloadM
        .mutateAsync({ runId: id, runNumber: run.data.runNumber })
        .then((res) => setXml(res.xml))
        .catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.data?.sepaGeneratedAt, id]);

  const triggerDownload = async () => {
    if (!run.data) return;
    const res = await downloadM.mutateAsync({
      runId: id,
      runNumber: run.data.runNumber,
    });
    // Crée un blob + anchor pour déclencher le téléchargement navigateur
    const blob = new Blob([res.xml], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = res.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 100);
  };

  if (run.isLoading || !run.data) {
    return (
      <>
        <PageHeader title="SEPA pain.001.001.03" subtitle="Chargement…" />
        <div className="space-y-4 p-8">
          <Skeleton className="h-96 w-full" />
        </div>
      </>
    );
  }

  const data = run.data;
  const notGenerated = !data.sepaGeneratedAt;

  return (
    <>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            <FileCode2 className="h-5 w-5 text-ipd-darker" />
            SEPA{' '}
            <span className="font-mono text-sm text-slate-muted">{data.runNumber}</span>
          </span>
        }
        subtitle="Fichier XML pain.001.001.03 (Customer Credit Transfer Initiation)"
        actions={
          <Button
            variant="outline"
            onClick={() => router.push(`/treasury/payment-runs/${id}`)}
          >
            <ArrowLeft className="mr-2 h-4 w-4" /> Retour au run
          </Button>
        }
      />

      <div className="space-y-4 p-8">
        {notGenerated && (
          <div className="flex items-center justify-between rounded-md border border-state-warning/40 bg-state-warning/10 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-state-warning">
                Le fichier SEPA n'a pas encore été généré pour ce run.
              </p>
              <p className="text-xs text-slate-muted">
                Pré-conditions : run en statut <code>prepared</code> ou <code>executed</code>,
                tous les fournisseurs avec IBAN/BIC.
              </p>
            </div>
            {permissions.canGenerateSepa() && (
              <Button
                onClick={() => generateM.mutate()}
                disabled={generateM.isPending}
                data-testid="sepa-generate-btn"
              >
                <FileCode2 className="mr-2 h-4 w-4" />
                {generateM.isPending ? 'Génération…' : 'Générer maintenant'}
              </Button>
            )}
          </div>
        )}

        {xml && (
          <SepaPreview
            xml={xml}
            runNumber={data.runNumber}
            sentAt={data.sepaSentAt}
            loading={downloadM.isPending || markSentM.isPending}
            onDownload={triggerDownload}
            onMarkSent={
              permissions.canMarkSepaSent() && !data.sepaSentAt
                ? () => markSentM.mutate()
                : undefined
            }
          />
        )}

        {!xml && !notGenerated && (
          <Skeleton data-testid="sepa-loading-skeleton" className="h-96 w-full" />
        )}
      </div>
    </>
  );
}

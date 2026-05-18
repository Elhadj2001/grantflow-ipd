'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { ArrowLeft, Printer, Loader2, LayoutGrid, Maximize2, RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useGR } from '@/hooks/use-procurement';
import { usePermissions } from '@/hooks/use-permissions';
import { cn } from '@/lib/utils';

type LabelFormat = 'grid-4x4' | 'individual';

/**
 * Page d'impression des étiquettes QR pour un GoodsReceipt. Le PDF est
 * généré côté serveur (GET /goods-receipts/:id/labels.pdf) puis affiché
 * en iframe inline pour permettre window.print() au clic utilisateur.
 *
 * Format par défaut : grille 4×4 (16 étiquettes A4). Le magasinier
 * choisit aussi le nombre de cartons par ligne (count) — utile quand
 * une ligne contient plusieurs colis.
 */
export default function LabelsPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id ?? '';
  const permissions = usePermissions();
  const gr = useGR(id);
  const { data: session } = useSession();
  const accessToken = session?.accessToken ?? null;

  const [format, setFormat] = React.useState<LabelFormat>('grid-4x4');
  const [cartonCount, setCartonCount] = React.useState(1);
  const [pdfUrl, setPdfUrl] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const generate = React.useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
      const url = `${baseUrl}/goods-receipts/${id}/labels.pdf?format=${format}&count=${cartonCount}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        setError(`Erreur ${res.status} lors de la génération du PDF.`);
        return;
      }
      const blob = await res.blob();
      // Cleanup l'ancienne URL pour éviter une fuite
      setPdfUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(blob);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur réseau');
    } finally {
      setLoading(false);
    }
  }, [accessToken, id, format, cartonCount]);

  // Cleanup à l'unmount
  React.useEffect(() => {
    return () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Garde RBAC après tous les hooks (rules-of-hooks)
  if (permissions.roles.length > 0 && !permissions.canReceive()) {
    router.replace(`/procurement/goods-receipts/${id}`);
    return null;
  }

  const print = () => {
    // L'iframe a sandbox vide → window.print() depuis sandbox ne marche pas.
    // Solution : ouvrir le PDF dans un nouvel onglet et déclencher l'impression
    // via les contrôles natifs du viewer PDF.
    if (pdfUrl) window.open(pdfUrl, '_blank');
  };

  return (
    <>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            <Printer className="h-5 w-5 text-ipd-darker" />
            Étiquettes QR
            {gr.data && (
              <span className="font-mono text-sm text-slate-muted">
                · {gr.data.grNumber}
              </span>
            )}
          </span>
        }
        subtitle="Génération PDF pour traçabilité magasin (scannable plus tard via /inventaire-scan)"
        actions={
          <Button
            variant="outline"
            onClick={() => router.push(`/procurement/goods-receipts/${id}`)}
          >
            <ArrowLeft className="mr-2 h-4 w-4" /> Retour
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-6 p-8 lg:grid-cols-3">
        {/* Configuration */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-sm">Configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label className="mb-2 block text-xs uppercase tracking-wide text-slate-muted">
                Format
              </Label>
              <div className="grid grid-cols-2 gap-2">
                <FormatCard
                  selected={format === 'grid-4x4'}
                  onClick={() => setFormat('grid-4x4')}
                  Icon={LayoutGrid}
                  title="Grille 4×4"
                  description="16 / page A4"
                  testId="format-grid-4x4"
                />
                <FormatCard
                  selected={format === 'individual'}
                  onClick={() => setFormat('individual')}
                  Icon={Maximize2}
                  title="Pleine page"
                  description="1 / page (gros colis)"
                  testId="format-individual"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="carton-count" className="mb-1 block text-xs uppercase tracking-wide text-slate-muted">
                Cartons par ligne
              </Label>
              <Input
                id="carton-count"
                data-testid="carton-count-input"
                type="number"
                inputMode="numeric"
                min={1}
                max={64}
                value={cartonCount}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isInteger(n) && n >= 1 && n <= 64) setCartonCount(n);
                }}
                className="min-h-12 font-mono"
              />
              <p className="mt-1 text-xs text-slate-muted">
                Une étiquette par carton — chaque ligne reçoit {cartonCount} étiquette
                {cartonCount > 1 ? 's' : ''} (numérotées 1 à {cartonCount}).
              </p>
            </div>

            {gr.data && (
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs">
                <p className="font-medium text-slate-text">{gr.data.grNumber}</p>
                <p className="text-slate-muted">
                  {gr.data.lines?.length ?? 0} ligne{(gr.data.lines?.length ?? 0) > 1 ? 's' : ''}
                  {' '}× {cartonCount} carton{cartonCount > 1 ? 's' : ''}
                  {' = '}
                  <b>{(gr.data.lines?.length ?? 0) * cartonCount}</b> étiquette
                  {(gr.data.lines?.length ?? 0) * cartonCount > 1 ? 's' : ''}
                </p>
                {gr.data.coldChainRequired && (
                  <Badge variant="default" className="mt-2 text-[10px]">
                    ❄ Cold-chain
                  </Badge>
                )}
              </div>
            )}

            <Button
              onClick={generate}
              disabled={loading}
              className="w-full min-h-12"
              data-testid="generate-labels"
            >
              {loading ? (
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              ) : pdfUrl ? (
                <RefreshCw className="mr-2 h-5 w-5" />
              ) : (
                <Printer className="mr-2 h-5 w-5" />
              )}
              {loading ? 'Génération…' : pdfUrl ? 'Régénérer' : 'Générer le PDF'}
            </Button>

            {pdfUrl && (
              <Button
                variant="outline"
                onClick={print}
                className="w-full min-h-12"
                data-testid="print-labels"
              >
                <Printer className="mr-2 h-5 w-5" /> Ouvrir + imprimer
              </Button>
            )}

            {error && (
              <p className="rounded-md border border-state-error/40 bg-state-error/10 px-3 py-2 text-xs text-state-error">
                {error}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Aperçu */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Aperçu A4</CardTitle>
            </CardHeader>
            <CardContent className="p-2">
              {pdfUrl ? (
                <iframe
                  data-testid="labels-iframe"
                  title="Aperçu étiquettes"
                  src={pdfUrl}
                  className="h-[700px] w-full rounded-md border border-slate-200"
                  sandbox=""
                />
              ) : (
                <div
                  data-testid="labels-empty"
                  className="flex h-[700px] flex-col items-center justify-center gap-3 rounded-md border border-dashed border-slate-200 bg-cream"
                >
                  <Printer className="h-12 w-12 text-slate-muted" />
                  <p className="text-sm text-slate-muted">
                    Cliquez sur <b>Générer le PDF</b> pour produire les étiquettes.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

function FormatCard({
  selected,
  onClick,
  Icon,
  title,
  description,
  testId,
}: {
  selected: boolean;
  onClick: () => void;
  Icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      data-selected={selected ? 'true' : 'false'}
      className={cn(
        'flex flex-col items-center gap-1 rounded-md border-2 p-3 text-center transition-colors',
        selected
          ? 'border-ipd-dark bg-ipd-50 text-ipd-darker'
          : 'border-slate-200 bg-white text-slate-muted hover:border-ipd-dark hover:text-ipd-darker',
      )}
    >
      <Icon className="h-6 w-6" />
      <span className="text-sm font-medium">{title}</span>
      <span className="text-[10px] text-slate-muted">{description}</span>
    </button>
  );
}

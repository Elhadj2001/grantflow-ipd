'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Camera,
  CheckCircle2,
  Package,
  Search,
} from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { DateDisplay } from '@/components/common/DateDisplay';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScanBarcode } from '@/components/scan/ScanBarcode';
import { BarcodeQuickInput } from '@/components/scan/BarcodeQuickInput';
import { ColdChainBadge } from '@/components/scan/ColdChainBadge';
import { ScanResultBadge, type ScanResultKind } from '@/components/scan/ScanResultBadge';
import { useGR } from '@/hooks/use-procurement';
import { usePermissions } from '@/hooks/use-permissions';
import { parseGrfUri } from '@/lib/scan/grf-uri';

const EXPIRY_WARN_DAYS = 30;

interface ScanContext {
  grId: string;
  lineId: string;
  carton?: number;
}

/**
 * Page d'audit inventaire post-réception : scanner un QR collé sur un
 * carton, afficher sa provenance complète (GR + ligne + lot + péremption)
 * et alerter si la péremption approche (< 30 jours).
 *
 * Démontre la valeur long-terme du système d'étiquetage QR généré par
 * la page /labels — réutilisé pour le suivi inventaire après stocking.
 */
export default function InventaireScanPage() {
  const router = useRouter();
  const permissions = usePermissions();
  const [ctx, setCtx] = React.useState<ScanContext | null>(null);
  const [scanActive, setScanActive] = React.useState(false);
  const [feedback, setFeedback] = React.useState<{
    kind: ScanResultKind;
    message: string | null;
  }>({ kind: null, message: null });

  // useGR est appelé inconditionnellement (passe null si pas de ctx)
  const gr = useGR(ctx?.grId);

  if (permissions.roles.length > 0 && !permissions.canReceive()) {
    router.replace('/procurement/goods-receipts');
    return null;
  }

  const onDecoded = (decoded: string) => {
    const parsed = parseGrfUri(decoded);
    if (!parsed) {
      setFeedback({
        kind: 'error',
        message: `Code "${decoded.slice(0, 40)}…" non reconnu — format GRF:// attendu.`,
      });
      setCtx(null);
      return;
    }
    setCtx({ grId: parsed.grId, lineId: parsed.lineId, carton: parsed.carton });
    setFeedback({ kind: 'ok', message: 'QR reconnu — recherche en base…' });
  };

  const matchedLine = ctx && gr.data?.lines.find((l) => l.id === ctx.lineId);

  return (
    <>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            <Search className="h-5 w-5 text-ipd-darker" /> Audit inventaire
          </span>
        }
        subtitle="Scannez un QR magasin pour identifier l'origine et l'état du colis"
        actions={
          <Button variant="outline" onClick={() => router.push('/procurement/goods-receipts')}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Retour
          </Button>
        }
      />

      <div className="p-4 md:p-8">
        {scanActive && (
          <ScanBarcode
            onScan={onDecoded}
            onClose={() => setScanActive(false)}
            onSwitchToManual={() => setScanActive(false)}
          />
        )}

        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Button
            size="lg"
            onClick={() => setScanActive(true)}
            className="min-h-12"
            data-testid="open-scanner"
          >
            <Camera className="mr-2 h-5 w-5" /> Ouvrir le scanner
          </Button>
          {ctx && (
            <Button variant="outline" size="lg" onClick={() => setCtx(null)} className="min-h-12">
              Effacer
            </Button>
          )}
          {feedback.kind && (
            <ScanResultBadge kind={feedback.kind} message={feedback.message} />
          )}
        </div>

        <div className="mb-4 rounded-md border border-slate-200 bg-white p-3">
          <BarcodeQuickInput
            onSubmit={onDecoded}
            placeholder="GRF://… (collez le contenu d'un QR)"
          />
        </div>

        {!ctx && (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <Package className="h-16 w-16 text-slate-muted" />
              <h2 className="text-base font-semibold text-slate-text">
                Scannez un carton
              </h2>
              <p className="max-w-md text-sm text-slate-muted">
                Cette page lit les QR au format <code>GRF://&lt;grId&gt;/&lt;lineId&gt;/&lt;carton&gt;</code>
                {' '}générés par <a href="#" className="text-ipd-darker underline">la page Étiquettes
                QR</a> d'un GR. Elle vous montre la provenance complète : N° de réception,
                lot, péremption, chaîne du froid.
              </p>
            </CardContent>
          </Card>
        )}

        {ctx && gr.isLoading && (
          <Card>
            <CardContent className="py-8 text-center text-sm text-slate-muted">
              Recherche du GR <code>{ctx.grId.slice(0, 8)}…</code>…
            </CardContent>
          </Card>
        )}

        {ctx && !gr.isLoading && !gr.data && (
          <Card data-testid="scan-result-notfound">
            <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
              <AlertCircle className="h-12 w-12 text-state-error" />
              <p className="text-sm font-medium text-state-error">
                Aucun GR trouvé pour cet ID.
              </p>
              <p className="text-xs text-slate-muted">
                Le QR pointe vers un GR introuvable ou supprimé.
              </p>
            </CardContent>
          </Card>
        )}

        {ctx && gr.data && !matchedLine && (
          <Card data-testid="scan-result-line-notfound">
            <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
              <AlertTriangle className="h-12 w-12 text-state-warning" />
              <p className="text-sm font-medium text-state-warning">
                GR trouvé mais ligne <code>{ctx.lineId.slice(0, 8)}…</code> introuvable.
              </p>
              <p className="text-xs text-slate-muted">
                Possible désynchronisation entre l'étiquette imprimée et le GR actuel.
              </p>
            </CardContent>
          </Card>
        )}

        {ctx && gr.data && matchedLine && (
          <ResultCard
            grNumber={gr.data.grNumber}
            grId={gr.data.id}
            lineNumber={matchedLine.id ? findLineNumberFromLines(gr.data.lines, matchedLine.id) : null}
            quantity={Number(matchedLine.quantity)}
            batchNumber={matchedLine.batchNumber ?? null}
            expiryDate={matchedLine.expiryDate ?? null}
            coldChainRequired={gr.data.coldChainRequired}
            coldChainOk={matchedLine.coldChainOk ?? null}
            qualityCheck={matchedLine.qualityCheck ?? null}
            cartonNumber={ctx.carton}
            onOpenGr={() => router.push(`/procurement/goods-receipts/${gr.data!.id}`)}
          />
        )}
      </div>
    </>
  );
}

function findLineNumberFromLines(
  lines: Array<{ id?: string }>,
  lineId: string,
): number | null {
  const idx = lines.findIndex((l) => l.id === lineId);
  return idx >= 0 ? idx + 1 : null;
}

function ResultCard(props: {
  grNumber: string;
  grId: string;
  lineNumber: number | null;
  quantity: number;
  batchNumber: string | null;
  expiryDate: string | null;
  coldChainRequired: boolean;
  coldChainOk: boolean | null;
  qualityCheck: string | null;
  cartonNumber?: number;
  onOpenGr: () => void;
}) {
  const expiryInfo = analyzeExpiry(props.expiryDate);
  return (
    <Card
      data-testid="scan-result-card"
      data-expiry={expiryInfo.state}
      className={
        expiryInfo.state === 'expired'
          ? 'border-2 border-state-error'
          : expiryInfo.state === 'soon'
            ? 'border-2 border-state-warning'
            : ''
      }
    >
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2">
            <Package className="h-5 w-5 text-ipd-darker" />
            <span className="font-mono">{props.grNumber}</span>
            {props.lineNumber !== null && (
              <Badge variant="muted" className="text-xs">
                Ligne {props.lineNumber}
              </Badge>
            )}
            {props.cartonNumber && (
              <Badge variant="default" className="text-xs">
                Carton {props.cartonNumber}
              </Badge>
            )}
          </span>
          <Button size="sm" variant="outline" onClick={props.onOpenGr}>
            Ouvrir le GR
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field
          label="Quantité reçue"
          value={<span className="font-mono">{props.quantity}</span>}
        />
        <Field
          label="Lot / Batch"
          value={
            props.batchNumber ? (
              <span className="font-mono">{props.batchNumber}</span>
            ) : (
              <span className="text-slate-muted">Non renseigné</span>
            )
          }
        />
        <Field
          label="Péremption"
          value={
            props.expiryDate ? (
              <span
                className={
                  expiryInfo.state === 'expired'
                    ? 'font-medium text-state-error'
                    : expiryInfo.state === 'soon'
                      ? 'font-medium text-state-warning'
                      : ''
                }
                data-testid="expiry-display"
                data-state={expiryInfo.state}
              >
                <DateDisplay value={props.expiryDate} format="short" />
                {expiryInfo.daysRemaining !== null && expiryInfo.state !== 'ok' && (
                  <span className="ml-2 text-xs">
                    ({expiryInfo.daysRemaining < 0
                      ? `Périmé depuis ${-expiryInfo.daysRemaining} j`
                      : `${expiryInfo.daysRemaining} j restant${expiryInfo.daysRemaining > 1 ? 's' : ''}`})
                  </span>
                )}
              </span>
            ) : (
              <span className="text-slate-muted">Non renseignée</span>
            )
          }
        />
        {props.coldChainRequired && (
          <div className="md:col-span-2">
            <ColdChainBadge required value={props.coldChainOk} readOnly />
          </div>
        )}
        {props.qualityCheck && (
          <Field
            label="Contrôle qualité"
            value={<span className="text-sm">{props.qualityCheck}</span>}
          />
        )}

        {expiryInfo.state === 'expired' && (
          <div
            data-testid="expiry-alert-expired"
            className="md:col-span-2 flex items-start gap-2 rounded-md border border-state-error bg-state-error/10 px-3 py-2 text-sm text-state-error"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <b>Produit périmé.</b> Retirer du stock immédiatement et notifier le contrôle qualité.
            </span>
          </div>
        )}
        {expiryInfo.state === 'soon' && (
          <div
            data-testid="expiry-alert-soon"
            className="md:col-span-2 flex items-start gap-2 rounded-md border border-state-warning bg-state-warning/10 px-3 py-2 text-sm text-state-warning"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <b>Péremption proche</b> ({expiryInfo.daysRemaining} jour{(expiryInfo.daysRemaining ?? 0) > 1 ? 's' : ''}). Prioriser la sortie de stock (FIFO).
            </span>
          </div>
        )}
        {expiryInfo.state === 'ok' && (
          <div className="md:col-span-2 flex items-center gap-2 text-xs text-state-success">
            <CheckCircle2 className="h-4 w-4" />
            <span>Aucune alerte péremption.</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-slate-muted">{label}</p>
      <div className="text-slate-text">{value}</div>
    </div>
  );
}

function analyzeExpiry(date: string | null): {
  state: 'ok' | 'soon' | 'expired' | 'unknown';
  daysRemaining: number | null;
} {
  if (!date) return { state: 'unknown', daysRemaining: null };
  const expiry = new Date(date);
  if (!Number.isFinite(expiry.getTime())) return { state: 'unknown', daysRemaining: null };
  const now = new Date();
  const days = Math.floor((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (days < 0) return { state: 'expired', daysRemaining: days };
  if (days < EXPIRY_WARN_DAYS) return { state: 'soon', daysRemaining: days };
  return { state: 'ok', daysRemaining: days };
}

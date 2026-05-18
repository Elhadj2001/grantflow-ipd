'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  ChevronRight,
  Loader2,
  Minus,
  Package,
  Plus,
  Printer,
  Truck,
} from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { AmountDisplay } from '@/components/common/AmountDisplay';
import { DateDisplay } from '@/components/common/DateDisplay';
import { EmptyState } from '@/components/common/EmptyState';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { ScanBarcode } from '@/components/scan/ScanBarcode';
import { ScanResultBadge, type ScanResultKind } from '@/components/scan/ScanResultBadge';
import { ColdChainBadge } from '@/components/scan/ColdChainBadge';
import { BarcodeQuickInput } from '@/components/scan/BarcodeQuickInput';
import {
  useCompleteGR,
  useCreateGrFromPo,
  useGR,
  useListPOs,
  usePO,
  usePoRemaining,
  useUpdateGrLines,
} from '@/hooks/use-procurement';
import { usePermissions } from '@/hooks/use-permissions';
import { parseGrfUri } from '@/lib/scan/grf-uri';
import type { GoodsReceiptDetail, PurchaseOrder } from '@/lib/api/procurement';
import { cn } from '@/lib/utils';

type Step = 'select-po' | 'receive' | 'review' | 'done';

interface LineState {
  /** UUID de la ligne GoodsReceipt (poLineId-mapped, généré par le backend). */
  grLineId: string;
  poLineId: string;
  lineNumber: number;
  description: string;
  unit: string;
  ordered: number;
  alreadyReceived: number;
  remaining: number;
  /** Qté scannée/saisie dans cette session (s'ajoute à alreadyReceived). */
  qtyThisGr: number;
  batchNumber: string;
  expiryDate: string;
  coldChainOk: boolean | null;
  qualityCheck: string;
}

const RECEIVABLE_PO_STATUSES = ['sent', 'acknowledged', 'partially_received'] as const;

export default function ReceptionRapidePage() {
  const router = useRouter();
  const permissions = usePermissions();
  const [step, setStep] = React.useState<Step>('select-po');
  const [selectedPoId, setSelectedPoId] = React.useState<string | null>(null);
  const [grId, setGrId] = React.useState<string | null>(null);
  const [lines, setLines] = React.useState<LineState[]>([]);
  const [scanActive, setScanActive] = React.useState(false);
  const [scanFeedback, setScanFeedback] = React.useState<{
    kind: ScanResultKind;
    message: string | null;
  }>({ kind: null, message: null });

  // Garde RBAC — silencieuse pour pas confondre le magasinier
  if (permissions.roles.length > 0 && !permissions.canReceive()) {
    router.replace('/procurement/goods-receipts');
    return null;
  }

  return (
    <>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            <Truck className="h-5 w-5 text-ipd-darker" /> Réception rapide
            <StepIndicator step={step} />
          </span>
        }
        subtitle="Workflow optimisé tablette/mobile — scan + saisie minimaliste"
        actions={
          <Button variant="outline" onClick={() => router.push('/procurement/goods-receipts')}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Mes réceptions
          </Button>
        }
      />

      <div className="p-4 md:p-8">
        {step === 'select-po' && (
          <SelectPoStep
            onSelect={(po) => {
              setSelectedPoId(po.id);
              setStep('receive');
            }}
          />
        )}

        {step === 'receive' && selectedPoId && (
          <ReceiveStep
            poId={selectedPoId}
            grId={grId}
            onGrReady={(gr, lineStates) => {
              setGrId(gr.id);
              setLines(lineStates);
            }}
            lines={lines}
            setLines={setLines}
            scanActive={scanActive}
            setScanActive={setScanActive}
            scanFeedback={scanFeedback}
            setScanFeedback={setScanFeedback}
            onNext={() => setStep('review')}
            onBack={() => {
              setSelectedPoId(null);
              setGrId(null);
              setLines([]);
              setStep('select-po');
            }}
          />
        )}

        {step === 'review' && grId && (
          <ReviewStep
            grId={grId}
            lines={lines}
            setLines={setLines}
            onBack={() => setStep('receive')}
            onComplete={() => setStep('done')}
          />
        )}

        {step === 'done' && grId && (
          <DoneStep grId={grId} onNew={() => {
            setSelectedPoId(null);
            setGrId(null);
            setLines([]);
            setStep('select-po');
          }} />
        )}
      </div>
    </>
  );
}

// =====================================================================
//  Step indicator
// =====================================================================

function StepIndicator({ step }: { step: Step }) {
  const STEPS: Array<{ key: Step; label: string }> = [
    { key: 'select-po', label: '1. BC' },
    { key: 'receive', label: '2. Réception' },
    { key: 'review', label: '3. Lot / Péremption' },
    { key: 'done', label: '4. Terminé' },
  ];
  const currentIdx = STEPS.findIndex((s) => s.key === step);
  return (
    <span className="ml-2 hidden gap-1 text-xs text-slate-muted md:inline-flex">
      {STEPS.map((s, i) => (
        <span
          key={s.key}
          data-testid={`step-${s.key}`}
          className={cn(
            'rounded-full px-2 py-0.5',
            i === currentIdx
              ? 'bg-ipd-darker text-white'
              : i < currentIdx
                ? 'bg-ipd-100 text-ipd-darker'
                : 'bg-slate-100',
          )}
        >
          {s.label}
        </span>
      ))}
    </span>
  );
}

// =====================================================================
//  Step 1 — Sélection BC
// =====================================================================

function SelectPoStep({ onSelect }: { onSelect: (po: PurchaseOrder) => void }) {
  // On charge les BC réceptionnables. Le backend ne supporte qu'un statut
  // par requête → on fait 3 queries en parallèle et on concat.
  const sent = useListPOs({ status: 'sent', pageSize: 50 });
  const ack = useListPOs({ status: 'acknowledged', pageSize: 50 });
  const partial = useListPOs({ status: 'partially_received', pageSize: 50 });

  const loading = sent.isLoading || ack.isLoading || partial.isLoading;
  const items: PurchaseOrder[] = React.useMemo(
    () => [
      ...(sent.data?.data ?? []),
      ...(ack.data?.data ?? []),
      ...(partial.data?.data ?? []),
    ],
    [sent.data, ack.data, partial.data],
  );

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-32 w-full" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={Package}
        title="Aucun bon de commande à réceptionner"
        description="Tous les BC sont déjà reçus ou aucun n'est encore envoyé au fournisseur."
      />
    );
  }

  return (
    <div>
      <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-slate-muted">
        Sélectionnez un bon de commande ({items.length})
      </h2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {items.map((po) => (
          <button
            type="button"
            key={po.id}
            onClick={() => onSelect(po)}
            data-testid={`po-card-${po.id}`}
            className="group min-h-32 rounded-lg border-2 border-slate-200 bg-white p-4 text-left transition-colors hover:border-ipd-dark hover:bg-ipd-50"
          >
            <div className="flex items-start justify-between">
              <span className="font-mono text-sm font-medium text-ipd-darker">
                {po.poNumber}
              </span>
              <ChevronRight className="h-4 w-4 text-slate-muted transition-transform group-hover:translate-x-1 group-hover:text-ipd-darker" />
            </div>
            <p className="mt-1 text-xs text-slate-muted">
              {RECEIVABLE_PO_STATUSES.includes(
                po.status as (typeof RECEIVABLE_PO_STATUSES)[number],
              ) && (
                <Badge variant="muted" className="mr-1 text-[10px]">
                  {po.status === 'partially_received' ? 'Reçu partiel' : po.status}
                </Badge>
              )}
              {po.expectedDate && (
                <>Livré le <DateDisplay value={po.expectedDate} format="short" /></>
              )}
            </p>
            <p className="mt-3 text-xs text-slate-muted">Total</p>
            <AmountDisplay
              amount={po.totalTtc}
              currency={po.currency}
              className="text-base font-semibold"
            />
          </button>
        ))}
      </div>
    </div>
  );
}

// =====================================================================
//  Step 2 — Réception (scan ou manuel)
// =====================================================================

interface ReceiveStepProps {
  poId: string;
  grId: string | null;
  onGrReady: (gr: GoodsReceiptDetail, lineStates: LineState[]) => void;
  lines: LineState[];
  setLines: React.Dispatch<React.SetStateAction<LineState[]>>;
  scanActive: boolean;
  setScanActive: (a: boolean) => void;
  scanFeedback: { kind: ScanResultKind; message: string | null };
  setScanFeedback: (f: { kind: ScanResultKind; message: string | null }) => void;
  onNext: () => void;
  onBack: () => void;
}

function ReceiveStep(props: ReceiveStepProps) {
  const {
    poId,
    grId,
    onGrReady,
    lines,
    setLines,
    scanActive,
    setScanActive,
    scanFeedback,
    setScanFeedback,
    onNext,
    onBack,
  } = props;

  const po = usePO(poId);
  const remaining = usePoRemaining(poId);
  const createGrM = useCreateGrFromPo();

  // Création automatique du GR draft à l'entrée dans le step si pas déjà fait
  React.useEffect(() => {
    if (grId || !po.data || !remaining.data) return;
    if (createGrM.isPending || createGrM.isSuccess) return;

    void createGrM
      .mutateAsync({
        poId,
        input: {
          // coldChainRequired sera typiquement ajusté par le magasinier
          // dans le step 3 si nécessaire — par défaut on hérite du PO
          coldChainRequired: false,
        },
      })
      .then((gr) => {
        const remMap = new Map(remaining.data!.map((r) => [r.poLineId, r]));
        const initialLines: LineState[] = gr.lines.map((l) => {
          const rem = remMap.get(l.poLineId);
          return {
            grLineId: l.id ?? '',
            poLineId: l.poLineId,
            lineNumber: rem?.lineNumber ?? 0,
            description: rem?.description ?? '—',
            unit: rem?.unit ?? 'unit',
            ordered: rem?.ordered ?? 0,
            alreadyReceived: rem?.received ?? 0,
            remaining: rem?.remaining ?? 0,
            qtyThisGr: 0,
            batchNumber: l.batchNumber ?? '',
            expiryDate: l.expiryDate?.slice(0, 10) ?? '',
            coldChainOk: l.coldChainOk ?? null,
            qualityCheck: l.qualityCheck ?? '',
          };
        });
        onGrReady(gr, initialLines);
      })
      .catch(() => undefined);
  }, [grId, po.data, remaining.data, createGrM, poId, onGrReady]);

  const incrementLine = React.useCallback(
    (poLineId: string, delta: number, viaScan: boolean) => {
      let warn: string | null = null;
      let ok: string | null = null;
      setLines((prev) =>
        prev.map((l) => {
          if (l.poLineId !== poLineId) return l;
          const next = Math.max(0, l.qtyThisGr + delta);
          if (next > l.remaining) {
            warn = `Ligne ${l.lineNumber} dépasse la quantité commandée — confirmer en step 3.`;
          } else {
            ok = `Ligne ${l.lineNumber} +${delta} (${next}/${l.remaining})`;
          }
          return { ...l, qtyThisGr: next };
        }),
      );
      if (viaScan) {
        if (warn) setScanFeedback({ kind: 'warn', message: warn });
        else if (ok) setScanFeedback({ kind: 'ok', message: ok });
      }
    },
    [setLines, setScanFeedback],
  );

  const handleScanDecoded = React.useCallback(
    (decoded: string) => {
      const parsed = parseGrfUri(decoded);
      if (!parsed) {
        setScanFeedback({
          kind: 'error',
          message: `Code "${decoded.slice(0, 30)}…" non reconnu — saisir manuellement.`,
        });
        return;
      }
      // Le QR encode <grId>/<lineId>[/<carton>]. On match sur lineId (poLineId
      // n'est pas dans le QR car généré post-création). On cherche par grLineId.
      const target = lines.find((l) => l.grLineId === parsed.lineId);
      if (!target) {
        setScanFeedback({
          kind: 'error',
          message: 'QR pas associé à ce BC.',
        });
        return;
      }
      incrementLine(target.poLineId, parsed.qty ?? 1, true);
    },
    [lines, incrementLine, setScanFeedback],
  );

  const handleManualSubmit = React.useCallback(
    (raw: string) => {
      handleScanDecoded(raw);
    },
    [handleScanDecoded],
  );

  if (createGrM.isPending || !grId || po.isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-ipd-darker" />
          <span className="ml-2 text-sm text-slate-muted">Préparation du brouillon GR…</span>
        </CardContent>
      </Card>
    );
  }

  const totalScanned = lines.reduce((s, l) => s + l.qtyThisGr, 0);
  const canProceed = totalScanned > 0;

  return (
    <div className="space-y-4">
      {scanActive && (
        <ScanBarcode
          onScan={handleScanDecoded}
          onClose={() => setScanActive(false)}
          onSwitchToManual={() => setScanActive(false)}
        />
      )}

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap gap-2">
          <Button
            size="lg"
            onClick={() => setScanActive(true)}
            className="min-h-12"
            data-testid="open-scanner"
          >
            <Camera className="mr-2 h-5 w-5" /> Ouvrir le scanner
          </Button>
          <Button variant="outline" size="lg" onClick={onBack} className="min-h-12">
            Changer de BC
          </Button>
        </div>
        {scanFeedback.kind && (
          <ScanResultBadge kind={scanFeedback.kind} message={scanFeedback.message} />
        )}
      </div>

      <div className="rounded-md border border-slate-200 bg-white p-3 md:p-4">
        <BarcodeQuickInput
          onSubmit={handleManualSubmit}
          placeholder="GRF://… ou code interne"
        />
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-muted">
          Progression ({totalScanned} colis scanné{totalScanned > 1 ? 's' : ''})
        </h2>
        {lines.map((l) => (
          <LineRow
            key={l.grLineId}
            line={l}
            onIncrement={(d) => incrementLine(l.poLineId, d, false)}
            onQtyInput={(v) =>
              setLines((prev) =>
                prev.map((x) => (x.grLineId === l.grLineId ? { ...x, qtyThisGr: v } : x)),
              )
            }
          />
        ))}
      </div>

      <div className="sticky bottom-4 flex justify-end">
        <Button
          size="lg"
          className="min-h-12 shadow-lg"
          disabled={!canProceed}
          onClick={onNext}
          data-testid="goto-review"
        >
          Valider — étape suivante <ChevronRight className="ml-1 h-5 w-5" />
        </Button>
      </div>
    </div>
  );
}

function LineRow({
  line,
  onIncrement,
  onQtyInput,
}: {
  line: LineState;
  onIncrement: (delta: number) => void;
  onQtyInput: (v: number) => void;
}) {
  const complete = line.qtyThisGr >= line.remaining && line.remaining > 0;
  const exceeds = line.qtyThisGr > line.remaining;
  return (
    <div
      data-testid={`line-row-${line.poLineId}`}
      data-state={exceeds ? 'exceeds' : complete ? 'complete' : 'pending'}
      className={cn(
        'flex flex-col gap-2 rounded-md border-2 bg-white p-3 md:flex-row md:items-center',
        exceeds
          ? 'border-state-error'
          : complete
            ? 'border-state-success bg-state-success/5'
            : 'border-slate-200',
      )}
    >
      <div className="flex-1">
        <p className="font-medium text-slate-text">
          {line.lineNumber}. {line.description}
        </p>
        <p className="text-xs text-slate-muted">
          Commandé : {line.ordered} {line.unit} · Déjà reçu : {line.alreadyReceived} · Restant :{' '}
          <b>{line.remaining}</b>
        </p>
      </div>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="min-h-10 min-w-10"
          onClick={() => onIncrement(-1)}
          disabled={line.qtyThisGr === 0}
          data-testid={`line-${line.poLineId}-minus`}
          aria-label="Diminuer"
        >
          <Minus className="h-4 w-4" />
        </Button>
        <Input
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          value={line.qtyThisGr}
          onChange={(e) => onQtyInput(Math.max(0, Number(e.target.value) || 0))}
          data-testid={`line-${line.poLineId}-qty`}
          className="h-10 w-20 text-center font-mono text-base"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="min-h-10 min-w-10"
          onClick={() => onIncrement(1)}
          data-testid={`line-${line.poLineId}-plus`}
          aria-label="Augmenter"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      {complete && !exceeds && <CheckCircle2 className="h-5 w-5 text-state-success" />}
    </div>
  );
}

// =====================================================================
//  Step 3 — Review (batch / expiry / coldchain)
// =====================================================================

function ReviewStep({
  grId,
  lines,
  setLines,
  onBack,
  onComplete,
}: {
  grId: string;
  lines: LineState[];
  setLines: React.Dispatch<React.SetStateAction<LineState[]>>;
  onBack: () => void;
  onComplete: () => void;
}) {
  const gr = useGR(grId);
  const updateLinesM = useUpdateGrLines(grId);
  const completeM = useCompleteGR(grId);

  const coldChainRequired = gr.data?.coldChainRequired ?? false;
  const linesToSubmit = lines.filter((l) => l.qtyThisGr > 0);

  const missingColdChain = coldChainRequired
    ? linesToSubmit.some((l) => l.coldChainOk === null)
    : false;
  const missingBatch = coldChainRequired
    ? linesToSubmit.some((l) => !l.batchNumber.trim())
    : false;
  const canSubmit = linesToSubmit.length > 0 && !missingColdChain && !missingBatch;

  const submit = async () => {
    // 1. PATCH des lignes scannées avec qty + batch + expiry + coldChainOk
    await updateLinesM.mutateAsync(
      linesToSubmit.map((l) => ({
        lineId: l.grLineId,
        quantity: l.alreadyReceived + l.qtyThisGr,
        batchNumber: l.batchNumber.trim() || undefined,
        expiryDate: l.expiryDate || undefined,
        coldChainOk: l.coldChainOk ?? undefined,
        qualityCheck: l.qualityCheck.trim() || undefined,
      })),
    );
    // 2. Complete le GR (propage qty sur le PO + recalcule statut)
    await completeM.mutateAsync();
    onComplete();
  };

  return (
    <div className="space-y-4">
      {coldChainRequired && (
        <div className="flex items-start gap-2 rounded-md border-2 border-ipd-darker bg-ipd-50 px-3 py-2 text-sm">
          <span className="text-ipd-darker">❄️</span>
          <div>
            <b className="text-ipd-darker">Chaîne du froid requise pour ce BC.</b>
            <p className="text-xs text-slate-muted">
              Renseignez batchNumber et indiquez l'état (Conforme/Rompue) sur chaque ligne.
              Notez la température réelle dans le contrôle qualité si besoin.
            </p>
          </div>
        </div>
      )}

      <h2 className="text-sm font-medium uppercase tracking-wide text-slate-muted">
        Lot, péremption, contrôle qualité ({linesToSubmit.length} ligne
        {linesToSubmit.length > 1 ? 's' : ''})
      </h2>

      {linesToSubmit.map((l) => (
        <Card key={l.grLineId}>
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-sm">
              <span>
                {l.lineNumber}. {l.description}
              </span>
              <Badge variant="muted" className="text-xs">
                {l.qtyThisGr} {l.unit} reçu{l.qtyThisGr > 1 ? 's' : ''}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <Label htmlFor={`batch-${l.grLineId}`} className="text-xs">
                Lot / Batch number
                {coldChainRequired && <span className="text-state-error"> *</span>}
              </Label>
              <Input
                id={`batch-${l.grLineId}`}
                data-testid={`batch-${l.poLineId}`}
                value={l.batchNumber}
                onChange={(e) =>
                  setLines((prev) =>
                    prev.map((x) =>
                      x.grLineId === l.grLineId ? { ...x, batchNumber: e.target.value } : x,
                    ),
                  )
                }
                placeholder="LOT-A123"
                className="min-h-12 font-mono"
              />
            </div>
            <div>
              <Label htmlFor={`expiry-${l.grLineId}`} className="text-xs">
                Date de péremption
              </Label>
              <Input
                id={`expiry-${l.grLineId}`}
                data-testid={`expiry-${l.poLineId}`}
                type="date"
                value={l.expiryDate}
                onChange={(e) =>
                  setLines((prev) =>
                    prev.map((x) =>
                      x.grLineId === l.grLineId ? { ...x, expiryDate: e.target.value } : x,
                    ),
                  )
                }
                className="min-h-12"
              />
            </div>
            {coldChainRequired && (
              <div className="md:col-span-2">
                <ColdChainBadge
                  required
                  value={l.coldChainOk}
                  onChange={(v) =>
                    setLines((prev) =>
                      prev.map((x) =>
                        x.grLineId === l.grLineId ? { ...x, coldChainOk: v } : x,
                      ),
                    )
                  }
                />
              </div>
            )}
            <div className="md:col-span-2">
              <Label htmlFor={`quality-${l.grLineId}`} className="text-xs">
                Contrôle qualité / température mesurée (optionnel)
              </Label>
              <Input
                id={`quality-${l.grLineId}`}
                data-testid={`quality-${l.poLineId}`}
                value={l.qualityCheck}
                onChange={(e) =>
                  setLines((prev) =>
                    prev.map((x) =>
                      x.grLineId === l.grLineId ? { ...x, qualityCheck: e.target.value } : x,
                    ),
                  )
                }
                placeholder={
                  coldChainRequired
                    ? "Ex: Reçu à -22°C, conforme."
                    : "Notes / observations qualité"
                }
              />
            </div>
          </CardContent>
        </Card>
      ))}

      {(missingColdChain || missingBatch) && (
        <p className="rounded-md border border-state-error/40 bg-state-error/10 px-3 py-2 text-sm font-medium text-state-error">
          {missingBatch
            ? 'Cold-chain : batchNumber requis sur chaque ligne.'
            : 'Cold-chain : statut conforme/rompue requis sur chaque ligne.'}
        </p>
      )}

      <div className="sticky bottom-4 flex flex-col gap-2 md:flex-row md:justify-end">
        <Button size="lg" variant="outline" onClick={onBack} className="min-h-12">
          <ArrowLeft className="mr-2 h-4 w-4" /> Retour scan
        </Button>
        <Button
          size="lg"
          className="min-h-12"
          disabled={!canSubmit || updateLinesM.isPending || completeM.isPending}
          onClick={submit}
          data-testid="complete-gr"
        >
          {updateLinesM.isPending || completeM.isPending ? (
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          ) : (
            <CheckCircle2 className="mr-2 h-5 w-5" />
          )}
          Finaliser la réception
        </Button>
      </div>
    </div>
  );
}

// =====================================================================
//  Step 4 — Done
// =====================================================================

function DoneStep({ grId, onNew }: { grId: string; onNew: () => void }) {
  const router = useRouter();
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
        <span className="flex h-20 w-20 items-center justify-center rounded-full bg-state-success/15 text-state-success">
          <CheckCircle2 className="h-12 w-12" />
        </span>
        <h2 className="text-xl font-semibold">Réception enregistrée</h2>
        <p className="max-w-md text-sm text-slate-muted">
          Le GR a été créé et complété. Vous pouvez imprimer les étiquettes QR pour
          le stocking magasin ou démarrer une nouvelle réception.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button
            onClick={() => router.push(`/procurement/goods-receipts/${grId}/labels`)}
            data-testid="goto-labels"
            className="min-h-12"
          >
            <Printer className="mr-2 h-5 w-5" /> Imprimer les étiquettes QR
          </Button>
          <Button
            variant="outline"
            onClick={() => router.push(`/procurement/goods-receipts/${grId}`)}
            className="min-h-12"
          >
            Voir le détail
          </Button>
          <Button variant="outline" onClick={onNew} className="min-h-12">
            Nouvelle réception
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}


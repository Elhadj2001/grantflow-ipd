'use client';

import * as React from 'react';
import { AlertCircle, CheckCircle2, ShieldAlert, ShieldCheck } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DiffTable, type DiffRow, type DiffStatus } from '@/components/common/DiffTable';
import type {
  InvoiceLineMatchDetail,
  InvoiceStatus,
  InvoiceWithLines,
  MatchResult,
  MatchSummary,
} from '@/lib/api/invoicing';

export interface MatchingResultPanelProps {
  invoice: InvoiceWithLines;
  summary: MatchSummary | null;
  /** Affiche le bouton "Forcer le matching" (DAF / SUPER_ADMIN). */
  showForceMatch?: boolean;
  onForceMatch?: () => void;
  forceMatchPending?: boolean;
}

/**
 * Affiche le résultat du matching 3-voies : verdict global + tableau
 * comparatif BC / Réception / Facture par ligne. Dérive un "verdict
 * UI" depuis les valeurs serveur :
 *   - "Conforme"      : status=matched, aucune ligne en exception
 *   - "Toléré (forcé)": forcedMatch présent dans summary
 *   - "Bloquant"      : status=exception_price/qty
 *   - "Non rapproché" : status=captured (avant submit)
 */
export function MatchingResultPanel({
  invoice,
  summary,
  showForceMatch,
  onForceMatch,
  forceMatchPending,
}: MatchingResultPanelProps) {
  const verdict = computeVerdict(invoice.status, summary);
  const rows = summary ? buildRows(invoice, summary) : [];

  return (
    <Card data-testid="matching-panel">
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-sm">
          <span>Rapprochement 3-voies</span>
          <VerdictBadge verdict={verdict} />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!summary && (
          <p className="text-sm text-slate-muted">
            Aucun matching n'a encore été lancé pour cette facture.
            {invoice.status === 'captured' && (
              <> Cliquez sur <b>Soumettre au matching</b> dans la barre d'actions.</>
            )}
          </p>
        )}

        {summary && (
          <>
            <div className="grid grid-cols-2 gap-3 text-xs md:grid-cols-4">
              <Metric label="Lignes OK" value={`${summary.totalLinesMatched}`} />
              <Metric label="Lignes en exception" value={`${summary.totalLinesException}`} />
              <Metric
                label="Variance prix max"
                value={`${summary.priceVarianceMax.toFixed(2)}%`}
                warn={summary.priceVarianceMax > summary.priceTolerancePct}
              />
              <Metric
                label="Variance qté max"
                value={`${summary.qtyVarianceMax.toFixed(2)}%`}
                warn={summary.qtyVarianceMax > summary.qtyTolerancePct}
              />
            </div>

            <DiffTable
              rows={rows}
              currency={invoice.currency}
              priceTolerancePct={summary.priceTolerancePct}
              qtyTolerancePct={summary.qtyTolerancePct}
            />

            {summary.forcedMatch && (
              <div
                data-testid="forced-match-trace"
                className="rounded-md border border-state-warning/40 bg-state-warning/10 px-3 py-2 text-xs text-state-warning"
              >
                <p>
                  <ShieldAlert className="mr-1 inline h-3.5 w-3.5 align-text-bottom" />
                  <b>Matching forcé</b> par {summary.forcedMatch.forcedBy} le{' '}
                  {summary.forcedMatch.forcedAt.slice(0, 10)} — statut précédent :{' '}
                  <code className="text-[10px]">{summary.forcedMatch.previousStatus}</code>
                </p>
                <p className="mt-1 italic text-slate-muted">
                  « {summary.forcedMatch.reason} »
                </p>
              </div>
            )}

            {showForceMatch && verdict === 'blocking' && (
              <div className="flex items-center justify-between rounded-md border border-state-warning/40 bg-state-warning/10 px-3 py-2">
                <span className="text-xs text-slate-text">
                  Le rapprochement bloque cette facture. En tant que DAF, vous pouvez forcer
                  le matched avec motif d'audit.
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onForceMatch}
                  disabled={forceMatchPending}
                  data-testid="force-match-btn"
                >
                  Forcer le matching
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

type Verdict = 'perfect' | 'tolerated' | 'blocking' | 'pending';

function computeVerdict(status: InvoiceStatus, summary: MatchSummary | null): Verdict {
  if (!summary || status === 'captured') return 'pending';
  if (summary.forcedMatch) return 'tolerated';
  if (status === 'matched') return 'perfect';
  if (status === 'exception_price' || status === 'exception_qty') return 'blocking';
  return 'pending';
}

function VerdictBadge({ verdict }: { verdict: Verdict }) {
  if (verdict === 'perfect') {
    return (
      <Badge variant="success" data-testid="verdict-badge">
        <CheckCircle2 className="mr-1 h-3 w-3" /> Match parfait
      </Badge>
    );
  }
  if (verdict === 'tolerated') {
    return (
      <Badge variant="warning" data-testid="verdict-badge">
        <ShieldCheck className="mr-1 h-3 w-3" /> Toléré (forcé)
      </Badge>
    );
  }
  if (verdict === 'blocking') {
    return (
      <Badge variant="error" data-testid="verdict-badge">
        <AlertCircle className="mr-1 h-3 w-3" /> Écart bloquant
      </Badge>
    );
  }
  return (
    <Badge variant="muted" data-testid="verdict-badge">
      Non rapproché
    </Badge>
  );
}

function Metric({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
      <p className="text-[10px] uppercase tracking-wide text-slate-muted">{label}</p>
      <p className={warn ? 'font-semibold text-state-error' : 'font-semibold text-slate-text'}>
        {value}
      </p>
    </div>
  );
}

function buildRows(invoice: InvoiceWithLines, summary: MatchSummary): DiffRow[] {
  return summary.details.map((d) => {
    const line = invoice.lines.find((l) => l.id === d.invoiceLineId);
    return {
      key: d.invoiceLineId,
      label: line ? `${d.invoiceLineNumber}. ${line.description}` : `Ligne ${d.invoiceLineNumber}`,
      ordered: {
        quantity: d.qtyOrdered,
        unitPrice: d.priceOrdered,
        total: d.qtyOrdered * d.priceOrdered,
      },
      received: {
        quantity: d.qtyReceived,
      },
      invoiced: {
        quantity: d.qtyInvoiced,
        unitPrice: d.priceInvoiced,
        total: d.qtyInvoiced * d.priceInvoiced,
      },
      priceVariancePct: d.priceVariancePct,
      qtyVariancePct: d.qtyVariancePct,
      status: resultToStatus(d.result, d, summary),
      message: d.message,
    };
  });
}

function resultToStatus(
  result: MatchResult,
  d: InvoiceLineMatchDetail,
  summary: MatchSummary,
): DiffStatus {
  if (result === 'OK') return 'ok';
  if (result === 'UNMATCHED_INVOICE_LINE') return 'unmatched';
  // EXCEPTION_PRICE / EXCEPTION_QTY : déterminer toléré vs bloquant
  // selon la variance effective vs tolérance
  if (result === 'EXCEPTION_PRICE') {
    return d.priceVariancePct > summary.priceTolerancePct ? 'error' : 'warn';
  }
  if (result === 'EXCEPTION_QTY') {
    return d.qtyVariancePct > summary.qtyTolerancePct ? 'error' : 'warn';
  }
  return 'unmatched';
}

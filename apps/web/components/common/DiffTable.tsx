'use client';

import { AmountDisplay } from '@/components/common/AmountDisplay';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

export type DiffStatus = 'ok' | 'warn' | 'error' | 'unmatched';

export interface DiffRow {
  /** Identifiant logique (ex: numéro de ligne facture). */
  key: string;
  label: string;
  /** Valeur BC commandée. */
  ordered?: { quantity?: number; unitPrice?: number; total?: number };
  /** Valeur reçue (GR). */
  received?: { quantity?: number; total?: number };
  /** Valeur facturée. */
  invoiced?: { quantity?: number; unitPrice?: number; total?: number };
  /** Variance prix (%) du serveur. */
  priceVariancePct?: number;
  /** Variance quantité (%) du serveur. */
  qtyVariancePct?: number;
  status: DiffStatus;
  /** Message serveur (optionnel). */
  message?: string;
}

export interface DiffTableProps {
  rows: DiffRow[];
  currency?: string;
  /** Tolérance prix (%) renvoyée par le serveur — affichée en tête. */
  priceTolerancePct?: number;
  /** Tolérance qty (%) renvoyée par le serveur — affichée en tête. */
  qtyTolerancePct?: number;
}

/**
 * Comparatif 3-voies BC / Réception / Facture. Une ligne = une ligne
 * de facture (mappée sur poLineId). Met en évidence les écarts via
 * couleur + badge statut. Les tolérances proviennent du serveur
 * (`match_summary.priceTolerancePct` / `qtyTolerancePct`), pas de la
 * config UI — affichées en bandeau pour info.
 */
export function DiffTable({
  rows,
  currency = 'XOF',
  priceTolerancePct,
  qtyTolerancePct,
}: DiffTableProps) {
  return (
    <div data-testid="diff-table" className="rounded-md border border-slate-200 bg-white">
      {(priceTolerancePct !== undefined || qtyTolerancePct !== undefined) && (
        <div className="flex items-center gap-3 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-muted">
          <span className="font-medium uppercase tracking-wide">Tolérances serveur</span>
          {priceTolerancePct !== undefined && (
            <span>
              Prix : <b>±{priceTolerancePct}%</b>
            </span>
          )}
          {qtyTolerancePct !== undefined && (
            <span>
              Qté : <b>±{qtyTolerancePct}%</b>
            </span>
          )}
        </div>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-1/4">Ligne</TableHead>
            <TableHead className="text-right">BC commandé</TableHead>
            <TableHead className="text-right">Réception</TableHead>
            <TableHead className="text-right">Facture</TableHead>
            <TableHead className="text-right">Écart</TableHead>
            <TableHead>Statut</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="py-6 text-center text-sm text-slate-muted">
                Aucune ligne à rapprocher.
              </TableCell>
            </TableRow>
          ) : (
            rows.map((r) => <DiffRowView key={r.key} row={r} currency={currency} />)
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function DiffRowView({ row, currency }: { row: DiffRow; currency: string }) {
  const variantClass = bucketClass(row.status);
  return (
    <TableRow data-testid={`diff-row-${row.key}`} data-status={row.status}>
      <TableCell className="align-top">
        <div className="font-medium text-slate-text">{row.label}</div>
        {row.message && <div className="text-xs text-slate-muted">{row.message}</div>}
      </TableCell>
      <TableCell className="text-right align-top">
        <TripleCell qty={row.ordered?.quantity} unitPrice={row.ordered?.unitPrice} total={row.ordered?.total} currency={currency} />
      </TableCell>
      <TableCell className="text-right align-top">
        <TripleCell qty={row.received?.quantity} total={row.received?.total} currency={currency} />
      </TableCell>
      <TableCell className="text-right align-top">
        <TripleCell qty={row.invoiced?.quantity} unitPrice={row.invoiced?.unitPrice} total={row.invoiced?.total} currency={currency} />
      </TableCell>
      <TableCell className={cn('text-right align-top text-xs font-medium', variantClass)}>
        {row.priceVariancePct !== undefined && (
          <div data-testid={`diff-row-${row.key}-price`}>
            Prix : {formatPct(row.priceVariancePct)}
          </div>
        )}
        {row.qtyVariancePct !== undefined && (
          <div data-testid={`diff-row-${row.key}-qty`}>
            Qté : {formatPct(row.qtyVariancePct)}
          </div>
        )}
      </TableCell>
      <TableCell className="align-top">
        <StatusBadge status={row.status} />
      </TableCell>
    </TableRow>
  );
}

function TripleCell({
  qty,
  unitPrice,
  total,
  currency,
}: {
  qty?: number;
  unitPrice?: number;
  total?: number;
  currency: string;
}) {
  if (qty === undefined && unitPrice === undefined && total === undefined) {
    return <span className="text-slate-muted">—</span>;
  }
  return (
    <div className="space-y-0.5 text-xs">
      {qty !== undefined && (
        <div>
          <span className="text-slate-muted">Qté :</span>{' '}
          {new Intl.NumberFormat('fr-FR').format(qty)}
        </div>
      )}
      {unitPrice !== undefined && (
        <div>
          <span className="text-slate-muted">PU :</span>{' '}
          <AmountDisplay amount={unitPrice} currency={currency} decimals={2} />
        </div>
      )}
      {total !== undefined && (
        <div className="font-medium">
          <AmountDisplay amount={total} currency={currency} />
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: DiffStatus }) {
  if (status === 'ok') return <Badge variant="success">Conforme</Badge>;
  if (status === 'warn') return <Badge variant="warning">Toléré</Badge>;
  if (status === 'error') return <Badge variant="error">Bloquant</Badge>;
  return <Badge variant="muted">Non rapproché</Badge>;
}

function bucketClass(s: DiffStatus): string {
  if (s === 'ok') return 'text-state-success';
  if (s === 'warn') return 'text-state-warning';
  if (s === 'error') return 'text-state-error';
  return 'text-slate-muted';
}

function formatPct(pct: number): string {
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

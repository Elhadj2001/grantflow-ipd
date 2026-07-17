'use client';

import { Check, X } from 'lucide-react';
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

export interface JournalEntryLine {
  id?: string;
  accountCode: string;
  label?: string | null;
  /** Montants XOF (tenue fonctionnelle SYSCEBNL — ADR-005/I2). */
  debit: number | string;
  credit: number | string;
  /** Devise TRANSACTIONNELLE d'origine (XOF si opération locale). */
  currency?: string;
  /** Montants BRUTS en devise d'origine (colonnes debit/credit_currency). */
  debitCurrency?: number | string | null;
  creditCurrency?: number | string | null;
  /** Taux de conversion figé à l'écriture (fx_rate). */
  fxRate?: number | string | null;
  /** Imputation analytique optionnelle. */
  projectId?: string | null;
  grantId?: string | null;
  budgetLineId?: string | null;
}

export interface JournalEntry {
  id: string;
  entryNumber: string;
  /** Journal SYSCEBNL (AC, OD, BQ, …). */
  journal: string;
  entryDate: string;
  label?: string | null;
  status?: 'draft' | 'posted' | 'reversed';
  lines: JournalEntryLine[];
  sourceType?: string | null;
}

export interface JournalEntryTableProps {
  entry: JournalEntry;
  className?: string;
}

/**
 * Affichage lecture seule d'une écriture comptable SYSCEBNL :
 * lignes débit/crédit avec totaux + check d'équilibre. Le trigger
 * `gl.check_entry_balance` côté Postgres garantit débit = crédit
 * pour tout entry validé ; on affiche un badge "Équilibré" si OK,
 * "DÉSÉQUILIBRÉ" sinon (cas théorique d'un brouillon ou bug serveur).
 *
 * HOTFIX devise (audit v2, journal FAC-SIM-BC-2026-0005-1) : les colonnes
 * `debit`/`credit` de journal_line sont TOUJOURS en XOF (tenue
 * fonctionnelle, règle d'or n°4) — l'ancien rendu leur collait le label de
 * la devise TRANSACTIONNELLE (« 2 952 500,00 USD » pour un montant XOF).
 * Désormais : label XOF systématique + mention secondaire
 * « ≈ 5 000,00 USD @ 590,50 » quand la devise d'origine ≠ XOF (montants
 * bruts `debit/credit_currency` + `fx_rate` stockés sur la ligne).
 */
export function JournalEntryTable({ entry, className }: JournalEntryTableProps) {
  const totalDebit = entry.lines.reduce((s, l) => s + numeric(l.debit), 0);
  const totalCredit = entry.lines.reduce((s, l) => s + numeric(l.credit), 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.01;

  return (
    <div
      data-testid="journal-entry"
      data-balanced={balanced ? 'true' : 'false'}
      className={cn('rounded-md border border-slate-200 bg-white', className)}
    >
      <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div>
          <p className="font-mono text-sm text-slate-text">{entry.entryNumber}</p>
          <p className="text-xs text-slate-muted">
            Journal <b>{entry.journal}</b> · {entry.entryDate.slice(0, 10)}
            {entry.label && <> · {entry.label}</>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {entry.status && <StatusBadge status={entry.status} />}
          <BalanceBadge balanced={balanced} />
        </div>
      </header>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-24">Compte</TableHead>
            <TableHead>Libellé</TableHead>
            <TableHead className="text-right">Débit</TableHead>
            <TableHead className="text-right">Crédit</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entry.lines.map((l, i) => (
            <TableRow key={l.id ?? i} data-testid={`journal-line-${i}`}>
              <TableCell className="font-mono text-xs">{l.accountCode}</TableCell>
              <TableCell>{l.label ?? '—'}</TableCell>
              <TableCell className="text-right">
                <AmountCell amountXof={l.debit} line={l} txAmount={l.debitCurrency} />
              </TableCell>
              <TableCell className="text-right">
                <AmountCell amountXof={l.credit} line={l} txAmount={l.creditCurrency} />
              </TableCell>
            </TableRow>
          ))}
          <TableRow className="border-t-2 border-slate-300 bg-slate-50">
            <TableCell colSpan={2} className="text-xs font-medium uppercase tracking-wide text-slate-muted">
              Totaux
            </TableCell>
            <TableCell className="text-right" data-testid="journal-total-debit">
              <AmountDisplay amount={totalDebit} currency="XOF" className="font-semibold" />
            </TableCell>
            <TableCell className="text-right" data-testid="journal-total-credit">
              <AmountDisplay amount={totalCredit} currency="XOF" className="font-semibold" />
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}

function StatusBadge({ status }: { status: 'draft' | 'posted' | 'reversed' }) {
  if (status === 'posted') return <Badge variant="secondary">Comptabilisée</Badge>;
  if (status === 'reversed') return <Badge variant="muted">Extournée</Badge>;
  return <Badge variant="warning">Brouillon</Badge>;
}

function BalanceBadge({ balanced }: { balanced: boolean }) {
  return balanced ? (
    <Badge variant="success" data-testid="journal-balanced">
      <Check className="mr-1 h-3 w-3" /> Équilibré
    </Badge>
  ) : (
    <Badge variant="error" data-testid="journal-unbalanced">
      <X className="mr-1 h-3 w-3" /> DÉSÉQUILIBRÉ
    </Badge>
  );
}

/**
 * Cellule montant : XOF (tenue fonctionnelle) + mention secondaire de la
 * devise TRANSACTIONNELLE quand elle diffère (« ≈ 5 000,00 USD @ 590,50 »).
 */
function AmountCell({
  amountXof,
  line,
  txAmount,
}: {
  amountXof: number | string;
  line: JournalEntryLine;
  txAmount?: number | string | null;
}) {
  if (numeric(amountXof) <= 0) return <span className="text-slate-muted">—</span>;
  const isForeign =
    !!line.currency && line.currency !== 'XOF' && txAmount != null && numeric(txAmount) > 0;
  return (
    <div className="flex flex-col items-end">
      <AmountDisplay amount={amountXof} currency="XOF" />
      {isForeign && (
        <span className="text-xs text-slate-muted" data-testid="journal-tx-currency">
          ≈{' '}
          {numeric(txAmount as number | string).toLocaleString('fr-FR', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}{' '}
          {line.currency}
          {line.fxRate != null && numeric(line.fxRate) > 0 && (
            <> @ {numeric(line.fxRate).toLocaleString('fr-FR', { maximumFractionDigits: 4 })}</>
          )}
        </span>
      )}
    </div>
  );
}

function numeric(v: number | string): number {
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isFinite(n) ? n : 0;
}

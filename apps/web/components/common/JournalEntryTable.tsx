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
  debit: number | string;
  credit: number | string;
  /** Devise locale (XOF par défaut). */
  currency?: string;
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
  currency?: string;
  className?: string;
}

/**
 * Affichage lecture seule d'une écriture comptable SYSCEBNL :
 * lignes débit/crédit avec totaux + check d'équilibre. Le trigger
 * `gl.check_entry_balance` côté Postgres garantit débit = crédit
 * pour tout entry validé ; on affiche un badge "Équilibré" si OK,
 * "DÉSÉQUILIBRÉ" sinon (cas théorique d'un brouillon ou bug serveur).
 */
export function JournalEntryTable({ entry, currency = 'XOF', className }: JournalEntryTableProps) {
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
                {numeric(l.debit) > 0 ? (
                  <AmountDisplay amount={l.debit} currency={l.currency ?? currency} />
                ) : (
                  <span className="text-slate-muted">—</span>
                )}
              </TableCell>
              <TableCell className="text-right">
                {numeric(l.credit) > 0 ? (
                  <AmountDisplay amount={l.credit} currency={l.currency ?? currency} />
                ) : (
                  <span className="text-slate-muted">—</span>
                )}
              </TableCell>
            </TableRow>
          ))}
          <TableRow className="border-t-2 border-slate-300 bg-slate-50">
            <TableCell colSpan={2} className="text-xs font-medium uppercase tracking-wide text-slate-muted">
              Totaux
            </TableCell>
            <TableCell className="text-right" data-testid="journal-total-debit">
              <AmountDisplay amount={totalDebit} currency={currency} className="font-semibold" />
            </TableCell>
            <TableCell className="text-right" data-testid="journal-total-credit">
              <AmountDisplay amount={totalCredit} currency={currency} className="font-semibold" />
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

function numeric(v: number | string): number {
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isFinite(n) ? n : 0;
}

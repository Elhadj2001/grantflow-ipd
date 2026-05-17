'use client';

import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, ScrollText, RotateCcw } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import {
  JournalEntryTable,
  type JournalEntry as DisplayJournalEntry,
} from '@/components/common/JournalEntryTable';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useInvoice, useInvoiceJournalEntries } from '@/hooks/use-invoicing';
import { usePermissions } from '@/hooks/use-permissions';
import type { JournalEntry } from '@/lib/api/invoicing';

/**
 * Page de consultation des écritures comptables liées à une facture.
 *
 * Affiche :
 *  - L'écriture AC principale (débit 6xx + débit 445 TVA / crédit 401)
 *  - Les extournes classe 8 (OD) qui défont l'engagement du BC pour la
 *    fraction facturée
 *
 * Source : GET /invoices/:id/journal-entries (sprint 4.2b backend).
 */
export default function InvoiceJournalPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id ?? '';
  const permissions = usePermissions();
  const inv = useInvoice(id);
  const journals = useInvoiceJournalEntries(id);

  if (permissions.roles.length > 0 && !permissions.canViewJournalEntry()) {
    router.replace(`/accounting/invoices/${id}`);
    return null;
  }

  const loading = inv.isLoading || journals.isLoading;

  return (
    <>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            <ScrollText className="h-5 w-5 text-ipd-darker" />
            Écritures comptables
            {inv.data && (
              <span className="font-mono text-sm text-slate-muted">
                · {inv.data.invoiceNumber}
              </span>
            )}
          </span>
        }
        subtitle="AC (Achats) + extournes classe 8 SYSCEBNL"
        actions={
          <Button
            variant="outline"
            onClick={() => router.push(`/accounting/invoices/${id}`)}
          >
            <ArrowLeft className="mr-2 h-4 w-4" /> Retour à la facture
          </Button>
        }
      />

      <div className="space-y-6 p-8">
        {loading && (
          <>
            <Skeleton className="h-64 w-full" />
            <Skeleton className="h-48 w-full" />
          </>
        )}

        {!loading && journals.data && journals.data.acEntries.length === 0 && (
          <div className="rounded-md border border-dashed border-slate-200 bg-cream p-6 text-center text-sm text-slate-muted">
            Aucune écriture comptable enregistrée pour cette facture.
            <br />
            La comptabilisation doit être lancée depuis le détail facture (statut
            <code className="mx-1">matched</code>).
          </div>
        )}

        {!loading && journals.data && (
          <>
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-muted">
                Écritures Achats (AC)
              </h2>
              {journals.data.acEntries.map((entry) => (
                <JournalEntryTable
                  key={entry.id}
                  entry={toDisplayEntry(entry)}
                  currency={inv.data?.currency ?? 'XOF'}
                />
              ))}
            </section>

            {journals.data.class8Reversals.length > 0 && (
              <section className="space-y-3">
                <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-muted">
                  <RotateCcw className="h-3.5 w-3.5" />
                  Extournes classe 8 (Engagements)
                </h2>
                <p className="text-xs text-slate-muted">
                  Réduction des engagements 801/802 du BC pour la fraction facturée.
                </p>
                {journals.data.class8Reversals.map((entry) => (
                  <JournalEntryTable
                    key={entry.id}
                    entry={toDisplayEntry(entry)}
                    currency={inv.data?.currency ?? 'XOF'}
                  />
                ))}
              </section>
            )}
          </>
        )}
      </div>
    </>
  );
}

/** Adapte le shape API au shape attendu par JournalEntryTable. */
function toDisplayEntry(e: JournalEntry): DisplayJournalEntry {
  return {
    id: e.id,
    entryNumber: e.entryNumber,
    journal: e.journal,
    entryDate: e.entryDate,
    label: e.label,
    status: e.status,
    sourceType: e.sourceType,
    lines: e.lines.map((l) => ({
      id: l.id,
      accountCode: l.accountCode,
      label: l.label,
      debit: l.debit,
      credit: l.credit,
      currency: l.currency,
      projectId: l.projectId,
      grantId: l.grantId,
      budgetLineId: l.budgetLineId,
    })),
  };
}

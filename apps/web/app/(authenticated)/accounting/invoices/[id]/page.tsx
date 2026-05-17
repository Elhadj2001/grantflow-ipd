'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  ArrowLeft,
  AlertTriangle,
  CheckCircle2,
  Pencil,
  Save,
  Send,
  XCircle,
  ScrollText,
  Receipt,
  Image as ImageIcon,
} from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { StatusBadge } from '@/components/common/StatusBadge';
import { AmountDisplay } from '@/components/common/AmountDisplay';
import { DateDisplay } from '@/components/common/DateDisplay';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { PdfFrame } from '@/components/common/PdfFrame';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  useInvoice,
  useRejectInvoice,
  useSubmitInvoice,
  useUpdateInvoice,
} from '@/hooks/use-invoicing';
import { usePermissions } from '@/hooks/use-permissions';
import type { InvoiceStatus, OcrResult } from '@/lib/api/invoicing';

const LOW_CONFIDENCE_PCT = 80;

const EditSchema = z.object({
  invoiceNumber: z.string().min(1, 'Requis').max(64),
  invoiceDate: z.string().min(1, 'Requis'),
  dueDate: z.string().min(1, 'Requis'),
  totalHt: z.coerce.number().nonnegative(),
  totalVat: z.coerce.number().nonnegative(),
  totalTtc: z.coerce.number().positive(),
});
type EditValues = z.infer<typeof EditSchema>;

const EDITABLE_STATUSES: InvoiceStatus[] = ['captured', 'exception_price', 'exception_qty'];
const SUBMITTABLE_STATUSES: InvoiceStatus[] = ['captured'];
const REJECTABLE_STATUSES: InvoiceStatus[] = [
  'captured',
  'matched',
  'exception_price',
  'exception_qty',
];

type DialogKind = 'reject' | null;

export default function InvoiceDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id ?? '';
  const permissions = usePermissions();
  const inv = useInvoice(id);
  const updateM = useUpdateInvoice(id);
  const submitM = useSubmitInvoice(id);
  const rejectM = useRejectInvoice(id);
  const [editing, setEditing] = React.useState(false);
  const [dialog, setDialog] = React.useState<DialogKind>(null);

  const form = useForm<EditValues>({
    resolver: zodResolver(EditSchema),
    values: inv.data
      ? {
          invoiceNumber: inv.data.invoiceNumber,
          invoiceDate: inv.data.invoiceDate.slice(0, 10),
          dueDate: inv.data.dueDate.slice(0, 10),
          totalHt: Number(inv.data.totalHt),
          totalVat: Number(inv.data.totalVat),
          totalTtc: Number(inv.data.totalTtc),
        }
      : undefined,
  });

  if (inv.isLoading || !inv.data) {
    return (
      <>
        <PageHeader title="Facture" subtitle="Chargement…" />
        <div className="space-y-4 p-8">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </>
    );
  }

  const data = inv.data;
  const isEditable = EDITABLE_STATUSES.includes(data.status);
  const canEdit = isEditable && permissions.canMatchInvoice();
  const canSubmit = SUBMITTABLE_STATUSES.includes(data.status) && permissions.canMatchInvoice();
  const canReject = REJECTABLE_STATUSES.includes(data.status) && permissions.canRejectInvoice();
  const ocrPayload = (data.capturedPayload?.ocr ?? null) as OcrResult | null;
  const lowConfidence = ocrPayload && ocrPayload.confidence < LOW_CONFIDENCE_PCT;

  const submitEdit = form.handleSubmit(async (values) => {
    await updateM.mutateAsync({
      invoiceNumber: values.invoiceNumber,
      invoiceDate: values.invoiceDate,
      dueDate: values.dueDate,
      totalHt: values.totalHt,
      totalVat: values.totalVat,
      totalTtc: values.totalTtc,
    });
    setEditing(false);
  });

  return (
    <>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            <Receipt className="h-5 w-5 text-ipd-darker" />
            <span className="font-mono text-base text-slate-text">{data.invoiceNumber}</span>
            <StatusBadge status={data.status} />
          </span>
        }
        subtitle={`Facture du ${data.invoiceDate.slice(0, 10)} · échéance ${data.dueDate.slice(0, 10)}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push('/accounting/invoices')}
            >
              <ArrowLeft className="mr-2 h-4 w-4" /> Retour
            </Button>
            {canEdit && !editing && (
              <Button variant="outline" size="sm" onClick={() => setEditing(true)} data-testid="invoice-edit">
                <Pencil className="mr-2 h-4 w-4" /> Corriger
              </Button>
            )}
            {canSubmit && (
              <Button
                size="sm"
                onClick={() => submitM.mutate()}
                disabled={submitM.isPending}
                data-testid="invoice-submit"
              >
                <Send className="mr-2 h-4 w-4" /> {submitM.isPending ? 'Matching…' : 'Soumettre au matching'}
              </Button>
            )}
            {data.status === 'matched' && permissions.canPostInvoice() && (
              <Button
                size="sm"
                onClick={() =>
                  router.push(`/accounting/invoices/${data.id}#post`)
                }
                data-testid="invoice-post-cta"
              >
                <CheckCircle2 className="mr-2 h-4 w-4" /> Comptabiliser…
              </Button>
            )}
            {data.status === 'posted' && permissions.canViewJournalEntry() && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push(`/accounting/invoices/${data.id}/journal`)}
                data-testid="invoice-journal-cta"
              >
                <ScrollText className="mr-2 h-4 w-4" /> Écriture comptable
              </Button>
            )}
            {canReject && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setDialog('reject')}
                data-testid="invoice-reject"
              >
                <XCircle className="mr-2 h-4 w-4" /> Rejeter
              </Button>
            )}
          </div>
        }
      />

      {lowConfidence && (
        <div className="mx-8 mt-6 flex items-start gap-2 rounded-md border border-state-warning/40 bg-state-warning/10 px-3 py-2 text-sm text-state-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <b>Confiance OCR faible ({Math.round(ocrPayload!.confidence)}%).</b> Vérifiez et
            corrigez les champs ci-dessous avant de soumettre au matching.
          </div>
        </div>
      )}
      {ocrPayload?.isImageScan && (
        <div className="mx-8 mt-6 flex items-start gap-2 rounded-md border border-state-error/40 bg-state-error/10 px-3 py-2 text-sm text-state-error">
          <ImageIcon className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <b>PDF scanné détecté.</b> L'OCR n'a pas pu extraire les champs automatiquement —
            ressaisissez-les manuellement (icône Corriger).
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 p-8 lg:grid-cols-3">
        {/* Colonne principale */}
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Informations facture</CardTitle>
            </CardHeader>
            <CardContent>
              {editing ? (
                <form onSubmit={submitEdit} className="grid grid-cols-1 gap-4 md:grid-cols-2" data-testid="invoice-edit-form">
                  <div>
                    <Label htmlFor="invoiceNumber">N° facture</Label>
                    <Input id="invoiceNumber" {...form.register('invoiceNumber')} />
                  </div>
                  <div>
                    <Label htmlFor="invoiceDate">Date facture</Label>
                    <Input id="invoiceDate" type="date" {...form.register('invoiceDate')} />
                  </div>
                  <div>
                    <Label htmlFor="dueDate">Échéance</Label>
                    <Input id="dueDate" type="date" {...form.register('dueDate')} />
                  </div>
                  <div>
                    <Label htmlFor="totalHt">Total HT</Label>
                    <Input id="totalHt" type="number" step="0.01" {...form.register('totalHt')} />
                  </div>
                  <div>
                    <Label htmlFor="totalVat">Total TVA</Label>
                    <Input id="totalVat" type="number" step="0.01" {...form.register('totalVat')} />
                  </div>
                  <div>
                    <Label htmlFor="totalTtc">Total TTC</Label>
                    <Input id="totalTtc" type="number" step="0.01" {...form.register('totalTtc')} />
                  </div>
                  <div className="md:col-span-2 flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={() => setEditing(false)}>
                      Annuler
                    </Button>
                    <Button type="submit" disabled={updateM.isPending} data-testid="invoice-edit-save">
                      <Save className="mr-2 h-4 w-4" />
                      {updateM.isPending ? 'Sauvegarde…' : 'Enregistrer'}
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="grid grid-cols-2 gap-y-3 text-sm md:grid-cols-3">
                  <Field label="Fournisseur" value={<span className="font-mono text-xs">{data.supplierId}</span>} />
                  <Field label="BC lié" value={data.poId ? <span className="font-mono text-xs">{data.poId}</span> : '—'} />
                  <Field label="Devise" value={data.currency} />
                  <Field label="Total HT" value={<AmountDisplay amount={data.totalHt} currency={data.currency} />} />
                  <Field label="TVA" value={<AmountDisplay amount={data.totalVat} currency={data.currency} />} />
                  <Field
                    label="Total TTC"
                    value={
                      <AmountDisplay
                        amount={data.totalTtc}
                        currency={data.currency}
                        className="text-base font-semibold"
                      />
                    }
                  />
                  <Field
                    label="Date facture"
                    value={<DateDisplay value={data.invoiceDate} format="short" />}
                  />
                  <Field
                    label="Échéance"
                    value={<DateDisplay value={data.dueDate} format="short" />}
                  />
                  {data.exchangeRate && (
                    <Field
                      label="Taux de change"
                      value={<span className="font-mono">{data.exchangeRate}</span>}
                    />
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Lignes ({data.lines.length})</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Qté</TableHead>
                    <TableHead className="text-right">PU</TableHead>
                    <TableHead className="text-right">Total ligne</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.lines.map((l) => (
                    <TableRow key={l.id} data-testid={`invoice-line-${l.lineNumber}`}>
                      <TableCell className="text-slate-muted">{l.lineNumber}</TableCell>
                      <TableCell>{l.description}</TableCell>
                      <TableCell className="text-right">
                        {l.quantity !== null
                          ? new Intl.NumberFormat('fr-FR').format(Number(l.quantity))
                          : '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        {l.unitPrice !== null ? (
                          <AmountDisplay
                            amount={l.unitPrice}
                            currency={data.currency}
                            decimals={2}
                          />
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <AmountDisplay amount={l.lineTotal} currency={data.currency} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        {/* Aside : OCR + PDF */}
        <aside className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Aperçu PDF</CardTitle>
            </CardHeader>
            <CardContent className="p-3">
              <PdfFrame
                path={`/invoices/${data.id}/pdf`}
                height={500}
                filename={`${data.invoiceNumber}.pdf`}
              />
            </CardContent>
          </Card>

          {ocrPayload && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-sm">
                  <span>OCR</span>
                  <span className="font-mono text-xs text-slate-muted">
                    {Math.round(ocrPayload.confidence)}%
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                {Object.entries(ocrPayload.fieldConfidence ?? {}).map(([k, v]) => (
                  <FieldConfidence key={k} field={k} confidence={v} />
                ))}
              </CardContent>
            </Card>
          )}
        </aside>
      </div>

      <ConfirmDialog
        open={dialog === 'reject'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Rejeter cette facture"
        description="Le motif sera tracé dans l'audit log (min 5 caractères)."
        destructive
        requireReason
        reasonLabel="Motif du rejet"
        confirmLabel="Rejeter"
        loading={rejectM.isPending}
        onConfirm={async (reason) => {
          await rejectM.mutateAsync(reason ?? '');
          setDialog(null);
        }}
      />
    </>
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

function FieldConfidence({ field, confidence }: { field: string; confidence: number }) {
  const pct = Math.round(confidence);
  const colorClass =
    pct >= 90
      ? 'text-state-success'
      : pct >= 70
        ? 'text-state-warning'
        : 'text-state-error';
  return (
    <div data-testid={`ocr-field-${field}`} className="flex justify-between">
      <span className="text-slate-muted">{field}</span>
      <span className={`font-mono ${colorClass}`}>{pct}%</span>
    </div>
  );
}

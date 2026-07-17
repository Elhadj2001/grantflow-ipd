'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { ArrowLeft, CheckCircle2, Download, FileText, PackageCheck, Send, XCircle, Zap } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { StatusBadge } from '@/components/common/StatusBadge';
import { AmountDisplay } from '@/components/common/AmountDisplay';
import { DateDisplay } from '@/components/common/DateDisplay';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  useAcknowledgePO,
  useCancelPO,
  usePO,
  useSendPO,
} from '@/hooks/use-procurement';
import { DocumentsPanel } from '@/components/common/DocumentsPanel';
import { usePoDocuments } from '@/hooks/use-documents';
import { usePermissions } from '@/hooks/use-permissions';
import { useFeatures } from '@/hooks/use-features';
import { simulateInvoiceDownload, simulateInvoiceInject } from '@/lib/api/procurement';
import { toast } from '@/hooks/use-toast';

type DialogKind = 'send' | 'acknowledge' | 'cancel' | 'simulate' | null;

export default function PurchaseOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id ?? '';
  const permissions = usePermissions();
  const { features } = useFeatures();
  const { data: session } = useSession();
  const po = usePO(id);
  // US-069 : documents archivés du BC.
  const documents = usePoDocuments(id);

  const sendM = useSendPO(id);
  const ackM = useAcknowledgePO(id);
  const cancelM = useCancelPO(id);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [simBusy, setSimBusy] = useState<'download' | 'inject' | null>(null);

  if (po.isLoading || !po.data) {
    return (
      <>
        <PageHeader title="Bon de commande" subtitle="Chargement…" />
        <div className="p-8 space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </>
    );
  }
  const data = po.data;
  const canSend = data.status === 'draft' && permissions.canManagePO();
  const canAck = data.status === 'sent' && permissions.canManagePO();
  const canReceive = data.status !== 'cancelled' && permissions.canReceive();
  const canCancel = ['draft', 'sent'].includes(data.status) && permissions.canManagePO();
  // Sprint F-INVOICE-SIM : bouton visible seulement si BC sent + rôle
  // autorisé + flag serveur actif.
  const canSimulate =
    data.status === 'sent' &&
    permissions.canSimulateInvoice() &&
    features.demoInvoiceSimulator;

  async function handleSimulateDownload() {
    setSimBusy('download');
    try {
      const { blob, filename } = await simulateInvoiceDownload(id, {
        accessToken: session?.accessToken ?? null,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({
        variant: 'success',
        title: 'Facture simulée téléchargée',
        description: 'Re-uploadez-la via Comptabilité › Factures pour déclencher l\'OCR.',
      });
      setDialog(null);
    } catch {
      toast({ variant: 'destructive', title: 'Échec de la génération de la facture simulée' });
    } finally {
      setSimBusy(null);
    }
  }

  async function handleSimulateInject() {
    setSimBusy('inject');
    try {
      const res = await simulateInvoiceInject(id, {
        accessToken: session?.accessToken ?? null,
      });
      toast({
        variant: 'success',
        title: 'Facture injectée (statut Capturée)',
        description: `Facture ${res.invoiceNumber} créée.`,
      });
      setDialog(null);
      router.push(`/accounting/invoices/${res.invoiceId}`);
    } catch {
      toast({ variant: 'destructive', title: 'Échec de l\'injection de la facture simulée' });
    } finally {
      setSimBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            <span className="font-mono text-base text-slate-muted">{data.poNumber}</span>
            <StatusBadge status={data.status} />
          </span>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push('/procurement/purchase-orders')}
            >
              <ArrowLeft className="mr-2 h-4 w-4" /> Retour
            </Button>
            {canSend && (
              <Button size="sm" onClick={() => setDialog('send')} data-testid="action-send">
                <Send className="mr-2 h-4 w-4" /> Envoyer au fournisseur
              </Button>
            )}
            {canAck && (
              <Button size="sm" onClick={() => setDialog('acknowledge')}>
                <CheckCircle2 className="mr-2 h-4 w-4" /> Confirmer réception fournisseur
              </Button>
            )}
            {canReceive && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push(`/procurement/goods-receipts/new?fromPO=${id}`)}
              >
                <PackageCheck className="mr-2 h-4 w-4" /> Nouvelle réception
              </Button>
            )}
            {canSimulate && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDialog('simulate')}
                data-testid="action-simulate-invoice"
              >
                <FileText className="mr-2 h-4 w-4" /> Simuler la facture fournisseur (démo)
              </Button>
            )}
            {canCancel && (
              <Button variant="destructive" size="sm" onClick={() => setDialog('cancel')}>
                <XCircle className="mr-2 h-4 w-4" /> Annuler
              </Button>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-6 p-8 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Lignes</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Qté</TableHead>
                    <TableHead className="text-right">Prix unit.</TableHead>
                    <TableHead className="text-right">Total ligne</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.lines.map((l) => (
                    <TableRow key={l.id ?? l.lineNumber}>
                      <TableCell className="text-slate-muted">{l.lineNumber ?? '—'}</TableCell>
                      <TableCell>{l.description}</TableCell>
                      <TableCell className="text-right">
                        {Number(l.quantity).toLocaleString('fr-FR')} {l.unit ?? ''}
                      </TableCell>
                      <TableCell className="text-right">
                        <AmountDisplay amount={l.unitPrice} currency={data.currency} decimals={2} />
                      </TableCell>
                      <TableCell className="text-right">
                        <AmountDisplay amount={l.lineTotal ?? Number(l.quantity) * Number(l.unitPrice)} currency={data.currency} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="grid grid-cols-3 gap-4 border-t border-slate-200 px-4 py-3 text-right">
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-muted">Total HT</p>
                  <AmountDisplay amount={data.totalHt} currency={data.currency} amountXof={data.total_ht_xof} />
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-muted">TVA</p>
                  <AmountDisplay amount={data.totalVat} currency={data.currency} amountXof={data.total_vat_xof} />
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-muted">Total TTC</p>
                  <AmountDisplay amount={data.totalTtc} currency={data.currency} amountXof={data.total_ttc_xof} className="font-semibold" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Informations</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label="Fournisseur" value={<span className="font-mono text-xs">{data.supplierId}</span>} />
              <Row label="Devise" value={data.currency} />
              <Row label="Date BC" value={<DateDisplay value={data.orderDate} format="short" />} />
              <Row label="Livraison prévue" value={<DateDisplay value={data.expectedDate} format="short" />} />
              {data.prId && (
                <Row
                  label="DA source"
                  value={
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-ipd-darker"
                      onClick={() => router.push(`/procurement/purchase-requests/${data.prId}`)}
                    >
                      Voir DA
                    </Button>
                  }
                />
              )}
            </CardContent>
          </Card>

          {/* US-069 : documents du BC (PDF généré au send). */}
          <DocumentsPanel
            documents={documents.data}
            isLoading={documents.isLoading}
            isError={documents.isError}
            inlinePreview={false}
            emptyMessage="Aucun document — le PDF du BC est généré à l'envoi au fournisseur."
          />
        </div>
      </div>

      <ConfirmDialog
        open={dialog === 'send'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Envoyer le BC au fournisseur"
        description="Le BC sera émis : génération PDF, écriture comptable d'engagement (classe 8) et envoi par e-mail si le fournisseur a une adresse de contact (best-effort — l'engagement reste créé même si l'e-mail échoue)."
        confirmLabel="Envoyer"
        loading={sendM.isPending}
        onConfirm={async () => {
          await sendM.mutateAsync();
          setDialog(null);
        }}
      />
      <ConfirmDialog
        open={dialog === 'acknowledge'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Confirmer la prise en compte par le fournisseur"
        description="Saisissez la référence de l'accusé fournisseur (e-mail, n° d'AR…). Le BC passera en acknowledged."
        // US-075 (F-S8-21) : ackRef OBLIGATOIRE — le DTO l'exige, l'ancien
        // appel sans corps était un 400 systématique.
        requireReason
        reasonLabel="Référence de l'accusé fournisseur"
        confirmLabel="Confirmer"
        loading={ackM.isPending}
        onConfirm={async (ackRef) => {
          await ackM.mutateAsync(ackRef ?? '');
          setDialog(null);
        }}
      />
      <ConfirmDialog
        open={dialog === 'cancel'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Annuler ce BC"
        description="L'engagement comptable classe 8 sera extourné si la BC est déjà postée."
        destructive
        requireReason
        reasonLabel="Motif d'annulation"
        confirmLabel="Annuler le BC"
        loading={cancelM.isPending}
        onConfirm={async (reason) => {
          await cancelM.mutateAsync(reason ?? '');
          setDialog(null);
        }}
      />

      {/* Sprint F-INVOICE-SIM — dialog simulateur (2 modes) */}
      <Dialog open={dialog === 'simulate'} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent data-testid="simulate-invoice-dialog">
          <DialogHeader>
            <DialogTitle>Simuler la facture fournisseur</DialogTitle>
            <DialogDescription>
              Génère une facture fournisseur cohérente avec ce BC (TVA 18 %,
              référence BC pré-remplie). Choisissez le mode.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-md border border-state-warning/30 bg-state-warning/5 px-3 py-2 text-xs text-state-warning">
            Mode démo — désactivé en production.
          </div>

          <div className="space-y-3 pt-2">
            <Button
              variant="outline"
              className="w-full justify-start"
              disabled={simBusy !== null}
              onClick={handleSimulateDownload}
              data-testid="simulate-mode-download"
            >
              <Download className="mr-2 h-4 w-4" />
              {simBusy === 'download' ? 'Génération…' : '📥 Télécharger la facture simulée'}
            </Button>
            <p className="px-1 text-xs text-slate-muted">
              Re-uploadez le PDF via Comptabilité › Factures pour déclencher l&apos;OCR Vision (démo jury).
            </p>

            <Button
              className="w-full justify-start"
              disabled={simBusy !== null}
              onClick={handleSimulateInject}
              data-testid="simulate-mode-inject"
            >
              <Zap className="mr-2 h-4 w-4" />
              {simBusy === 'inject' ? 'Injection…' : '⚡ Injecter directement (statut Capturée)'}
            </Button>
            <p className="px-1 text-xs text-slate-muted">
              Crée immédiatement la facture en statut « Capturée » (skip OCR, parcours rapide).
            </p>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialog(null)} disabled={simBusy !== null}>
              Fermer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-xs uppercase tracking-wide text-slate-muted">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, CheckCircle2, PackageCheck, Send, XCircle } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { StatusBadge } from '@/components/common/StatusBadge';
import { AmountDisplay } from '@/components/common/AmountDisplay';
import { DateDisplay } from '@/components/common/DateDisplay';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
  useAcknowledgePO,
  useCancelPO,
  usePO,
  useSendPO,
} from '@/hooks/use-procurement';
import { usePermissions } from '@/hooks/use-permissions';

type DialogKind = 'send' | 'acknowledge' | 'cancel' | null;

export default function PurchaseOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id ?? '';
  const permissions = usePermissions();
  const po = usePO(id);

  const sendM = useSendPO(id);
  const ackM = useAcknowledgePO(id);
  const cancelM = useCancelPO(id);
  const [dialog, setDialog] = useState<DialogKind>(null);

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
                  <AmountDisplay amount={data.totalHt} currency={data.currency} />
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-muted">TVA</p>
                  <AmountDisplay amount={data.totalVat} currency={data.currency} />
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-muted">Total TTC</p>
                  <AmountDisplay amount={data.totalTtc} currency={data.currency} className="font-semibold" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

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
        description="Marque le BC comme acknowledged — utile pour le suivi opérationnel."
        confirmLabel="Confirmer"
        loading={ackM.isPending}
        onConfirm={async () => {
          await ackM.mutateAsync(undefined);
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

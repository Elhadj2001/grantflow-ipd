'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, CheckCircle2, Trash2, XCircle } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { StatusBadge } from '@/components/common/StatusBadge';
import { DateDisplay } from '@/components/common/DateDisplay';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  useCancelGR,
  useCompleteGR,
  useGR,
  useRejectGR,
  useUpdateGrLine,
} from '@/hooks/use-procurement';
import { usePermissions } from '@/hooks/use-permissions';

type DialogKind = 'complete' | 'cancel' | 'reject' | null;

export default function GoodsReceiptDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id ?? '';
  const permissions = usePermissions();
  const gr = useGR(id);
  const completeM = useCompleteGR(id);
  const cancelM = useCancelGR(id);
  const rejectM = useRejectGR(id);
  const updateLineM = useUpdateGrLine(id);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [editing, setEditing] = useState<Record<string, { quantity: string; batchNumber: string; expiryDate: string }>>({});

  if (gr.isLoading || !gr.data) {
    return (
      <>
        <PageHeader title="Réception" subtitle="Chargement…" />
        <div className="p-8 space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </>
    );
  }

  const data = gr.data;
  const editable = data.status === 'draft' || data.status === 'partial';
  const canEdit = editable && permissions.canReceive();
  const canComplete = canEdit && data.lines.some((l) => Number(l.quantity) > 0);
  const canCancel = data.status === 'draft' && permissions.canReceive();
  const canReject = data.status === 'draft' && permissions.canReceive();

  const setLineField = (lineId: string, field: 'quantity' | 'batchNumber' | 'expiryDate', value: string) => {
    setEditing((prev) => ({
      ...prev,
      [lineId]: {
        quantity: prev[lineId]?.quantity ?? '',
        batchNumber: prev[lineId]?.batchNumber ?? '',
        expiryDate: prev[lineId]?.expiryDate ?? '',
        [field]: value,
      },
    }));
  };

  const saveLine = async (lineId: string, initialQty: number | string) => {
    const e = editing[lineId];
    const quantity = e?.quantity !== undefined && e.quantity !== '' ? Number(e.quantity) : Number(initialQty);
    if (!Number.isFinite(quantity) || quantity < 0) return;
    await updateLineM.mutateAsync({
      lineId,
      quantity,
      batchNumber: e?.batchNumber || undefined,
      expiryDate: e?.expiryDate || undefined,
    });
    setEditing((prev) => {
      const next = { ...prev };
      delete next[lineId];
      return next;
    });
  };

  return (
    <>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            <span className="font-mono text-base text-slate-muted">{data.grNumber}</span>
            <StatusBadge status={data.status} />
            {data.coldChainRequired && <StatusBadge status="warning" label="Chaîne du froid" />}
          </span>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push('/procurement/goods-receipts')}
            >
              <ArrowLeft className="mr-2 h-4 w-4" /> Retour
            </Button>
            {canComplete && (
              <Button size="sm" onClick={() => setDialog('complete')} data-testid="action-complete">
                <CheckCircle2 className="mr-2 h-4 w-4" /> Compléter la réception
              </Button>
            )}
            {canReject && (
              <Button variant="destructive" size="sm" onClick={() => setDialog('reject')}>
                <XCircle className="mr-2 h-4 w-4" /> Rejeter livraison
              </Button>
            )}
            {canCancel && (
              <Button variant="destructive" size="sm" onClick={() => setDialog('cancel')}>
                <Trash2 className="mr-2 h-4 w-4" /> Annuler brouillon
              </Button>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-6 p-8 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Lignes reçues</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">PO line</TableHead>
                    <TableHead>Qté reçue</TableHead>
                    <TableHead>Lot</TableHead>
                    <TableHead>Péremption</TableHead>
                    <TableHead>Chaîne du froid OK ?</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.lines.map((l) => {
                    const draft = editing[l.id ?? ''];
                    return (
                      <TableRow key={l.id ?? l.poLineId}>
                        <TableCell className="font-mono text-xs">{l.poLineId.slice(0, 8)}…</TableCell>
                        <TableCell>
                          {canEdit && l.id ? (
                            <Input
                              type="number"
                              step="0.01"
                              defaultValue={String(l.quantity ?? 0)}
                              value={draft?.quantity ?? String(l.quantity ?? 0)}
                              onChange={(e) => setLineField(l.id!, 'quantity', e.target.value)}
                              className="w-28"
                            />
                          ) : (
                            <span>{Number(l.quantity).toLocaleString('fr-FR')}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {canEdit && l.id ? (
                            <Input
                              defaultValue={l.batchNumber ?? ''}
                              value={draft?.batchNumber ?? l.batchNumber ?? ''}
                              onChange={(e) => setLineField(l.id!, 'batchNumber', e.target.value)}
                              className="w-32"
                              placeholder="LOT-…"
                            />
                          ) : (
                            <span>{l.batchNumber ?? '—'}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {canEdit && l.id ? (
                            <Input
                              type="date"
                              defaultValue={l.expiryDate ?? ''}
                              value={draft?.expiryDate ?? (l.expiryDate ?? '')}
                              onChange={(e) => setLineField(l.id!, 'expiryDate', e.target.value)}
                              className="w-36"
                            />
                          ) : (
                            <DateDisplay value={l.expiryDate} format="short" />
                          )}
                        </TableCell>
                        <TableCell>
                          {l.coldChainOk === true ? (
                            <StatusBadge status="success" label="OK" />
                          ) : l.coldChainOk === false ? (
                            <StatusBadge status="error" label="Rompu" />
                          ) : (
                            <span className="text-xs text-slate-muted">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {canEdit && l.id && draft && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => saveLine(l.id!, l.quantity)}
                              disabled={updateLineM.isPending}
                            >
                              Sauver
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Informations</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-baseline justify-between">
              <span className="text-xs uppercase tracking-wide text-slate-muted">BC associé</span>
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0 text-ipd-darker"
                onClick={() => router.push(`/procurement/purchase-orders/${data.poId}`)}
              >
                Voir BC
              </Button>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-xs uppercase tracking-wide text-slate-muted">Réception</span>
              <DateDisplay value={data.receiptDate} format="short" />
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-xs uppercase tracking-wide text-slate-muted">Magasinier</span>
              <span className="font-mono text-xs">{data.receivedBy.slice(0, 8)}…</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={dialog === 'complete'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Compléter la réception"
        description="La réception passera à complete (ou partial si toutes les quantités ne sont pas atteintes). L'écriture comptable de constatation du service fait sera générée."
        confirmLabel="Compléter"
        loading={completeM.isPending}
        onConfirm={async () => {
          await completeM.mutateAsync();
          setDialog(null);
        }}
      />
      <ConfirmDialog
        open={dialog === 'reject'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Rejeter la livraison"
        description="Le motif est consigné (chaîne du froid rompue, qualité défaillante, etc.)."
        destructive
        requireReason
        confirmLabel="Rejeter"
        loading={rejectM.isPending}
        onConfirm={async (reason) => {
          await rejectM.mutateAsync(reason ?? '');
          setDialog(null);
        }}
      />
      <ConfirmDialog
        open={dialog === 'cancel'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Annuler ce brouillon"
        description="Action irréversible — la GR sera marquée cancelled."
        destructive
        requireReason
        confirmLabel="Annuler"
        loading={cancelM.isPending}
        onConfirm={async (reason) => {
          await cancelM.mutateAsync(reason ?? '');
          setDialog(null);
          router.push('/procurement/goods-receipts');
        }}
      />
    </>
  );
}

'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  CheckCircle2,
  FileCode2,
  ScrollText,
  Send,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Wallet,
  XCircle,
} from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { IbanAlertBadge } from '@/components/treasury/IbanAlertBadge';
import { IbanMaskedDisplay } from '@/components/treasury/IbanMaskedDisplay';
import { PaymentRunWorkflow } from '@/components/treasury/PaymentRunWorkflow';
import {
  useAcknowledgeIbanAlerts,
  useApprovePaymentRun,
  useCancelPaymentRun,
  useGenerateSepa,
  useIbanAlerts,
  usePaymentRun,
  usePreparePaymentRun,
  useRejectPaymentRun,
} from '@/hooks/use-treasury';
import { usePermissions } from '@/hooks/use-permissions';
import type { IbanAlert } from '@/lib/api/treasury';

type DialogKind = 'prepare' | 'approve' | 'reject' | 'cancel' | 'ack-iban' | null;

export default function PaymentRunDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id ?? '';
  const permissions = usePermissions();
  const run = usePaymentRun(id);
  const alertsQuery = useIbanAlerts(id);

  const prepareM = usePreparePaymentRun(id);
  const approveM = useApprovePaymentRun(id);
  const rejectM = useRejectPaymentRun(id);
  const cancelM = useCancelPaymentRun(id);
  const ackM = useAcknowledgeIbanAlerts(id);
  const sepaM = useGenerateSepa(id);

  const [dialog, setDialog] = React.useState<DialogKind>(null);
  const [identityVerified, setIdentityVerified] = React.useState(false);

  if (run.isLoading || !run.data) {
    return (
      <>
        <PageHeader title="Payment run" subtitle="Chargement…" />
        <div className="space-y-4 p-8">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </>
    );
  }

  const data = run.data;
  const alerts = (alertsQuery.data ?? []) as IbanAlert[];
  const unackCount = alerts.filter((a) => !a.acknowledged).length;
  const canPrepare = data.status === 'draft' && permissions.canPreparePaymentRun();
  const canApprove =
    data.status === 'prepared' && permissions.canApprovePaymentRun() && unackCount === 0;
  const canReject = data.status === 'prepared' && permissions.canApprovePaymentRun();
  const canCancel = data.status === 'draft' && permissions.canCreatePaymentRun();
  const canGenSepa =
    (data.status === 'prepared' || data.status === 'executed') &&
    permissions.canGenerateSepa();
  const canAck = unackCount > 0 && permissions.canAcknowledgeIbanAlerts();

  return (
    <>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            <Wallet className="h-5 w-5 text-ipd-darker" />
            <span className="font-mono text-base text-slate-text">{data.runNumber}</span>
            <StatusBadge status={data.status} />
            {alerts.length > 0 && (
              <IbanAlertBadge
                level={unackCount > 0 ? 'critical' : 'warn'}
                count={unackCount > 0 ? unackCount : alerts.length}
              />
            )}
          </span>
        }
        subtitle={`Run du ${data.runDate.slice(0, 10)} — ${data.currency}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => router.push('/treasury/payment-runs')}>
              <ArrowLeft className="mr-2 h-4 w-4" /> Retour
            </Button>
            {canPrepare && (
              <Button size="sm" onClick={() => setDialog('prepare')} data-testid="run-prepare">
                <ShieldCheck className="mr-2 h-4 w-4" /> Préparer
              </Button>
            )}
            {canGenSepa && (
              <Button
                size="sm"
                onClick={() => sepaM.mutate()}
                disabled={sepaM.isPending}
                data-testid="run-generate-sepa"
              >
                <FileCode2 className="mr-2 h-4 w-4" />
                {sepaM.isPending ? 'Génération…' : 'Générer SEPA'}
              </Button>
            )}
            {data.sepaGeneratedAt && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push(`/treasury/payment-runs/${data.id}/sepa`)}
                data-testid="run-view-sepa"
              >
                <ScrollText className="mr-2 h-4 w-4" /> Voir SEPA
              </Button>
            )}
            {canApprove && (
              <Button size="sm" onClick={() => setDialog('approve')} data-testid="run-approve">
                <CheckCircle2 className="mr-2 h-4 w-4" /> Approuver + Exécuter
              </Button>
            )}
            {canReject && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setDialog('reject')}
                data-testid="run-reject"
              >
                <XCircle className="mr-2 h-4 w-4" /> Rejeter
              </Button>
            )}
            {canCancel && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setDialog('cancel')}
                data-testid="run-cancel"
              >
                <Trash2 className="mr-2 h-4 w-4" /> Annuler
              </Button>
            )}
          </div>
        }
      />

      <div className="space-y-6 p-8">
        <PaymentRunWorkflow
          status={data.status}
          approvedAt={data.approvedAt}
          executedAt={data.executedAt}
          sepaGeneratedAt={data.sepaGeneratedAt}
        />

        {unackCount > 0 && (
          <div
            data-testid="iban-alerts-banner"
            className="space-y-3 rounded-md border-2 border-state-error bg-state-error/10 p-4"
          >
            <div className="flex items-center gap-2 text-state-error">
              <ShieldAlert className="h-5 w-5" />
              <b>
                {unackCount} alerte{unackCount > 1 ? 's' : ''} IBAN
                {unackCount > 1 ? ' ' : ' '}— l'approbation est bloquée tant qu'elle
                {unackCount > 1 ? 's' : ''} n'est pas acknowledgée
                {unackCount > 1 ? 's' : ''} par le DAF.
              </b>
            </div>
            <ul className="space-y-2 text-sm">
              {alerts
                .filter((a) => !a.acknowledged)
                .map((a) => (
                  <li
                    key={a.supplierId}
                    data-testid={`iban-alert-${a.supplierId}`}
                    className="rounded border border-state-error/30 bg-white p-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{a.supplierName}</span>
                      <span className="text-xs text-slate-muted">
                        IBAN changé il y a <b className="text-state-error">{a.daysSinceChange}j</b>
                      </span>
                    </div>
                    <div className="mt-1 grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-slate-muted">Ancien : </span>
                        <IbanMaskedDisplay iban={a.previousIban} compact />
                      </div>
                      <div>
                        <span className="text-slate-muted">Nouveau : </span>
                        <IbanMaskedDisplay iban={a.currentIban} />
                      </div>
                    </div>
                  </li>
                ))}
            </ul>
            {canAck && (
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => setDialog('ack-iban')}
                  data-testid="ack-iban-btn"
                >
                  Acknowledger toutes les alertes
                </Button>
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Paiements ({data.payments.length})</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Facture</TableHead>
                    <TableHead className="text-right">Montant</TableHead>
                    <TableHead>Méthode</TableHead>
                    <TableHead>Statut</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.payments.map((p) => (
                    <TableRow key={p.id} data-testid={`payment-row-${p.id}`}>
                      <TableCell>
                        <span className="font-mono text-xs">{p.invoice.invoiceNumber}</span>
                      </TableCell>
                      <TableCell className="text-right">
                        <AmountDisplay amount={p.amount} currency={p.currency} />
                        {p.originalCurrency && p.originalCurrency !== p.currency && (
                          <div className="text-[10px] text-slate-muted">
                            (orig{' '}
                            <AmountDisplay
                              amount={p.originalAmount}
                              currency={p.originalCurrency}
                              decimals={2}
                            />
                            )
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="muted" className="font-mono uppercase">
                          {p.method}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={p.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="border-t border-slate-200 px-4 py-3 text-right">
                <span className="mr-2 text-xs uppercase tracking-wide text-slate-muted">Total</span>
                <AmountDisplay amount={data.totalAmount} currency={data.currency} className="text-lg" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Métadonnées</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Field label="Compte bancaire" value={<span className="font-mono text-xs">{data.bankAccountId ?? '—'}</span>} />
              <Field label="Devise" value={data.currency} />
              {data.preparationWarnings && data.preparationWarnings.length > 0 && (
                <div className="pt-2">
                  <p className="text-xs font-medium text-state-warning">
                    {data.preparationWarnings.length} avertissement(s) à la préparation
                  </p>
                </div>
              )}
              {data.rejectionReason && (
                <div className="rounded bg-state-error/10 p-2 text-xs text-state-error">
                  <b>Motif :</b> {data.rejectionReason}
                </div>
              )}
              {data.sepaSentAt && (
                <Field
                  label="SEPA envoyé"
                  value={<DateDisplay value={data.sepaSentAt} format="short" />}
                />
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={dialog === 'prepare'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Préparer le run"
        description="Validation des IBAN fournisseurs + snapshot anti-fraude des changements récents. Le run passe en statut prepared."
        confirmLabel="Préparer"
        loading={prepareM.isPending}
        onConfirm={async () => {
          await prepareM.mutateAsync();
          setDialog(null);
        }}
      />

      <ConfirmDialog
        open={dialog === 'approve'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Approuver et exécuter le run"
        description={
          <>
            <b>Séparation des tâches :</b> réservé au DAF. Crée les écritures BQ
            classe 5 (et 666/766 si multi-devise), passe le run en <code>executed</code>
            et marque chaque facture comme partiellement payée ou payée.
          </>
        }
        confirmLabel="Approuver + Exécuter"
        loading={approveM.isPending}
        onConfirm={async () => {
          await approveM.mutateAsync(undefined);
          setDialog(null);
        }}
      />

      <ConfirmDialog
        open={dialog === 'reject'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Rejeter le run"
        description="Motif obligatoire (min 5 caractères). Le run passe en rejected, les paiements en cancelled."
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

      <ConfirmDialog
        open={dialog === 'cancel'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Annuler le run en brouillon"
        description="Action irréversible. Motif obligatoire."
        destructive
        requireReason
        reasonLabel="Motif de l'annulation"
        confirmLabel="Annuler le run"
        loading={cancelM.isPending}
        onConfirm={async (reason) => {
          await cancelM.mutateAsync(reason ?? '');
          setDialog(null);
        }}
      />

      <AcknowledgeIbanDialog
        open={dialog === 'ack-iban'}
        onClose={() => setDialog(null)}
        loading={ackM.isPending}
        identityVerified={identityVerified}
        setIdentityVerified={setIdentityVerified}
        onConfirm={async (reason) => {
          await ackM.mutateAsync({ reason, identityVerified });
          setDialog(null);
          setIdentityVerified(false);
        }}
      />
    </>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-xs uppercase tracking-wide text-slate-muted">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

/** Dialog spécifique pour acknowledgement IBAN — ajoute checkbox "identité vérifiée". */
function AcknowledgeIbanDialog({
  open,
  onClose,
  onConfirm,
  loading,
  identityVerified,
  setIdentityVerified,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
  loading: boolean;
  identityVerified: boolean;
  setIdentityVerified: (v: boolean) => void;
}) {
  const [reason, setReason] = React.useState('');
  React.useEffect(() => {
    if (!open) setReason('');
  }, [open]);

  const invalid = reason.trim().length < 5;
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        data-testid="ack-iban-dialog"
        className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-6 shadow-xl"
      >
        <h2 className="mb-2 text-lg font-semibold text-state-error">
          Acknowledger les alertes IBAN
        </h2>
        <p className="mb-4 text-sm text-slate-muted">
          En tant que DAF, vous confirmez avoir vérifié l'identité du/des bénéficiaire(s)
          par un canal indépendant (téléphone, contact direct). Le motif et l'action sont
          tracés dans l'audit log + dans <code>match_summary.acknowledgeReason</code>.
        </p>

        <Label htmlFor="ack-reason" className="text-xs">
          Motif (min 5 caractères)
        </Label>
        <Input
          id="ack-reason"
          data-testid="ack-iban-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Ex: contacté par téléphone, confirmé par M. Dupont"
          className="mt-1"
        />

        <label className="mt-3 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={identityVerified}
            onChange={(e) => setIdentityVerified(e.target.checked)}
            data-testid="ack-identity-verified"
            className="h-4 w-4 cursor-pointer accent-ipd-dark"
          />
          Je confirme avoir vérifié l'identité du bénéficiaire par téléphone
        </label>

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Annuler
          </Button>
          <Button
            variant="destructive"
            disabled={invalid || loading}
            onClick={() => onConfirm(reason.trim())}
            data-testid="ack-iban-confirm"
          >
            {loading ? 'Acknowledge…' : 'Acknowledger'}
          </Button>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { ArrowLeft, CheckCircle2, Pencil, Send, ShoppingCart, Undo2, XCircle, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { DocumentsPanel } from '@/components/common/DocumentsPanel';
import { StatusBadge } from '@/components/common/StatusBadge';
import { AmountDisplay } from '@/components/common/AmountDisplay';
import { DateDisplay } from '@/components/common/DateDisplay';
import { WorkflowTimeline } from '@/components/common/WorkflowTimeline';
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
  useApprovePR,
  useCancelPR,
  usePR,
  usePrApprovalHistory,
  useRejectPR,
  useReturnPRForChanges,
  useSubmitPR,
} from '@/hooks/use-procurement';
import { usePermissions } from '@/hooks/use-permissions';
import { useExpenseNatures } from '@/hooks/use-referential';
import {
  EligibilityErrorAlert,
  isEligibilityError,
} from '@/components/procurement/EligibilityErrorAlert';
import type { PrStatus } from '@/lib/api/procurement';

type DialogKind = 'submit' | 'approve' | 'reject' | 'return' | 'cancel' | null;

const PENDING_STATUSES: PrStatus[] = [
  'submitted',
  'pending_pi',
  'pending_cg',
  'pending_daf',
  'pending_caissier',
];

export default function PurchaseRequestDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id ?? '';
  const { data: session } = useSession();
  const permissions = usePermissions();
  const pr = usePR(id);
  const history = usePrApprovalHistory(id);
  // US-064 : mapping code nature → libellé pour l'affichage détail.
  const { data: expenseNatures } = useExpenseNatures();

  const submitM = useSubmitPR(id);
  const approveM = useApprovePR(id);
  const rejectM = useRejectPR(id);
  const returnM = useReturnPRForChanges(id);
  const cancelM = useCancelPR(id);

  const [dialog, setDialog] = useState<DialogKind>(null);

  if (pr.isLoading || !pr.data) {
    return (
      <>
        <PageHeader title="Demande d'achat" subtitle="Chargement…" />
        <div className="space-y-4 p-8">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </>
    );
  }

  const data = pr.data;
  const isDraft = data.status === 'draft';
  const isPending = PENDING_STATUSES.includes(data.status);
  const ownerId = data.requestedBy;
  const userEmail = session?.user?.email ?? null;
  // Heuristique : on n'a pas l'id app_user côté front directement.
  // Le backend re-vérifie le ownership — ici on autorise édition si
  // l'utilisateur a le rôle DEMANDEUR/PI/SUPER_ADMIN ET la DA est draft.
  const canEdit = isDraft && permissions.canEditPR(ownerId, userEmail);
  const canCancel = isDraft && permissions.canCancelPR(ownerId, userEmail);
  const canSubmit = isDraft && permissions.canCreatePR();

  const canCreateBC =
    data.status === 'approved' &&
    data.requestType !== 'petty_cash' &&
    permissions.canCreatePO();

  const canApproveNow =
    (data.status === 'pending_pi' && permissions.canApprovePRAsPi()) ||
    (data.status === 'pending_cg' && permissions.canApprovePRAsCg()) ||
    (data.status === 'pending_daf' && permissions.canApprovePRAsDaf()) ||
    (data.status === 'pending_caissier' && permissions.canApprovePRAsCash()) ||
    (isPending && permissions.has('SUPER_ADMIN'));

  const closeDialog = () => setDialog(null);

  return (
    <>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            <span className="font-mono text-base text-slate-muted">{data.prNumber}</span>
            <StatusBadge status={data.status} />
            {data.requestType && data.requestType !== 'standard' && (
              <StatusBadge status={data.requestType} />
            )}
          </span>
        }
        subtitle={
          <span className="line-clamp-1 max-w-[60ch]">
            {data.description ?? 'Sans description'}
          </span>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push('/procurement/purchase-requests')}
            >
              <ArrowLeft className="mr-2 h-4 w-4" /> Retour
            </Button>
            {canEdit && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push(`/procurement/purchase-requests/${data.id}/edit`)}
              >
                <Pencil className="mr-2 h-4 w-4" /> Modifier
              </Button>
            )}
            {canSubmit && (
              <Button size="sm" onClick={() => setDialog('submit')} data-testid="action-submit">
                <Send className="mr-2 h-4 w-4" /> Soumettre
              </Button>
            )}
            {canCreateBC && (
              <Button
                size="sm"
                onClick={() =>
                  router.push(`/procurement/purchase-orders/new?fromPR=${data.id}`)
                }
                data-testid="action-create-bc"
              >
                <ShoppingCart className="mr-2 h-4 w-4" /> Créer un BC
              </Button>
            )}
            {canApproveNow && (
              <>
                <Button
                  size="sm"
                  onClick={() => setDialog('approve')}
                  data-testid="action-approve"
                >
                  <CheckCircle2 className="mr-2 h-4 w-4" /> Approuver
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDialog('return')}
                  data-testid="action-return"
                >
                  <Undo2 className="mr-2 h-4 w-4" /> Renvoyer
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setDialog('reject')}
                  data-testid="action-reject"
                >
                  <XCircle className="mr-2 h-4 w-4" /> Rejeter
                </Button>
              </>
            )}
            {canCancel && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setDialog('cancel')}
              >
                <Trash2 className="mr-2 h-4 w-4" /> Annuler
              </Button>
            )}
          </div>
        }
      />

      {/* US-064 : refus d'éligibilité au submit — panneau lisible dédié,
          pas un toast générique (ADR-007). */}
      {submitM.isError && isEligibilityError(submitM.error) && (
        <div className="px-8 pt-6">
          <EligibilityErrorAlert error={submitM.error} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 p-8 lg:grid-cols-3">
        {/* Lignes + métadonnées */}
        <div className="space-y-6 lg:col-span-2">
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
              <div className="border-t border-slate-200 px-4 py-3 text-right">
                <span className="mr-2 text-xs uppercase tracking-wide text-slate-muted">Total</span>
                <AmountDisplay amount={data.totalAmount} currency={data.currency} className="text-lg" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar : workflow timeline + métadonnées */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Informations</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Field label="Projet" value={<span className="font-mono text-xs">{data.projectId}</span>} />
              <Field label="Convention" value={<span className="font-mono text-xs">{data.grantId}</span>} />
              <Field label="Devise" value={data.currency} />
              <Field label="Demandé le" value={<DateDisplay value={data.requestedAt} relative />} />
              <Field label="Besoin pour" value={<DateDisplay value={data.neededBy} format="short" />} />
              {/* US-064 — champs éligibilité (colonnes US-054) */}
              <Field
                label="Nature de dépense"
                value={
                  data.expenseNatureCode ? (
                    <span data-testid="pr-detail-nature">
                      {expenseNatures?.find((n) => n.code === data.expenseNatureCode)?.label ??
                        data.expenseNatureCode}
                    </span>
                  ) : (
                    <span className="text-slate-muted">—</span>
                  )
                }
              />
              <Field
                label="Refacturée Pasteur Paris"
                value={
                  <span data-testid="pr-detail-pasteur-paris">
                    {data.pasteurParisReimbursed ? 'Oui' : 'Non'}
                  </span>
                }
              />
              <Field
                label="N° facture fournisseur"
                value={
                  data.supplierInvoiceNumber ? (
                    <span className="font-mono text-xs" data-testid="pr-detail-supplier-invoice">
                      {data.supplierInvoiceNumber}
                    </span>
                  ) : (
                    <span className="text-slate-muted">—</span>
                  )
                }
              />
            </CardContent>
          </Card>

          {/* US-069 : aucun document stocké pour les DA aujourd'hui →
              état vide charte. Un PDF de DA archivé est noté au backlog. */}
          <DocumentsPanel
            documents={[]}
            emptyMessage="Aucun document archivé pour les demandes d'achat (PDF de DA : à venir)."
          />

          <Card>
            <CardHeader>
              <CardTitle>Workflow</CardTitle>
            </CardHeader>
            <CardContent>
              {history.isLoading ? (
                <Skeleton className="h-32 w-full" />
              ) : (
                <WorkflowTimeline
                  steps={(history.data ?? []).map((s) => ({
                    id: s.id,
                    stepOrder: s.stepOrder,
                    approverRole: s.approverRole,
                    approverId: s.approverId,
                    status: s.status,
                    decidedAt: s.decidedAt,
                    decisionNotes: s.decisionNotes,
                  }))}
                />
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Dialogs */}
      <ConfirmDialog
        open={dialog === 'submit'}
        onOpenChange={(o) => !o && closeDialog()}
        title="Soumettre la DA pour approbation"
        description="Un contrôle budgétaire est effectué avant le passage en pending_pi."
        confirmLabel="Soumettre"
        loading={submitM.isPending}
        onConfirm={async () => {
          // US-064 : on ferme le dialog même sur refus — l'erreur est
          // restituée par le panneau EligibilityErrorAlert (ou le toast).
          try {
            await submitM.mutateAsync();
          } catch {
            /* restitué via submitM.error */
          }
          closeDialog();
        }}
      />
      <ConfirmDialog
        open={dialog === 'approve'}
        onOpenChange={(o) => !o && closeDialog()}
        title="Approuver cette étape"
        description="Le commentaire est optionnel. La DA passera à l'étape suivante du workflow."
        requireReason={false}
        confirmLabel="Approuver"
        loading={approveM.isPending}
        onConfirm={async () => {
          await approveM.mutateAsync(undefined);
          closeDialog();
        }}
      />
      <ConfirmDialog
        open={dialog === 'reject'}
        onOpenChange={(o) => !o && closeDialog()}
        title="Rejeter la DA"
        description="Le motif sera consigné dans la piste d'audit (min 5 caractères)."
        destructive
        requireReason
        reasonLabel="Motif du rejet"
        confirmLabel="Rejeter"
        loading={rejectM.isPending}
        onConfirm={async (reason) => {
          await rejectM.mutateAsync(reason ?? '');
          closeDialog();
        }}
      />
      <ConfirmDialog
        open={dialog === 'return'}
        onOpenChange={(o) => !o && closeDialog()}
        title="Renvoyer en brouillon pour modification"
        description="Le demandeur pourra modifier la DA, la soumission reprendra à l'étape PI."
        requireReason
        reasonLabel="Commentaire (visible par le demandeur)"
        confirmLabel="Renvoyer"
        loading={returnM.isPending}
        onConfirm={async (reason) => {
          await returnM.mutateAsync(reason ?? '');
          closeDialog();
        }}
      />
      <ConfirmDialog
        open={dialog === 'cancel'}
        onOpenChange={(o) => !o && closeDialog()}
        title="Annuler cette DA brouillon"
        description="Cette action est irréversible. La DA passera en statut cancelled."
        destructive
        confirmLabel="Annuler la DA"
        loading={cancelM.isPending}
        onConfirm={async () => {
          await cancelM.mutateAsync();
          closeDialog();
          router.push('/procurement/purchase-requests');
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

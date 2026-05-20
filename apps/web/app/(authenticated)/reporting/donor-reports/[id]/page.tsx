'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { ArrowLeft, Download, FileText, Lock, Send } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DonorReportStatusBadge } from '@/components/reporting/DonorReportStatusBadge';
import { DonorReportLineTable } from '@/components/reporting/DonorReportLineTable';
import { DonorReportTotals } from '@/components/reporting/DonorReportTotals';
import {
  downloadDonorReportExcel,
  downloadDonorReportPdf,
} from '@/lib/api/reporting';
import {
  useDonorReport,
  useLockDonorReport,
  useSendDonorReport,
} from '@/hooks/use-reporting';
import { usePermissions } from '@/hooks/use-permissions';
import { ApiError } from '@/lib/api-client';

/**
 * Détail d'un rapport bailleur — affichage + actions selon status.
 *
 * Status → actions disponibles :
 *   - draft  : Lock (CG/DAF/SA) → génère PDF+Excel + status=locked
 *   - locked : Send (DAF only) → status=sent + downloads
 *   - sent   : downloads PDF+Excel (lecture seule)
 *
 * Le BAILLEUR ne voit que les rapports `sent` (filtré côté liste).
 * S'il tente d'accéder à un rapport draft/locked par URL, l'API
 * renvoie le rapport (pas de RBAC backend pour l'instant) — voile UI
 * cache les actions.
 */
export default function DonorReportDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const reportId = params.id;
  const perms = usePermissions();
  const { data: session } = useSession();
  const { data, isLoading, isError } = useDonorReport(reportId);
  const lockM = useLockDonorReport(reportId);
  const sendM = useSendDonorReport(reportId);
  const [sendOpen, setSendOpen] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendRef, setSendRef] = useState('');
  const [sendNotes, setSendNotes] = useState('');

  if (isLoading) {
    return <div className="px-8 py-6 text-sm text-slate-muted">Chargement du rapport…</div>;
  }
  if (isError || !data) {
    return (
      <div className="px-8 py-6">
        <p className="text-sm text-state-error">Rapport introuvable ou accès refusé.</p>
        <Button asChild variant="outline" className="mt-3">
          <Link href="/reporting/donor-reports">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Retour aux rapports
          </Link>
        </Button>
      </div>
    );
  }

  const isBailleur = perms.has('BAILLEUR') && !perms.hasAny('CONTROLEUR', 'DAF', 'SUPER_ADMIN');
  const canShowActions = !isBailleur;

  const handleLock = async () => {
    try {
      await lockM.mutateAsync();
    } catch (e: unknown) {
      // Toast côté hook (mapApiErrorToToast) — pas d'erreur UI ici
      console.error('lock failed', e);
    }
  };

  const handleSend = async () => {
    setSendError(null);
    try {
      await sendM.mutateAsync({
        externalReference: sendRef.trim() || undefined,
        notes: sendNotes.trim() || undefined,
      });
      setSendOpen(false);
      setSendRef('');
      setSendNotes('');
    } catch (e: unknown) {
      if (e instanceof ApiError) {
        setSendError(`Erreur ${e.status} — ${e.body.message ?? 'cas métier'}`);
      } else if (e instanceof Error) {
        setSendError(e.message);
      }
    }
  };

  const triggerDownload = async (kind: 'pdf' | 'excel') => {
    try {
      const blob = kind === 'pdf'
        ? await downloadDonorReportPdf(reportId, { accessToken: session?.accessToken ?? null })
        : await downloadDonorReportExcel(reportId, { accessToken: session?.accessToken ?? null });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const ext = kind === 'pdf' ? 'pdf' : 'xlsx';
      a.href = url;
      a.download = `GRANTFLOW-${reportId.slice(0, 8)}-${data.periodEnd}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      console.error('download failed', e);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <Link
              href="/reporting/donor-reports"
              className="text-slate-muted transition hover:text-ipd-darker"
              aria-label="Retour"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <FileText className="h-5 w-5" />
            <span>Rapport {data.id.slice(0, 8).toUpperCase()}</span>
            <DonorReportStatusBadge status={data.status} />
          </span>
        }
        subtitle={`${data.template.code} · Grant ${data.grant.reference} · ${data.periodStart} → ${data.periodEnd}`}
        actions={
          canShowActions && (
            <div className="flex items-center gap-2">
              {data.pdfObjectKey && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => triggerDownload('pdf')}
                  data-testid="download-pdf"
                >
                  <Download className="mr-1 h-4 w-4" />
                  PDF
                </Button>
              )}
              {data.excelObjectKey && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => triggerDownload('excel')}
                  data-testid="download-excel"
                >
                  <Download className="mr-1 h-4 w-4" />
                  Excel
                </Button>
              )}
              {data.status === 'draft' && perms.canLockDonorReport() && (
                <Button
                  onClick={handleLock}
                  disabled={lockM.isPending}
                  data-testid="lock-button"
                >
                  <Lock className="mr-1 h-4 w-4" />
                  {lockM.isPending ? 'Verrouillage…' : 'Verrouiller pour envoi'}
                </Button>
              )}
              {data.status === 'locked' && perms.canSendDonorReport() && (
                <Button
                  onClick={() => setSendOpen(true)}
                  data-testid="send-button"
                >
                  <Send className="mr-1 h-4 w-4" />
                  Envoyer au bailleur
                </Button>
              )}
            </div>
          )
        }
      />

      <div className="space-y-6 px-8 py-6">
        {/* Bandeau status sent */}
        {data.status === 'sent' && (
          <div
            data-testid="sent-banner"
            className="rounded-md border border-state-success/30 bg-state-success/5 px-3 py-2 text-sm text-state-success"
          >
            ✓ Rapport envoyé au bailleur le{' '}
            {data.sentAt
              ? new Date(data.sentAt).toLocaleString('fr-FR')
              : 'date inconnue'}
            . Aucune modification possible.
          </div>
        )}

        {/* Totaux */}
        <section data-testid="section-totals">
          <DonorReportTotals
            totalBudget={Number(data.totalBudget)}
            totalSpent={Number(data.totalSpent)}
            totalOverhead={Number(data.totalOverhead)}
            fundsCarried={Number(data.fundsCarried)}
            currency={data.currency}
            fxRateUsed={data.fxRateUsed ? Number(data.fxRateUsed) : null}
          />
        </section>

        {/* Lignes par catégorie */}
        <section data-testid="section-lines">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Lignes par catégorie bailleur ({data.lines.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <DonorReportLineTable lines={data.lines} currency={data.currency} />
            </CardContent>
          </Card>
        </section>

        {/* Métadonnées */}
        <section data-testid="section-meta">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Métadonnées</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              <MetaField label="Devise" value={data.currency} />
              <MetaField
                label="Taux de change"
                value={data.fxRateUsed ? Number(data.fxRateUsed).toFixed(4) : '1.0000'}
              />
              <MetaField
                label="Généré le"
                value={new Date(data.generatedAt).toLocaleString('fr-FR')}
              />
              {data.lockedAt && (
                <MetaField
                  label="Verrouillé le"
                  value={new Date(data.lockedAt).toLocaleString('fr-FR')}
                />
              )}
              {data.sentAt && (
                <MetaField
                  label="Envoyé le"
                  value={new Date(data.sentAt).toLocaleString('fr-FR')}
                />
              )}
              {data.notes && (
                <div className="col-span-2 sm:col-span-3">
                  <p className="text-[10px] uppercase tracking-wide text-slate-muted">Notes</p>
                  <p className="mt-0.5 whitespace-pre-line text-sm text-slate-700">{data.notes}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      </div>

      {/* Dialog envoi bailleur */}
      <Dialog open={sendOpen} onOpenChange={setSendOpen}>
        <DialogContent data-testid="send-dialog">
          <DialogHeader>
            <DialogTitle>Envoyer le rapport au bailleur</DialogTitle>
            <DialogDescription>
              Après envoi, le rapport est <strong>immutable</strong>. Vérifiez que le PDF et
              l&apos;Excel reflètent bien les chiffres attendus avant de confirmer.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs uppercase tracking-wide text-slate-muted">
                Référence externe (ex. n° de courrier, ticket)
              </Label>
              <Input
                data-testid="send-reference"
                value={sendRef}
                onChange={(e) => setSendRef(e.target.value)}
                placeholder="USAID-2026-Q2-001"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs uppercase tracking-wide text-slate-muted">
                Notes d&apos;envoi (optionnel)
              </Label>
              <textarea
                data-testid="send-notes"
                value={sendNotes}
                onChange={(e) => setSendNotes(e.target.value)}
                rows={3}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            {sendError && (
              <p
                data-testid="send-error"
                className="rounded-md border border-state-error/30 bg-state-error/5 px-3 py-2 text-sm text-state-error"
              >
                {sendError}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSendOpen(false)}
              disabled={sendM.isPending}
            >
              Annuler
            </Button>
            <Button
              onClick={handleSend}
              disabled={sendM.isPending}
              data-testid="confirm-send"
            >
              <Send className="mr-1 h-4 w-4" />
              {sendM.isPending ? 'Envoi…' : 'Confirmer l\'envoi'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MetaField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-slate-muted">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-slate-700">{value}</p>
    </div>
  );
}

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Lock,
} from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FondsDediesView } from '@/components/reporting/FondsDediesView';
import { StatementSectionTable } from '@/components/reporting/StatementSectionTable';
import { ApiError } from '@/lib/api-client';
import { formatAmount } from '@/lib/api/pilotage';
import { useLockStatement, useStatement } from '@/hooks/use-reporting';
import { usePermissions } from '@/hooks/use-permissions';
import {
  downloadStatementExcel,
  downloadStatementPdf,
  STATEMENT_TYPE_LABELS_FR,
  type FinancialStatementDetail,
  type StatementType,
} from '@/lib/api/reporting';

/**
 * Détail d'un état financier — sprint F5b-b Lot C.
 *
 * Rendu par sections selon le type :
 *   - TER       : EMPLOIS + RESSOURCES (totaux dans le footer)
 *   - BILAN     : ACTIF + PASSIF (équilibre obligatoire — badge)
 *   - RESULTAT  : CHARGES + PRODUITS + résultat net
 *   - FONDS_DEDIES : composant dédié FondsDediesView avec rapprochement 689/19
 *
 * Actions selon statut + rôle :
 *   - locked=false + DAF : bouton Verrouiller (immutable après)
 *   - locked=true        : badge Verrouillé, actions modification désactivées
 *   - PDF / Excel        : disponibles si pdfObjectKey/xlsxObjectKey présents
 */
export default function StatementDetailPage() {
  const params = useParams<{ id: string }>();
  const statementId = params.id;
  const perms = usePermissions();
  const { data: session } = useSession();
  const { data, isLoading, isError } = useStatement(statementId);
  const lockM = useLockStatement(statementId);
  const [lockOpen, setLockOpen] = useState(false);
  const [lockError, setLockError] = useState<string | null>(null);

  if (isLoading) {
    return <div className="px-8 py-6 text-sm text-slate-muted">Chargement de l&apos;état…</div>;
  }
  if (isError || !data) {
    return (
      <div className="px-8 py-6">
        <p className="text-sm text-state-error">État introuvable ou accès refusé.</p>
        <Button asChild variant="outline" className="mt-3">
          <Link href="/reporting/statements">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Retour
          </Link>
        </Button>
      </div>
    );
  }

  const accessToken = session?.accessToken ?? null;

  const handleLock = async () => {
    setLockError(null);
    try {
      await lockM.mutateAsync();
      setLockOpen(false);
    } catch (e: unknown) {
      if (e instanceof ApiError) {
        setLockError(`Erreur ${e.status} — ${e.body.message ?? 'cas métier'}`);
      } else if (e instanceof Error) {
        setLockError(e.message);
      }
    }
  };

  const triggerDownload = async (kind: 'pdf' | 'excel') => {
    try {
      const blob =
        kind === 'pdf'
          ? await downloadStatementPdf(statementId, { accessToken })
          : await downloadStatementExcel(statementId, { accessToken });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const ext = kind === 'pdf' ? 'pdf' : 'xlsx';
      a.href = url;
      a.download = `GRANTFLOW-${data.type}-${data.period.code}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('statement download failed', e);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <Link
              href="/reporting/statements"
              className="text-slate-muted transition hover:text-ipd-darker"
              aria-label="Retour"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <FileSpreadsheet className="h-5 w-5" />
            <span>{STATEMENT_TYPE_LABELS_FR[data.type]}</span>
            {data.locked ? (
              <Badge variant="muted" className="gap-1">
                <Lock className="h-3 w-3" />
                Verrouillé
              </Badge>
            ) : (
              <Badge variant="warning">Brouillon</Badge>
            )}
            {data.totals.balanced ? (
              <Badge variant="success" className="gap-1">
                <CheckCircle2 className="h-3 w-3" />
                Équilibré
              </Badge>
            ) : (
              <Badge variant="error" className="gap-1">
                <AlertTriangle className="h-3 w-3" />
                Déséquilibré
              </Badge>
            )}
          </span>
        }
        subtitle={`Période ${data.period.code} (${data.period.startDate} → ${data.period.endDate}) · Généré le ${new Date(data.generatedAt).toLocaleDateString('fr-FR')}`}
        actions={
          <div className="flex items-center gap-2">
            {data.pdfObjectKey && (
              <Button
                onClick={() => triggerDownload('pdf')}
                variant="outline"
                size="sm"
                data-testid="download-statement-pdf"
              >
                <Download className="mr-1 h-4 w-4" />
                PDF
              </Button>
            )}
            {data.xlsxObjectKey && (
              <Button
                onClick={() => triggerDownload('excel')}
                variant="outline"
                size="sm"
                data-testid="download-statement-excel"
              >
                <Download className="mr-1 h-4 w-4" />
                Excel
              </Button>
            )}
            {!data.locked && perms.canLockStatement() && (
              <Button
                onClick={() => setLockOpen(true)}
                size="sm"
                data-testid="open-lock-statement"
              >
                <Lock className="mr-1 h-4 w-4" />
                Verrouiller
              </Button>
            )}
          </div>
        }
      />

      <div className="space-y-6 px-8 py-6">
        {data.locked && (
          <div
            data-testid="locked-banner"
            className="rounded-md border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-700"
          >
            <Lock className="mr-1 inline h-4 w-4" />
            État verrouillé le {data.lockedAt ? new Date(data.lockedAt).toLocaleString('fr-FR') : '—'} —
            immutable.
          </div>
        )}

        <StatementBody statement={data} />

        <Card data-testid="statement-meta">
          <CardHeader>
            <CardTitle className="text-base">Métadonnées</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Meta label="Type" value={data.type} />
            <Meta label="Période" value={data.period.code} />
            <Meta
              label="Total gauche"
              value={formatAmount(Number(data.totals.leftTotal))}
            />
            <Meta
              label="Total droite"
              value={formatAmount(Number(data.totals.rightTotal))}
            />
          </CardContent>
        </Card>
      </div>

      <LockStatementDialog
        open={lockOpen}
        onOpenChange={setLockOpen}
        loading={lockM.isPending}
        errorMessage={lockError}
        statementType={data.type}
        onConfirm={handleLock}
      />
    </div>
  );
}

function StatementBody({ statement }: { statement: FinancialStatementDetail }) {
  switch (statement.type) {
    case 'TER':
      return (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <StatementSectionTable
            lines={statement.lines}
            section="EMPLOIS"
            sectionLabel="Emplois (charges + reprises 789)"
          />
          <StatementSectionTable
            lines={statement.lines}
            section="RESSOURCES"
            sectionLabel="Ressources (produits + dotations 689)"
          />
        </div>
      );
    case 'BILAN':
      return (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <StatementSectionTable
            lines={statement.lines}
            section="ACTIF"
            sectionLabel="Actif"
          />
          <StatementSectionTable
            lines={statement.lines}
            section="PASSIF"
            sectionLabel="Passif (+ résultat net)"
          />
        </div>
      );
    case 'RESULTAT':
      return (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <StatementSectionTable
              lines={statement.lines}
              section="CHARGES"
              sectionLabel="Charges"
            />
            <StatementSectionTable
              lines={statement.lines}
              section="PRODUITS"
              sectionLabel="Produits"
            />
          </div>
          <ResultatNetBanner statement={statement} />
        </div>
      );
    case 'FONDS_DEDIES':
      return <FondsDediesView statement={statement} />;
    default: {
      // Exhaustive check — TypeScript prévient un nouveau type ajouté sans rendu.
      const exhaustive: never = statement.type;
      return <p>Type non supporté : {exhaustive as StatementType}</p>;
    }
  }
}

function ResultatNetBanner({ statement }: { statement: FinancialStatementDetail }) {
  const resultatNet = Number(statement.totals.resultatNet ?? 0);
  const positive = resultatNet >= 0;
  return (
    <div
      data-testid="resultat-net-banner"
      data-positive={positive ? 'true' : 'false'}
      className={
        positive
          ? 'rounded-md border border-state-success/30 bg-state-success/5 px-4 py-3 text-state-success'
          : 'rounded-md border border-state-error/30 bg-state-error/5 px-4 py-3 text-state-error'
      }
    >
      <p className="text-xs uppercase tracking-wide">Résultat net de l&apos;exercice</p>
      <p className="text-2xl font-bold">{formatAmount(resultatNet)}</p>
      <p className="text-xs">
        Charges : {formatAmount(Number(statement.totals.totalCharges ?? 0))} · Produits :{' '}
        {formatAmount(Number(statement.totals.totalProduits ?? 0))}
      </p>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-slate-muted">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-slate-700">{value}</p>
    </div>
  );
}

interface LockStatementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading: boolean;
  errorMessage: string | null;
  statementType: StatementType;
  onConfirm: () => Promise<void> | void;
}

function LockStatementDialog({
  open,
  onOpenChange,
  loading,
  errorMessage,
  statementType,
  onConfirm,
}: LockStatementDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="lock-statement-dialog">
        <DialogHeader>
          <DialogTitle>Verrouiller l&apos;état {statementType}</DialogTitle>
          <DialogDescription>
            Le verrouillage rend l&apos;état <strong>immutable</strong>. Si la période devient
            close après le lock, plus aucune régénération ne sera possible (cf. trigger DB).
            Vérifiez que les totaux sont corrects avant de confirmer.
          </DialogDescription>
        </DialogHeader>
        {errorMessage && (
          <p
            data-testid="lock-statement-error"
            className="rounded-md border border-state-error/30 bg-state-error/5 px-3 py-2 text-sm text-state-error"
          >
            {errorMessage}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Annuler
          </Button>
          <Button onClick={onConfirm} disabled={loading} data-testid="lock-statement-confirm">
            <Lock className="mr-1 h-4 w-4" />
            {loading ? 'Verrouillage…' : 'Verrouiller'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

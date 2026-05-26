'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  ArrowRight,
  CheckCircle2,
  FileSpreadsheet,
  Lock,
  Plus,
  Unlock,
} from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { ApiError } from '@/lib/api-client';
import { usePeriods } from '@/hooks/use-accounting';
import { useCreateStatement, useStatements } from '@/hooks/use-reporting';
import { usePermissions } from '@/hooks/use-permissions';
import {
  STATEMENT_TYPE_LABELS_FR,
  type CreateStatementInput,
  type FinancialStatementSummary,
  type StatementType,
} from '@/lib/api/reporting';

const STATEMENT_TYPES: StatementType[] = ['TER', 'BILAN', 'RESULTAT', 'FONDS_DEDIES'];

const CreateSchema = z.object({
  periodId: z.string().uuid('Période requise'),
  type: z.enum(['TER', 'BILAN', 'RESULTAT', 'FONDS_DEDIES']),
});
type CreateValues = z.infer<typeof CreateSchema>;

/**
 * Liste des états financiers — sprint F5b-b Lot C.
 *
 * Pour le BAILLEUR, le backend ne renvoie que les états `locked=true`
 * (filtre F5b-a Lot 1 dans financial-statement.service). La liste UI
 * affiche donc nativement la bonne vue.
 */
export default function StatementsListPage() {
  const router = useRouter();
  const perms = usePermissions();
  const [periodFilter, setPeriodFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | StatementType>('all');
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    if (!perms.canViewReporting()) {
      router.replace('/dashboard');
    }
  }, [perms, router]);

  const periodsQuery = usePeriods();
  const { data, isLoading, isError } = useStatements({
    periodId: periodFilter === 'all' ? undefined : periodFilter,
    type: typeFilter === 'all' ? undefined : typeFilter,
  });

  const statements = useMemo(() => {
    const list = data ?? [];
    // Tri : non-locked en premier (plus récents en haut), puis locked.
    return list.slice().sort((a, b) => {
      if (a.locked !== b.locked) return a.locked ? 1 : -1;
      return b.generatedAt.localeCompare(a.generatedAt);
    });
  }, [data]);

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <FileSpreadsheet className="h-6 w-6 text-ipd-darker" />
            États financiers
          </span>
        }
        subtitle="TER / Bilan / Résultat / Fonds dédiés — SYSCEBNL"
        actions={
          perms.canCreateStatement() && (
            <Button onClick={() => setCreateOpen(true)} data-testid="open-create-statement">
              <Plus className="mr-1 h-4 w-4" />
              Générer un état
            </Button>
          )
        }
      />

      <div className="px-8 py-6 space-y-4">
        {/* Filtres */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="space-y-1">
            <Label className="text-xs uppercase tracking-wide text-slate-muted">
              Période
            </Label>
            <select
              data-testid="period-filter"
              value={periodFilter}
              onChange={(e) => setPeriodFilter(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="all">Toutes les périodes</option>
              {(periodsQuery.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs uppercase tracking-wide text-slate-muted">Type</Label>
            <select
              data-testid="type-filter"
              value={typeFilter}
              onChange={(e) =>
                setTypeFilter(e.target.value === 'all' ? 'all' : (e.target.value as StatementType))
              }
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="all">Tous les types</option>
              {STATEMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {STATEMENT_TYPE_LABELS_FR[t]}
                </option>
              ))}
            </select>
          </div>
          <span className="ml-2 self-end pb-2 text-xs text-slate-muted">
            {statements.length} état{statements.length > 1 ? 's' : ''}
          </span>
        </div>

        {isLoading && <p className="text-sm text-slate-muted">Chargement…</p>}
        {isError && (
          <p className="text-sm text-state-error">Impossible de charger les états.</p>
        )}

        {!isLoading && statements.length === 0 && (
          <div
            data-testid="statements-empty"
            className="rounded-lg border border-dashed border-slate-200 p-12 text-center"
          >
            <p className="text-sm text-slate-muted">
              Aucun état généré. {perms.canCreateStatement() && 'Cliquez sur « Générer un état » pour en créer un.'}
            </p>
          </div>
        )}

        <div
          data-testid="statements-grid"
          className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3"
        >
          {statements.map((s) => (
            <StatementCard key={s.id} statement={s} />
          ))}
        </div>
      </div>

      <CreateStatementDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(id) => router.push(`/reporting/statements/${id}`)}
      />
    </div>
  );
}

function StatementCard({ statement }: { statement: FinancialStatementSummary }) {
  return (
    <Link
      href={`/reporting/statements/${statement.id}`}
      data-testid={`statement-card-${statement.id}`}
      data-locked={statement.locked ? 'true' : 'false'}
      data-type={statement.type}
      className="group block transition focus:outline-none focus:ring-2 focus:ring-ipd-dark focus:ring-offset-2"
    >
      <Card
        className={cn(
          'h-full border-2 transition hover:border-ipd hover:shadow-md',
          statement.locked && 'bg-slate-50',
        )}
      >
        <CardContent className="space-y-2 p-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-muted">
                {statement.type}
              </p>
              <p className="text-sm font-semibold text-ipd-darker">
                {STATEMENT_TYPE_LABELS_FR[statement.type]}
              </p>
            </div>
            {statement.locked ? (
              <Badge variant="muted" className="gap-1">
                <Lock className="h-3 w-3" />
                Verrouillé
              </Badge>
            ) : (
              <Badge variant="warning" className="gap-1">
                <Unlock className="h-3 w-3" />
                Brouillon
              </Badge>
            )}
          </div>
          <p className="text-xs text-slate-muted">
            Période : <strong className="text-slate-700">{statement.period?.code ?? '—'}</strong>
          </p>
          <p className="text-xs text-slate-muted">
            Généré le {new Date(statement.generatedAt).toLocaleDateString('fr-FR')}
          </p>
          {statement.totals.balanced ? (
            <p className="flex items-center gap-1 text-xs text-state-success">
              <CheckCircle2 className="h-3 w-3" /> Équilibré
            </p>
          ) : (
            <p className="text-xs text-state-error">⚠ Déséquilibré</p>
          )}
          <div className="flex justify-end pt-1 text-xs text-ipd-darker opacity-0 transition group-hover:opacity-100">
            Détail <ArrowRight className="ml-1 h-3 w-3" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

interface CreateStatementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (id: string) => void;
}

function CreateStatementDialog({ open, onOpenChange, onCreated }: CreateStatementDialogProps) {
  const periodsQuery = usePeriods();
  const createM = useCreateStatement();
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateValues>({
    resolver: zodResolver(CreateSchema),
    defaultValues: { periodId: '', type: 'TER' },
  });

  useEffect(() => {
    if (!open) {
      reset();
      setError(null);
    }
  }, [open, reset]);

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      const created = await createM.mutateAsync(values as CreateStatementInput);
      onCreated(created.id);
    } catch (e: unknown) {
      if (e instanceof ApiError) {
        setError(`Erreur ${e.status} — ${e.body.message ?? 'cas métier'}`);
      } else if (e instanceof Error) {
        setError(e.message);
      } else {
        setError('Erreur inconnue');
      }
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="create-statement-dialog">
        <DialogHeader>
          <DialogTitle>Générer un état financier</DialogTitle>
          <DialogDescription>
            Choisissez une période et le type d&apos;état. Si un état existe déjà pour ce couple,
            il sera régénéré (sauf s&apos;il est verrouillé).
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs uppercase tracking-wide text-slate-muted">Période</Label>
            <select
              data-testid="create-period"
              {...register('periodId')}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">— Choisir une période —</option>
              {(periodsQuery.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} ({p.startDate} → {p.endDate}) {p.isClosed ? '· close' : ''}
                </option>
              ))}
            </select>
            {errors.periodId && (
              <p className="text-xs text-state-error">{errors.periodId.message}</p>
            )}
          </div>
          <div className="space-y-1">
            <Label className="text-xs uppercase tracking-wide text-slate-muted">Type</Label>
            <select
              data-testid="create-type"
              {...register('type')}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {STATEMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {STATEMENT_TYPE_LABELS_FR[t]}
                </option>
              ))}
            </select>
          </div>
          {error && (
            <p
              data-testid="create-statement-error"
              className="rounded-md border border-state-error/30 bg-state-error/5 px-3 py-2 text-sm text-state-error"
            >
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={createM.isPending}
            >
              Annuler
            </Button>
            <Button
              type="submit"
              disabled={createM.isPending}
              data-testid="create-statement-submit"
            >
              {createM.isPending ? 'Génération…' : 'Générer'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

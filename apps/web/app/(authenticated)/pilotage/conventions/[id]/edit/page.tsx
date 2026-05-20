'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/button';
import {
  GrantForm,
  formValuesToCreateInput,
  grantToFormValues,
  type GrantFormValues,
} from '@/components/pilotage/GrantForm';
import { usePermissions } from '@/hooks/use-permissions';
import { useGrantTransactions } from '@/hooks/use-pilotage';
import { getGrant, updateGrant } from '@/lib/api/referential';
import { ApiError } from '@/lib/api-client';

/**
 * Édition d'une convention existante — CG / SUPER_ADMIN.
 *
 * Si le grant a des transactions actives (au moins une journal_line
 * posted), le formulaire désactive les FK et la devise pour préserver
 * la cohérence comptable (cf. GrantForm — lockHard).
 *
 * Note : le backend (GrantService.update) accepte la requête mais
 * `GrantHasTransactionsException` est levée par /grants/:id DELETE,
 * pas PATCH. L'édition reste donc possible mais on protège côté UI
 * les champs critiques.
 */
export default function EditConventionPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const grantId = params.id;
  const perms = usePermissions();
  const { data: session } = useSession();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accessToken = session?.accessToken ?? null;

  const grantQuery = useQuery({
    queryKey: ['grant', grantId, 'edit'],
    enabled: !!grantId && !!accessToken,
    queryFn: () => getGrant(grantId, { accessToken }),
  });

  // On regarde les transactions sur 24 mois pour détecter une activité
  // comptable — heuristique suffisante (le backend ne propose pas pour
  // l'instant d'endpoint /grants/:id/has-transactions).
  const { data: txData } = useGrantTransactions(grantId, { type: 'all' });
  const hasActiveTransactions = (txData?.total ?? 0) > 0;

  useEffect(() => {
    if (!perms.canParameterGrant()) {
      router.replace(`/pilotage/conventions/${grantId}`);
    }
  }, [perms, router, grantId]);

  const defaults = useMemo<Partial<GrantFormValues> | undefined>(() => {
    if (!grantQuery.data) return undefined;
    return grantToFormValues(grantQuery.data);
  }, [grantQuery.data]);

  const handleSubmit = async (values: GrantFormValues) => {
    setSubmitting(true);
    setError(null);
    try {
      await updateGrant(grantId, formValuesToCreateInput(values), { accessToken });
      router.push(`/pilotage/conventions/${grantId}`);
    } catch (e: unknown) {
      if (e instanceof ApiError) {
        setError(`Erreur ${e.status} — ${e.body.message ?? 'cas métier'}${e.body.code ? ` (${e.body.code})` : ''}`);
      } else if (e instanceof Error) {
        setError(e.message);
      } else {
        setError('Erreur inconnue lors de la mise à jour.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHeader
        title="Paramétrer la convention"
        subtitle={grantQuery.data?.reference ?? 'Chargement…'}
        actions={
          <Button
            variant="outline"
            onClick={() => router.push(`/pilotage/conventions/${grantId}`)}
          >
            <ArrowLeft className="mr-1 h-4 w-4" />
            Retour
          </Button>
        }
      />
      <div className="mx-auto max-w-3xl px-8 py-6">
        {grantQuery.isLoading && (
          <p className="text-sm text-slate-muted">Chargement de la convention…</p>
        )}
        {grantQuery.isError && (
          <p className="text-sm text-state-error">Convention introuvable.</p>
        )}
        {defaults && (
          <GrantForm
            mode="edit"
            defaultValues={defaults}
            hasActiveTransactions={hasActiveTransactions}
            loading={submitting}
            errorMessage={error}
            onCancel={() => router.push(`/pilotage/conventions/${grantId}`)}
            onSubmit={handleSubmit}
          />
        )}
      </div>
    </div>
  );
}

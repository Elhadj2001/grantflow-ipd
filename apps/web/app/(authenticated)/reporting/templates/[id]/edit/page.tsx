'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Info, Save } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  AccountMappingTable,
  type NewMappingDraft,
} from '@/components/reporting/AccountMappingTable';
import { useAddTemplateMappings, useDonorTemplate } from '@/hooks/use-reporting';
import { usePermissions } from '@/hooks/use-permissions';
import { ApiError } from '@/lib/api-client';

/**
 * Édition d'un template — limitée aux mappings.
 *
 * Limitation backend connue (F5a-C0) :
 *   - Pas de PATCH /templates/:id (code/name/donor/currency immutables)
 *   - Pas d'ajout de catégorie après création
 *   - POST /templates/:id/mappings est un upsert (PK templateId + glAccountCode)
 *
 * Un banner orange explicite ces contraintes pour éviter les frustrations.
 */
export default function EditTemplatePage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const templateId = params.id;
  const perms = usePermissions();
  const { data, isLoading } = useDonorTemplate(templateId);
  const addM = useAddTemplateMappings(templateId);
  const [drafts, setDrafts] = useState<NewMappingDraft[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!perms.canManageDonorTemplate()) {
      router.replace(`/reporting/templates/${templateId}`);
    }
  }, [perms, router, templateId]);

  const handleSave = async () => {
    setError(null);
    const valid = drafts.filter((d) => d.glAccountCode && d.categoryCode);
    if (valid.length === 0) {
      setError('Au moins un mapping valide est requis (compte + catégorie).');
      return;
    }
    try {
      await addM.mutateAsync({ mappings: valid });
      setDrafts([]);
      router.push(`/reporting/templates/${templateId}`);
    } catch (e: unknown) {
      if (e instanceof ApiError) {
        setError(`Erreur ${e.status} — ${e.body.message ?? 'cas métier'}`);
      } else if (e instanceof Error) {
        setError(e.message);
      } else {
        setError('Erreur inconnue');
      }
    }
  };

  if (isLoading) {
    return <div className="px-8 py-6 text-sm text-slate-muted">Chargement…</div>;
  }
  if (!data) {
    return (
      <div className="px-8 py-6">
        <p className="text-sm text-state-error">Template introuvable.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHeader
        title={`Édition mappings — ${data.code}`}
        subtitle={data.name}
        actions={
          <Button
            variant="outline"
            onClick={() => router.push(`/reporting/templates/${templateId}`)}
          >
            <ArrowLeft className="mr-1 h-4 w-4" />
            Retour
          </Button>
        }
      />

      <div className="mx-auto max-w-4xl space-y-4 px-8 py-6">
        <div
          data-testid="edit-limits-banner"
          className="flex items-start gap-2 rounded-md border border-state-warning/30 bg-state-warning/5 px-3 py-2 text-sm text-state-warning"
        >
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Édition limitée aux <strong>mappings comptes ↔ catégories</strong>. Le code, le nom,
            le bailleur, la devise et la liste de catégories sont immuables après création.
            Pour modifier ces éléments, créez un nouveau template.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Mappings existants &amp; nouveaux</CardTitle>
            <p className="text-xs text-slate-muted">
              Si vous ré-ajoutez un compte déjà mappé, sa catégorie/sign sera <em>mise à jour</em>{' '}
              (upsert côté backend).
            </p>
          </CardHeader>
          <CardContent>
            <AccountMappingTable
              existing={data.mappings}
              categories={data.categories}
              editable
              onChange={setDrafts}
            />
          </CardContent>
        </Card>

        {error && (
          <p
            data-testid="edit-error"
            className="rounded-md border border-state-error/30 bg-state-error/5 px-3 py-2 text-sm text-state-error"
          >
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => router.push(`/reporting/templates/${templateId}`)}
          >
            Annuler
          </Button>
          <Button
            onClick={handleSave}
            disabled={addM.isPending || drafts.length === 0}
            data-testid="save-mappings"
          >
            <Save className="mr-1 h-4 w-4" />
            {addM.isPending ? 'Enregistrement…' : `Enregistrer ${drafts.length} mapping${drafts.length > 1 ? 's' : ''}`}
          </Button>
        </div>
      </div>
    </div>
  );
}

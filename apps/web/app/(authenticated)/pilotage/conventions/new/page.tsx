'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/button';
import {
  formValuesToCreateInput,
  GrantForm,
  type GrantFormValues,
} from '@/components/pilotage/GrantForm';
import { usePermissions } from '@/hooks/use-permissions';
import { createGrant } from '@/lib/api/referential';
import { ApiError } from '@/lib/api-client';

/**
 * Création d'une convention bailleur — CG / SUPER_ADMIN uniquement.
 *
 * Soumet POST /grants ; redirige vers le détail si succès. Capture les
 * erreurs métier classiques (BUSINESS.DUPLICATE_CODE, BUSINESS.INACTIVE_*)
 * et les remonte au formulaire pour affichage.
 */
export default function NewConventionPage() {
  const router = useRouter();
  const perms = usePermissions();
  const { data: session } = useSession();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!perms.canParameterGrant()) {
      router.replace('/pilotage/conventions');
    }
  }, [perms, router]);

  const handleSubmit = async (values: GrantFormValues) => {
    setSubmitting(true);
    setError(null);
    try {
      const grant = await createGrant(formValuesToCreateInput(values), {
        accessToken: session?.accessToken ?? null,
      });
      router.push(`/pilotage/conventions/${grant.id}`);
    } catch (e: unknown) {
      if (e instanceof ApiError) {
        setError(`Erreur ${e.status} — ${e.body.message ?? 'cas métier'}${e.body.code ? ` (${e.body.code})` : ''}`);
      } else if (e instanceof Error) {
        setError(e.message);
      } else {
        setError('Erreur inconnue lors de la création.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHeader
        title="Nouvelle convention"
        subtitle="Création d'un grant bailleur"
        actions={
          <Button variant="outline" onClick={() => router.push('/pilotage/conventions')}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            Retour
          </Button>
        }
      />
      <div className="mx-auto max-w-3xl px-8 py-6">
        <GrantForm
          mode="create"
          loading={submitting}
          errorMessage={error}
          onCancel={() => router.push('/pilotage/conventions')}
          onSubmit={handleSubmit}
        />
      </div>
    </div>
  );
}

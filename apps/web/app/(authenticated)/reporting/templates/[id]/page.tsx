'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, BadgeCheck, FileSpreadsheet, Pencil } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DonorCategoryTreeView } from '@/components/reporting/DonorCategoryTreeView';
import { AccountMappingTable } from '@/components/reporting/AccountMappingTable';
import { OFFICIAL_TEMPLATE_CODES } from '@/lib/api/reporting';
import { useDonorTemplate } from '@/hooks/use-reporting';
import { usePermissions } from '@/hooks/use-permissions';

/**
 * Détail Template — visualise catégories + mappings.
 *
 * Édition réservée aux CG/SUPER_ADMIN via `/edit` (ajout/upsert de
 * mappings uniquement — cf. limitations backend F5a-C0). Le détail
 * reste accessible à tous les rôles `canViewReporting`.
 */
export default function TemplateDetailPage() {
  const params = useParams<{ id: string }>();
  const templateId = params.id;
  const perms = usePermissions();
  const { data, isLoading, isError } = useDonorTemplate(templateId);

  if (isLoading) {
    return <div className="px-8 py-6 text-sm text-slate-muted">Chargement du template…</div>;
  }

  if (isError || !data) {
    return (
      <div className="px-8 py-6">
        <p className="text-sm text-state-error">Template introuvable ou accès refusé.</p>
        <Button asChild variant="outline" className="mt-3">
          <Link href="/reporting/templates">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Retour aux templates
          </Link>
        </Button>
      </div>
    );
  }

  const isOfficial = OFFICIAL_TEMPLATE_CODES.has(data.code);

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <Link
              href="/reporting/templates"
              className="text-slate-muted transition hover:text-ipd-darker"
              aria-label="Retour aux templates"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <span>{data.code}</span>
            {isOfficial && (
              <Badge variant="default" className="gap-1">
                <BadgeCheck className="h-3 w-3" />
                Officiel
              </Badge>
            )}
          </span>
        }
        subtitle={data.name}
        actions={
          perms.canManageDonorTemplate() && (
            <Button asChild variant="outline" size="sm" data-testid="edit-mappings-button">
              <Link href={`/reporting/templates/${templateId}/edit`}>
                <Pencil className="mr-1 h-4 w-4" />
                Éditer les mappings
              </Link>
            </Button>
          )
        }
      />

      <div className="space-y-6 px-8 py-6">
        {/* Header info */}
        <Card>
          <CardContent className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
            <Stat label="Bailleur" value={data.donor?.label ?? 'Multi-bailleurs'} />
            <Stat label="Devise" value={data.currency} />
            <Stat label="Catégories" value={String(data.categories.length)} />
            <Stat label="Mappings" value={String(data.mappings.length)} />
          </CardContent>
        </Card>

        {/* Catégories */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileSpreadsheet className="h-4 w-4 text-ipd-darker" />
              Catégories bailleur
            </CardTitle>
            <p className="text-xs text-slate-muted">
              Hiérarchie configurée à la création (immutable après).
            </p>
          </CardHeader>
          <CardContent>
            <DonorCategoryTreeView categories={data.categories} />
          </CardContent>
        </Card>

        {/* Mappings */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Mappings comptes SYSCEBNL → catégories</CardTitle>
          </CardHeader>
          <CardContent>
            <AccountMappingTable existing={data.mappings} categories={data.categories} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-slate-muted">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-ipd-darker">{value}</p>
    </div>
  );
}

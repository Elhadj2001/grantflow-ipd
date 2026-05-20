'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { FileSpreadsheet, Plus, Search } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DonorTemplateCard } from '@/components/reporting/DonorTemplateCard';
import { useDonorTemplates } from '@/hooks/use-reporting';
import { usePermissions } from '@/hooks/use-permissions';

/**
 * Liste des templates de rapport bailleur — CG / DAF / SUPER_ADMIN.
 *
 * Le BAILLEUR n'accède PAS à cette page (la sidebar redirige vers
 * /donor-reports), mais on garde un voile UI : si le rôle ne couvre
 * pas `canCreateDonorReport`, le bouton "Créer template" est caché.
 *
 * Recherche client-side sur code + nom (les templates sont peu
 * nombreux — pas besoin de pagination serveur).
 */
export default function TemplatesListPage() {
  const perms = usePermissions();
  const [search, setSearch] = useState('');
  const { data, isLoading, isError } = useDonorTemplates();

  const filtered = useMemo(() => {
    const list = data ?? [];
    if (!search.trim()) return list;
    const needle = search.toLowerCase();
    return list.filter(
      (t) => t.code.toLowerCase().includes(needle) || t.name.toLowerCase().includes(needle),
    );
  }, [data, search]);

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <FileSpreadsheet className="h-6 w-6 text-ipd-darker" />
            Templates de reporting bailleur
          </span>
        }
        subtitle="Mappings comptes SYSCEBNL → catégories bailleur (USAID, OMS, etc.)"
        actions={
          perms.canManageDonorTemplate() && (
            <Button asChild data-testid="create-template-button">
              <Link href="/reporting/templates/new">
                <Plus className="mr-1 h-4 w-4" />
                Nouveau template
              </Link>
            </Button>
          )
        }
      />

      <div className="px-8 py-6">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-muted" />
            <Input
              data-testid="search-templates"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher (code, nom)…"
              className="w-72 pl-9"
            />
          </div>
          <span className="text-xs text-slate-muted">
            {filtered.length} template{filtered.length > 1 ? 's' : ''}
          </span>
        </div>

        {isLoading && <p className="text-sm text-slate-muted">Chargement…</p>}
        {isError && (
          <p className="text-sm text-state-error">Impossible de charger les templates.</p>
        )}

        {!isLoading && filtered.length === 0 && (
          <div
            data-testid="empty-templates"
            className="rounded-lg border border-dashed border-slate-200 p-12 text-center"
          >
            <p className="text-sm text-slate-muted">
              Aucun template ne correspond à votre recherche.{' '}
              {perms.canManageDonorTemplate() && (
                <Link
                  href="/reporting/templates/new"
                  className="font-medium text-ipd-darker underline"
                >
                  Créer le premier template
                </Link>
              )}
            </p>
          </div>
        )}

        <div
          data-testid="template-grid"
          className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
        >
          {filtered.map((t) => (
            <DonorTemplateCard key={t.id} template={t} />
          ))}
        </div>
      </div>
    </div>
  );
}

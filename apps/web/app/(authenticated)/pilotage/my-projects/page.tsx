'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { FolderOpen, ShieldOff } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/button';
import { GrantSummaryCard } from '@/components/pilotage/GrantSummaryCard';
import type { GrantBadgeStatus } from '@/components/pilotage/GrantStatusBadge';
import { useMyProjects } from '@/hooks/use-pilotage';
import { usePermissions } from '@/hooks/use-permissions';
import type { MyProjectGrant } from '@/lib/api/pilotage';

/**
 * Page "Mes Projets" — exclusivement pour les Principal Investigators.
 *
 * Liste les projets dont l'utilisateur est piUserId, regroupant les
 * grants associés (cards). Sécurité cross-PI : l'endpoint backend
 * /pilotage/grants/my-projects filtre strictement par
 * `project.piUserId = caller.app_user.id`. Un PI A ne voit donc JAMAIS
 * les projets du PI B, même en manipulant l'URL.
 *
 * Côté UI : si l'utilisateur n'a pas le rôle PI ni SUPER_ADMIN, on
 * affiche un état "accès refusé" (le backend lèvera 403 de toutes
 * façons via @Roles, mais on évite un mauvais visuel).
 */
export default function MyProjectsPage() {
  const router = useRouter();
  const perms = usePermissions();
  const { data, isLoading, isError } = useMyProjects();

  // Si l'utilisateur n'est ni PI ni SUPER_ADMIN, redirection vers le
  // portefeuille global (CG/DAF) ou le dashboard si rien d'autre n'est
  // accessible.
  useEffect(() => {
    if (!perms.canViewMyProjects()) {
      if (perms.canViewGrantPortfolio()) {
        router.replace('/pilotage/conventions');
      } else {
        router.replace('/dashboard');
      }
    }
  }, [perms, router]);

  if (!perms.canViewMyProjects()) {
    return (
      <div className="px-8 py-12 text-center">
        <ShieldOff className="mx-auto h-10 w-10 text-state-error" />
        <p className="mt-2 text-sm text-slate-muted">Accès réservé aux Principal Investigators.</p>
      </div>
    );
  }

  const projects = data?.data ?? [];
  const allGrants: Array<{ projectTitle: string; projectCode: string; grant: MyProjectGrant }> =
    projects.flatMap((p) =>
      p.grants.map((g) => ({ projectTitle: p.title, projectCode: p.code, grant: g })),
    );

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <FolderOpen className="h-6 w-6 text-ipd-darker" />
            Mes projets
          </span>
        }
        subtitle="Conventions dont vous êtes le Principal Investigator"
      />

      <div className="px-8 py-6 space-y-6">
        {isLoading && <p className="text-sm text-slate-muted">Chargement…</p>}
        {isError && (
          <p className="text-sm text-state-error">Impossible de charger vos projets.</p>
        )}

        {!isLoading && projects.length === 0 && (
          <div
            data-testid="my-projects-empty"
            className="rounded-lg border border-dashed border-slate-200 p-12 text-center"
          >
            <p className="text-sm text-slate-muted">
              Aucun projet ne vous est rattaché en tant que PI. Contactez votre Contrôleur de Gestion
              si vous pensez qu'il s'agit d'une erreur.
            </p>
          </div>
        )}

        {projects.map((p) => (
          <section key={p.id} data-testid={`my-project-${p.code}`} className="space-y-3">
            <header className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-ipd-darker">{p.title}</h2>
                <p className="text-xs text-slate-muted">
                  Code projet : {p.code} · Status : {p.status}
                </p>
              </div>
              <span className="rounded-full bg-ipd-50 px-3 py-1 text-xs font-semibold text-ipd-darker">
                {p.grants.length} grant{p.grants.length > 1 ? 's' : ''}
              </span>
            </header>

            {p.grants.length === 0 ? (
              <p className="rounded-md border border-dashed border-slate-200 px-4 py-3 text-sm text-slate-muted">
                Aucun grant actif sur ce projet.
              </p>
            ) : (
              <div
                data-testid={`my-project-grants-${p.code}`}
                className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
              >
                {p.grants.map((g) => (
                  <GrantSummaryCard
                    key={g.id}
                    id={g.id}
                    reference={g.reference}
                    donorLabel={g.donorLabel}
                    projectTitle={p.title}
                    amount={g.amount}
                    currency={g.currency}
                    startDate={g.startDate}
                    endDate={g.endDate}
                    status={grantStatusToBadge(g)}
                    budgeted={g.amount}
                    consumed={0}
                    engaged={0}
                    href={`/pilotage/conventions/${g.id}`}
                  />
                ))}
              </div>
            )}
          </section>
        ))}

        {allGrants.length > 0 && (
          <footer className="pt-4 text-center">
            <Button asChild variant="outline" size="sm">
              <Link href="/pilotage/conventions">Voir le portefeuille complet (si autorisé)</Link>
            </Button>
          </footer>
        )}
      </div>
    </div>
  );
}

function grantStatusToBadge(g: MyProjectGrant): GrantBadgeStatus {
  if (g.status === 'closed') return 'closed';
  if (g.status === 'suspended') return 'suspended';
  if (g.status === 'draft') return 'draft';
  const today = new Date();
  const end = new Date(g.endDate);
  if (end < today) return 'expired';
  const daysLeft = Math.ceil((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (daysLeft <= 90) return 'expiring';
  return 'active';
}

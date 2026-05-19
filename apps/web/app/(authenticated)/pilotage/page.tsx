'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { usePermissions } from '@/hooks/use-permissions';

/**
 * Entrée Pilotage : redirige vers la vue la plus adaptée au rôle.
 *  - CG/DAF/SUPER_ADMIN → /pilotage/conventions (portefeuille global)
 *  - PI (sans rôle CG)  → /pilotage/my-projects (vue restreinte)
 *  - Sinon              → /dashboard
 *
 * Mounted=client uniquement, mais le sidebar a déjà gaté l'accès via
 * usePermissions — ce redirect est juste un confort.
 */
export default function PilotageIndexPage() {
  const router = useRouter();
  const perms = usePermissions();

  useEffect(() => {
    if (perms.canViewGrantPortfolio()) {
      router.replace('/pilotage/conventions');
    } else if (perms.canViewMyProjects()) {
      router.replace('/pilotage/my-projects');
    } else {
      router.replace('/dashboard');
    }
  }, [perms, router]);

  return <div className="px-8 py-12 text-sm text-slate-muted">Redirection…</div>;
}

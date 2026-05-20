'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { usePermissions } from '@/hooks/use-permissions';

/**
 * Entrée Reporting : redirige selon rôle.
 *  - CG/DAF/SUPER_ADMIN → /reporting/templates (gestion templates)
 *  - BAILLEUR           → /reporting/donor-reports (vue rapports envoyés)
 *  - Sinon              → /dashboard
 */
export default function ReportingIndexPage() {
  const router = useRouter();
  const perms = usePermissions();

  useEffect(() => {
    if (perms.canManageDonorTemplate() || perms.canCreateDonorReport()) {
      router.replace('/reporting/templates');
    } else if (perms.canViewReporting()) {
      router.replace('/reporting/donor-reports');
    } else {
      router.replace('/dashboard');
    }
  }, [perms, router]);

  return <div className="px-8 py-12 text-sm text-slate-muted">Redirection…</div>;
}

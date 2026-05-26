'use client';

import Link from 'next/link';
import { FilePlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePermissions } from '@/hooks/use-permissions';

/**
 * Actions à droite du PageHeader du dashboard.
 *
 * Sprint F-DASHBOARD :
 *   - "Exporter" RETIRÉ : pas de cible claire pour un export "dashboard"
 *     générique (il existe des exports ciblés dans chaque module — DA,
 *     factures, états financiers, etc.). Plutôt que de laisser un bouton
 *     `disabled` trompeur, on le supprime.
 *   - "Nouvelle DA" : actif uniquement si l'utilisateur peut créer une DA
 *     (canCreatePR : DEMANDEUR / PI / SUPER_ADMIN), sinon masqué — on ne
 *     veut pas afficher un bouton désactivé pour un BAILLEUR ou un MAGASINIER.
 */
export function DashboardHeaderActions() {
  const perms = usePermissions();
  if (!perms.canCreatePR()) return null;
  return (
    <Button asChild size="sm" data-testid="dashboard-new-pr">
      <Link href="/procurement/purchase-requests/new">
        <FilePlus className="mr-2 h-4 w-4" aria-hidden />
        Nouvelle DA
      </Link>
    </Button>
  );
}

'use client';

import { FileBarChart, FilePlus, Receipt, Send } from 'lucide-react';
import { ShortcutCard } from '@/components/common/ShortcutCard';
import { usePermissions } from '@/hooks/use-permissions';

/**
 * Grille des 4 raccourcis du dashboard.
 *
 * Sprint F-DASHBOARD : chaque raccourci pointe vers la route réelle du
 * module correspondant et n'est cliquable que si le rôle a la permission
 * associée. Pour les rôles non-autorisés, la carte reste affichée mais
 * désactivée (placeholder).
 *
 * Cartographie raccourci → permission → route :
 *   - Créer une DA       canCreatePR()           /procurement/purchase-requests/new
 *   - Suivre factures    canViewInvoice()        /accounting/invoices
 *   - Lancer un paiement canCreatePaymentRun()   /treasury/payment-runs/new
 *   - Rapport bailleur   canViewReporting()      /reporting/donor-reports
 */
export function DashboardShortcuts() {
  const perms = usePermissions();
  return (
    <div
      data-testid="dashboard-shortcuts"
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
    >
      <ShortcutCard
        icon={FilePlus}
        title="Créer une DA"
        description="Saisir une demande d'achat avec imputation analytique."
        href={perms.canCreatePR() ? '/procurement/purchase-requests/new' : undefined}
      />
      <ShortcutCard
        icon={Receipt}
        title="Suivre factures"
        description="3-way matching et comptabilisation des factures fournisseurs."
        href={perms.canViewInvoice() ? '/accounting/invoices' : undefined}
      />
      <ShortcutCard
        icon={Send}
        title="Lancer un paiement"
        description="PaymentRun + export SEPA pain.001 multi-bénéficiaires."
        href={
          perms.canCreatePaymentRun() ? '/treasury/payment-runs/new' : undefined
        }
      />
      <ShortcutCard
        icon={FileBarChart}
        title="Rapport bailleur"
        description="USAID FFR-425, OMS, Wellcome — PDF + Excel."
        href={perms.canViewReporting() ? '/reporting/donor-reports' : undefined}
      />
    </div>
  );
}

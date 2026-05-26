'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BookOpenCheck,
  Building2,
  Calculator,
  CalendarCheck,
  FileBarChart,
  LayoutDashboard,
  Package,
  ShoppingCart,
  Target,
  Truck,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePermissions } from '@/hooks/use-permissions';
import { SystemStatus } from './SystemStatus';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  disabled?: boolean;
  /** Préfixe à utiliser pour matcher l'état "actif" (par défaut = href). */
  matchPrefix?: string;
  /**
   * Préfixes additionnels — quand un item couvre plusieurs sous-sections
   * (ex. Reporting = /templates + /donor-reports, mais pas /statements
   * qui a sa propre entrée). Si défini, supplante `matchPrefix`.
   */
  matchPrefixes?: string[];
}

interface SidebarNavItem extends NavItem {
  /**
   * Si défini, l'item n'est rendu que si le helper renvoie true.
   * `perms` est l'objet `usePermissions()` complet — on appelle le helper
   * pertinent à l'intérieur (les rôles peuvent évoluer entre sprints).
   */
  visible?: (perms: ReturnType<typeof usePermissions>) => boolean;
}

const NAV: SidebarNavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  {
    href: '/procurement/purchase-requests',
    label: 'Achats',
    icon: ShoppingCart,
    // Resserré : ne doit pas s'activer sur Réception / Inventaire (entrées dédiées ci-dessous).
    matchPrefixes: [
      '/procurement/purchase-requests',
      '/procurement/purchase-orders',
      '/procurement/goods-receipts',
    ],
  },
  {
    href: '/procurement/reception-rapide',
    label: 'Réception',
    icon: Truck,
    matchPrefix: '/procurement/reception-rapide',
    visible: (p) => p.canReceive(),
  },
  {
    href: '/procurement/inventaire-scan',
    label: 'Inventaire / Scan',
    icon: Package,
    matchPrefix: '/procurement/inventaire-scan',
    visible: (p) => p.canReceive(),
  },
  {
    href: '/accounting/invoices',
    label: 'Comptabilité',
    icon: Calculator,
    // Matche /accounting/invoices/* — la sous-section clôture a son propre item.
    matchPrefix: '/accounting/invoices',
  },
  {
    // Sprint F5b-b : clôture mensuelle — workflow périodes / FNP / CCA-PCA / fonds dédiés.
    // Réservé rôles finance internes (canViewClosure). Le BAILLEUR ne voit pas
    // cette entrée — workflow purement interne.
    href: '/accounting/periods',
    label: 'Clôture',
    icon: CalendarCheck,
    matchPrefix: '/accounting/periods',
    visible: (p) => p.canViewClosure(),
  },
  {
    href: '/treasury/payment-runs',
    label: 'Trésorerie',
    icon: Wallet,
    matchPrefix: '/treasury',
  },
  {
    // Pilotage : sprint F-PILOTAGE — visible pour CG/DAF/SUPER_ADMIN
    // (portefeuille) et PI (Mes Projets). L'entrée pointe sur /pilotage,
    // qui redirige côté client vers /conventions (CG) ou /my-projects (PI).
    href: '/pilotage',
    label: 'Pilotage',
    icon: Target,
    matchPrefix: '/pilotage',
    visible: (p) => p.canViewGrantPortfolio() || p.canViewMyProjects(),
  },
  {
    // Reporting bailleur : sprint F5a — visible CG / DAF / BAILLEUR / SA.
    // Point d'entrée par défaut : templates (CG/DAF). Le BAILLEUR sera
    // redirigé vers /donor-reports (vue filtrée sent only) par la page index.
    href: '/reporting',
    label: 'Reporting',
    icon: FileBarChart,
    // Couvre templates + donor-reports + /reporting nu (index redirect).
    // /reporting/statements a son propre item ci-dessous.
    matchPrefixes: ['/reporting/templates', '/reporting/donor-reports'],
    visible: (p) => p.canViewReporting(),
  },
  {
    // Sprint F5b-b : états financiers SYSCEBNL (TER/BILAN/RESULTAT/FONDS_DEDIES).
    // Visible si l'utilisateur peut générer (COMPTABLE/CG/DAF/SA) ou
    // consulter en tant que BAILLEUR (locked uniquement, filtre serveur).
    href: '/reporting/statements',
    label: 'États financiers',
    icon: BookOpenCheck,
    matchPrefix: '/reporting/statements',
    visible: (p) => p.canViewReporting() || p.canCreateStatement(),
  },
  {
    // Sprint F5b-c : référentiel Fournisseurs (CRUD).
    // Visible pour ACHETEUR / CONTROLEUR / DAF / SUPER_ADMIN — gating
    // identique à @Roles backend POST /suppliers.
    href: '/referential/suppliers',
    label: 'Fournisseurs',
    icon: Building2,
    matchPrefix: '/referential/suppliers',
    visible: (p) => p.canManageSuppliers(),
  },
  {
    // Sprint F-ADMIN-USERS : gestion des utilisateurs.
    // Visible uniquement pour SUPER_ADMIN / DAF — aligné sur @Roles
    // backend AdminUsersController.
    href: '/admin/users',
    label: 'Utilisateurs',
    icon: Users,
    matchPrefix: '/admin/users',
    visible: (p) => p.canManageUsers(),
  },
];

/**
 * Sidebar fixe à gauche, 240px, fond cream. 5 entrées dont Dashboard
 * actif. Sprint F1.1 — ajout du bloc SystemStatus en bas (ping
 * /health toutes les 30 s).
 */
export function AppSidebar() {
  const pathname = usePathname();
  const perms = usePermissions();
  const items = NAV.filter((it) => (it.visible ? it.visible(perms) : true));
  return (
    <aside
      data-testid="app-sidebar"
      className="hidden md:flex w-60 shrink-0 flex-col border-r border-slate-200 bg-cream"
    >
      <nav className="flex-1 py-4">
        <ul className="space-y-1 px-2">
          {items.map((item) => {
            const prefixes = item.matchPrefixes ?? [item.matchPrefix ?? item.href];
            const active =
              pathname === item.href ||
              prefixes.some((p) => pathname === p || pathname.startsWith(p + '/'));
            const Icon = item.icon;
            const baseClasses =
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors border-l-4 border-transparent';

            if (item.disabled) {
              return (
                <li key={item.href}>
                  <span
                    aria-disabled="true"
                    title="Disponible dans un sprint suivant"
                    className={cn(baseClasses, 'cursor-not-allowed text-slate-muted opacity-50')}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </span>
                </li>
              );
            }

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    baseClasses,
                    active
                      ? 'bg-ipd-50 text-ipd-darker border-l-ipd'
                      : 'text-slate-text hover:bg-ipd-50/60 hover:text-ipd-darker',
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="border-t border-slate-200 px-4 py-3 space-y-2">
        <SystemStatus />
        <div className="text-xs text-slate-muted">v0.11.1 — Sprint F1.1</div>
      </div>
    </aside>
  );
}

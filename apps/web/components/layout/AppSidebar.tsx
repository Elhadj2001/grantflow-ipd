'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  BookOpenCheck,
  Building2,
  Calculator,
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  FileBarChart,
  FolderKanban,
  HandCoins,
  LayoutDashboard,
  LogOut,
  Package,
  ShoppingCart,
  Target,
  Truck,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { GrantflowRole } from '@/lib/auth';
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

interface NavGroup {
  /** Titre du groupe (null = pas de titre, ex. Dashboard seul en tête). */
  titre: string | null;
  items: SidebarNavItem[];
}

/**
 * Navigation GRANTFLOW inchangée (mêmes hrefs, matchPrefixes et gating par
 * rôle qu'avant la refonte) — simplement GROUPÉE façon charte 2025.
 */
const GROUPES: NavGroup[] = [
  {
    titre: null,
    items: [{ href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard }],
  },
  {
    titre: 'Opérations',
    items: [
      {
        href: '/procurement/purchase-requests',
        label: 'Achats',
        icon: ShoppingCart,
        // Sprint F-DASHBOARD : matchPrefix resserré aux vraies sous-pages
        // d'Achats (DA / BC / GR).
        matchPrefixes: [
          '/procurement/purchase-requests',
          '/procurement/purchase-orders',
          '/procurement/goods-receipts',
        ],
      },
      {
        // Workflow Réception (tablette/mobile) — MAGASINIER / SUPER_ADMIN.
        href: '/procurement/reception-rapide',
        label: 'Réception',
        icon: Truck,
        matchPrefix: '/procurement/reception-rapide',
        visible: (p) => p.canReceive(),
      },
      {
        // Scan d'inventaire — même gating que Réception.
        href: '/procurement/inventaire-scan',
        label: 'Inventaire / Scan',
        icon: Package,
        matchPrefix: '/procurement/inventaire-scan',
        visible: (p) => p.canReceive(),
      },
    ],
  },
  {
    titre: 'Finance',
    items: [
      {
        href: '/accounting/invoices',
        label: 'Comptabilité',
        icon: Calculator,
        matchPrefix: '/accounting/invoices',
      },
      {
        // Sprint F5b-b : clôture mensuelle — rôles finance internes.
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
    ],
  },
  {
    titre: 'Pilotage & reporting',
    items: [
      {
        // Sprint F-PILOTAGE — CG/DAF/SA (portefeuille) et PI (Mes Projets).
        href: '/pilotage',
        label: 'Pilotage',
        icon: Target,
        matchPrefix: '/pilotage',
        visible: (p) => p.canViewGrantPortfolio() || p.canViewMyProjects(),
      },
      {
        // Reporting bailleur (F5a) — templates + donor-reports.
        href: '/reporting',
        label: 'Reporting',
        icon: FileBarChart,
        matchPrefixes: ['/reporting/templates', '/reporting/donor-reports'],
        visible: (p) => p.canViewReporting(),
      },
      {
        // États financiers SYSCEBNL (F5b-b).
        href: '/reporting/statements',
        label: 'États financiers',
        icon: BookOpenCheck,
        matchPrefix: '/reporting/statements',
        visible: (p) => p.canViewReporting() || p.canCreateStatement(),
      },
    ],
  },
  {
    titre: 'Référentiels',
    items: [
      {
        href: '/referential/suppliers',
        label: 'Fournisseurs',
        icon: Building2,
        matchPrefix: '/referential/suppliers',
        visible: (p) => p.canManageSuppliers(),
      },
      {
        href: '/referential/donors',
        label: 'Bailleurs',
        icon: HandCoins,
        matchPrefix: '/referential/donors',
        visible: (p) => p.canManageDonors(),
      },
      {
        href: '/referential/projects',
        label: 'Projets',
        icon: FolderKanban,
        matchPrefix: '/referential/projects',
        visible: (p) => p.canManageProjects(),
      },
    ],
  },
  {
    titre: 'Administration',
    items: [
      {
        href: '/admin/users',
        label: 'Utilisateurs',
        icon: Users,
        matchPrefix: '/admin/users',
        visible: (p) => p.canManageUsers(),
      },
    ],
  },
];

const REPLIE_KEY = 'grantflow.sidebar.replie';

/**
 * Priorité d'affichage des rôles + couleur de badge (repris de l'ancien
 * AppHeader, supprimé au correctif post-preview — la marque et le profil
 * vivent désormais dans la sidebar).
 */
const ROLE_PRIORITY: Array<{ role: GrantflowRole; classes: string; label: string }> = [
  { role: 'SUPER_ADMIN', classes: 'bg-ipd-dark text-white', label: 'Admin' },
  { role: 'DAF', classes: 'bg-ipd-dark text-white', label: 'DAF' },
  { role: 'CONTROLEUR', classes: 'bg-white/15 text-white', label: 'Contrôleur' },
  { role: 'COMPTABLE', classes: 'bg-white/15 text-white', label: 'Comptable' },
  { role: 'TRESORIER', classes: 'bg-ipd-vert text-white', label: 'Trésorier' },
  { role: 'CAISSIER', classes: 'bg-ipd-ambre text-white', label: 'Caissier' },
  { role: 'ACHETEUR', classes: 'bg-ipd-vert text-white', label: 'Acheteur' },
  { role: 'MAGASINIER', classes: 'bg-ipd-vert text-white', label: 'Magasinier' },
  { role: 'PI', classes: 'bg-white/15 text-white', label: 'PI' },
  { role: 'DEMANDEUR', classes: 'bg-white/15 text-ipd-nav-texte', label: 'Demandeur' },
  { role: 'BAILLEUR', classes: 'bg-white/15 text-ipd-nav-texte', label: 'Bailleur' },
];

function pickPrimaryRole(roles: GrantflowRole[]): (typeof ROLE_PRIORITY)[number] | null {
  for (const r of ROLE_PRIORITY) {
    if (roles.includes(r.role)) return r;
  }
  return null;
}

function initiales(nom: string): string {
  return (
    nom
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase() ?? '')
      .join('') || 'U'
  );
}

/**
 * Sidebar charte 2025 — dégradé navy, logo blanc IPD, repliable
 * (w-60 ↔ w-[68px], icône seule replié). Item actif : liseré bleu inset
 * (shadow-actif) + fond bleu translucide. La navigation et le filtrage par
 * rôle sont inchangés.
 */
export function AppSidebar() {
  const pathname = usePathname();
  const perms = usePermissions();
  const { data: session } = useSession();
  const [replie, setReplie] = useState(false);

  // Profil (bloc bas de sidebar). Champs défensifs : le fallback couvre les
  // sessions minimales (tests / première hydratation).
  const fullName = session?.fullName || session?.user?.email || 'Utilisateur';
  const email = session?.user?.email ?? '';
  const primaryRole = pickPrimaryRole((session?.roles ?? []) as GrantflowRole[]);

  // ⚠️ MÊME flux que l'ancien header : logout fédéré OIDC (route handler
  // /api/auth/federated-logout = signOut next-auth + end_session Keycloak).
  // Pas de signOut() direct (laisserait la session SSO Keycloak active).
  const deconnexion = () => {
    window.location.href = '/api/auth/federated-logout';
  };

  // Préférence persistée (lecture post-hydratation → pas de mismatch SSR).
  useEffect(() => {
    try {
      setReplie(window.localStorage.getItem(REPLIE_KEY) === '1');
    } catch {
      /* stockage indisponible : préférence non persistée */
    }
  }, []);
  const basculer = () => {
    setReplie((v) => {
      try {
        window.localStorage.setItem(REPLIE_KEY, v ? '0' : '1');
      } catch {
        /* noop */
      }
      return !v;
    });
  };

  return (
    <aside
      data-testid="app-sidebar"
      className={cn(
        'hidden md:flex min-w-0 flex-none flex-col overflow-hidden',
        'bg-gradient-to-b from-ipd-navy to-ipd-navy-2 text-ipd-hero-texte',
        'transition-[width] duration-200',
        replie ? 'w-[68px]' : 'w-60',
      )}
    >
      {/* Marque + bouton de repli */}
      <div
        className={cn(
          'flex border-b border-white/10 px-3 py-4',
          replie ? 'flex-col items-center gap-3' : 'items-center gap-2',
        )}
      >
        {replie ? (
          <Image
            src="/img/icone_ipd_blanc.png"
            alt="Institut Pasteur de Dakar"
            width={32}
            height={32}
            className="h-8 w-8"
            priority
          />
        ) : (
          <Image
            src="/img/logo_ipd_blanc.png"
            alt="Institut Pasteur de Dakar"
            width={150}
            height={34}
            className="h-[30px] w-auto"
            priority
          />
        )}
        <button
          onClick={basculer}
          aria-expanded={!replie}
          aria-label={replie ? 'Déployer le menu' : 'Réduire le menu'}
          title={replie ? 'Déployer le menu' : 'Réduire le menu'}
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-[8px] text-ipd-nav-texte hover:bg-white/10 hover:text-white',
            replie ? '' : 'ml-auto',
          )}
        >
          {replie ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>

      <nav className="nav-scroll flex-1 space-y-0.5 overflow-y-auto overflow-x-hidden p-2.5">
        {GROUPES.map((groupe) => {
          const items = groupe.items.filter((it) => (it.visible ? it.visible(perms) : true));
          if (items.length === 0) return null;
          return (
            <div key={groupe.titre ?? 'racine'}>
              {groupe.titre &&
                (replie ? (
                  <div className="my-2 border-t border-white/10" aria-hidden="true" />
                ) : (
                  <div className="px-3 pb-1 pt-3 font-titre text-[11px] font-bold uppercase tracking-[.12em] text-ipd-nav-muet">
                    {groupe.titre}
                  </div>
                ))}
              {items.map((item) => {
                const prefixes = item.matchPrefixes ?? [item.matchPrefix ?? item.href];
                const active =
                  pathname === item.href ||
                  prefixes.some((p) => pathname === p || pathname.startsWith(p + '/'));
                const Icon = item.icon;
                const baseClasses = cn(
                  'flex items-center gap-3 rounded-[9px] py-2.5 font-titre text-[13.5px] transition-colors',
                  replie ? 'justify-center px-0' : 'px-3',
                );

                if (item.disabled) {
                  return (
                    <span
                      key={item.href}
                      aria-disabled="true"
                      title="Disponible dans un sprint suivant"
                      className={cn(baseClasses, 'cursor-not-allowed text-ipd-nav-texte/50')}
                    >
                      <Icon className="h-4 w-4 flex-none" />
                      {!replie && item.label}
                    </span>
                  );
                }

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    title={replie ? item.label : undefined}
                    className={cn(
                      baseClasses,
                      active
                        ? 'bg-ipd-bleu/30 font-medium text-white shadow-actif'
                        : 'text-ipd-nav-texte hover:bg-white/10 hover:text-white',
                    )}
                  >
                    <Icon className="h-4 w-4 flex-none" />
                    {!replie && item.label}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      {/* Bloc bas de sidebar : état système + profil + déconnexion fédérée. */}
      <div className="border-t border-white/10 p-2.5">
        {!replie && (
          <div className="mb-2.5 space-y-1.5 px-1.5">
            <SystemStatus />
            <div className="text-[11px] text-ipd-nav-muet">v0.12.0 — Charte 2025</div>
          </div>
        )}
        <div className={cn('flex items-center gap-3', replie && 'flex-col gap-2')}>
          <div
            title={replie ? `${fullName}${primaryRole ? ` · ${primaryRole.label}` : ''}` : undefined}
            className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-ipd-bleu font-titre text-[13px] font-semibold text-white"
          >
            {initiales(fullName)}
          </div>
          {!replie && (
            <div className="min-w-0 flex-1 leading-tight">
              <div className="flex items-center gap-1.5">
                <span className="truncate font-titre text-[13px] font-medium text-white">
                  {fullName}
                </span>
                {primaryRole && (
                  <span
                    data-testid="role-badge"
                    className={cn(
                      'flex-none rounded-full px-2 py-px text-[10px] font-medium',
                      primaryRole.classes,
                    )}
                  >
                    {primaryRole.label}
                  </span>
                )}
              </div>
              <div className="truncate text-[11px] text-ipd-nav-muet">{email || 'Connecté'}</div>
            </div>
          )}
          <button
            onClick={deconnexion}
            data-testid="sidebar-logout"
            title="Se déconnecter"
            aria-label="Se déconnecter"
            className="flex-none p-1 text-ipd-nav-muet hover:text-white"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}

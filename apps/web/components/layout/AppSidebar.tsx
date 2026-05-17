'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Calculator,
  FileBarChart,
  LayoutDashboard,
  ShoppingCart,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { SystemStatus } from './SystemStatus';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  disabled?: boolean;
  /** Préfixe à utiliser pour matcher l'état "actif" (par défaut = href). */
  matchPrefix?: string;
}

const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  {
    href: '/procurement/purchase-requests',
    label: 'Achats',
    icon: ShoppingCart,
    matchPrefix: '/procurement',
  },
  { href: '/accounting', label: 'Comptabilité', icon: Calculator, disabled: true },
  { href: '/treasury', label: 'Trésorerie', icon: Wallet, disabled: true },
  { href: '/reporting', label: 'Reporting', icon: FileBarChart, disabled: true },
];

/**
 * Sidebar fixe à gauche, 240px, fond cream. 5 entrées dont Dashboard
 * actif. Sprint F1.1 — ajout du bloc SystemStatus en bas (ping
 * /health toutes les 30 s).
 */
export function AppSidebar() {
  const pathname = usePathname();
  return (
    <aside
      data-testid="app-sidebar"
      className="hidden md:flex w-60 shrink-0 flex-col border-r border-slate-200 bg-cream"
    >
      <nav className="flex-1 py-4">
        <ul className="space-y-1 px-2">
          {NAV.map((item) => {
            const prefix = item.matchPrefix ?? item.href;
            const active = pathname === item.href || pathname.startsWith(prefix + '/') || pathname === prefix;
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

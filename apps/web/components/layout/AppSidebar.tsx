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

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  disabled?: boolean;
}

const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/procurement', label: 'Achats', icon: ShoppingCart, disabled: true },
  { href: '/accounting', label: 'Comptabilité', icon: Calculator, disabled: true },
  { href: '/treasury', label: 'Trésorerie', icon: Wallet, disabled: true },
  { href: '/reporting', label: 'Reporting', icon: FileBarChart, disabled: true },
];

/**
 * Sidebar fixe à gauche, 240px, fond cream. 5 entrées dont Dashboard
 * actif. Les autres sont disabled (opacity-50) en attendant les
 * sprints fonctionnels.
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
            const active = pathname === item.href || pathname.startsWith(item.href + '/');
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
                      ? 'bg-pasteur-50 text-pasteur border-l-pasteur'
                      : 'text-slate-text hover:bg-pasteur-50/60 hover:text-pasteur',
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
      <div className="border-t border-slate-200 px-4 py-3 text-xs text-slate-muted">
        v0.11.0 — Sprint F1
      </div>
    </aside>
  );
}

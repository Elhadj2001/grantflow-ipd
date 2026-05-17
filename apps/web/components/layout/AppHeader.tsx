'use client';

import { signOut } from 'next-auth/react';
import { LogOut, User } from 'lucide-react';
import type { Session } from 'next-auth';
import type { GrantflowRole } from '@/lib/auth';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface AppHeaderProps {
  session: Session;
}

/**
 * Priorité d'affichage des rôles (haut → bas) + couleur de badge.
 * Le rôle "principal" affiché à côté du nom est le premier de la liste
 * que l'utilisateur possède.
 */
const ROLE_PRIORITY: Array<{ role: GrantflowRole; classes: string; label: string }> = [
  // Note : pour les badges sur fond rouge/aqua du header, on utilise les
  // teintes "-dark" qui passent AA avec text-white.
  { role: 'SUPER_ADMIN', classes: 'bg-ipd-dark text-white', label: 'Admin' },
  { role: 'DAF', classes: 'bg-ipd-dark text-white', label: 'DAF' },
  { role: 'CONTROLEUR', classes: 'bg-navy text-white', label: 'Contrôleur' },
  { role: 'COMPTABLE', classes: 'bg-navy text-white', label: 'Comptable' },
  { role: 'TRESORIER', classes: 'bg-state-success text-white', label: 'Trésorier' },
  { role: 'CAISSIER', classes: 'bg-state-warning text-white', label: 'Caissier' },
  { role: 'ACHETEUR', classes: 'bg-state-success text-white', label: 'Acheteur' },
  { role: 'MAGASINIER', classes: 'bg-state-success text-white', label: 'Magasinier' },
  { role: 'PI', classes: 'bg-navy text-white', label: 'PI' },
  { role: 'DEMANDEUR', classes: 'bg-slate-500 text-white', label: 'Demandeur' },
  { role: 'BAILLEUR', classes: 'bg-slate-500 text-white', label: 'Bailleur' },
];

function pickPrimaryRole(roles: GrantflowRole[]): (typeof ROLE_PRIORITY)[number] | null {
  for (const r of ROLE_PRIORITY) {
    if (roles.includes(r.role)) return r;
  }
  return null;
}

/**
 * Header de l'app authentifiée — fond aqua IPD (#4FC3D9), 56px de haut.
 * Sprint F1.1 : ajout d'un badge rôle principal à côté du nom.
 * Sprint F1.2 : re-charte aqua (pasteur → ipd).
 */
export function AppHeader({ session }: AppHeaderProps) {
  const fullName = session.fullName || session.user?.email || 'Utilisateur';
  const email = session.user?.email ?? '';
  const initials =
    fullName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase() ?? '')
      .join('') || 'U';
  const primaryRole = pickPrimaryRole(session.roles ?? []);

  return (
    <header className="h-14 bg-ipd text-white flex items-center justify-between px-4 shadow-sm">
      <div className="flex items-center gap-2 font-bold tracking-tight">
        <span
          aria-hidden
          className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-white text-ipd-darker font-bold"
        >
          G
        </span>
        <span className="text-base">IPD GRANTFLOW</span>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Menu utilisateur"
          className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-ipd-dark/40 focus:outline-none focus:ring-2 focus:ring-white/60"
        >
          <span
            aria-hidden
            className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white text-ipd-darker text-sm font-semibold"
          >
            {initials}
          </span>
          <span className="hidden sm:inline text-sm">{fullName}</span>
          {primaryRole && (
            <span
              data-testid="role-badge"
              className={cn(
                'hidden md:inline-block rounded-full px-2 py-0.5 text-xs font-medium',
                primaryRole.classes,
              )}
            >
              {primaryRole.label}
            </span>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>
            <div className="font-semibold">{fullName}</div>
            {email && <div className="text-xs text-muted-foreground">{email}</div>}
            {primaryRole && (
              <div className="mt-1 text-xs text-ipd-darker">{primaryRole.label}</div>
            )}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled>
            <User className="mr-2 h-4 w-4" /> Mon profil
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => signOut({ callbackUrl: '/login' })}
            className="text-destructive focus:text-destructive"
          >
            <LogOut className="mr-2 h-4 w-4" /> Se déconnecter
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}

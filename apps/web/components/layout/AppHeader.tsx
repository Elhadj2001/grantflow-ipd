'use client';

import { signOut } from 'next-auth/react';
import { LogOut, User } from 'lucide-react';
import type { Session } from 'next-auth';
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
 * Header de l'app authentifiée — fond rouge IPD (pasteur), 56px de haut.
 * Logo à gauche (placeholder texte), avatar + dropdown à droite.
 */
export function AppHeader({ session }: AppHeaderProps) {
  const fullName = session.fullName || session.user?.email || 'Utilisateur';
  const email = session.user?.email ?? '';
  const initials = fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .join('') || 'U';

  return (
    <header className="h-14 bg-pasteur text-white flex items-center justify-between px-4 shadow-sm">
      <div className="flex items-center gap-2 font-bold tracking-tight">
        <span
          aria-hidden
          className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-white text-pasteur font-bold"
        >
          G
        </span>
        <span className="text-base">IPD GRANTFLOW</span>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Menu utilisateur"
          className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-pasteur-dark/40 focus:outline-none focus:ring-2 focus:ring-white/60"
        >
          <span
            aria-hidden
            className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white text-pasteur text-sm font-semibold"
          >
            {initials}
          </span>
          <span className="hidden sm:inline text-sm">{fullName}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>
            <div className="font-semibold">{fullName}</div>
            {email && <div className="text-xs text-muted-foreground">{email}</div>}
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

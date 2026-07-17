'use client';

import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { GRANTFLOW_ROLES, type GrantflowRoleCode } from '@/lib/api/admin-users';

/**
 * Libellés FR alignés sur l'affichage existant dans le Dashboard.
 * Source : ROLES côté backend + même mapping qu'apps/web/app/(authenticated)/dashboard/page.tsx
 */
const ROLE_LABELS_FR: Record<GrantflowRoleCode, string> = {
  SUPER_ADMIN: 'Administrateur',
  DAF: 'DAF',
  CONTROLEUR: 'Contrôleur de gestion',
  COMPTABLE: 'Comptable',
  TRESORIER: 'Trésorier',
  ACHETEUR: 'Acheteur',
  MAGASINIER: 'Magasinier',
  PI: 'Principal Investigator',
  DEMANDEUR: 'Demandeur',
  BAILLEUR: 'Bailleur / Auditeur',
  CAISSIER: 'Caissier',
  GO: 'Grant Office',
};

export interface AdminUserRoleSelectorProps {
  value: GrantflowRoleCode[];
  onChange: (next: GrantflowRoleCode[]) => void;
  /** Si true, les boutons sont rendus mais non cliquables (lecture). */
  disabled?: boolean;
  /** Bloque explicitement un retrait (cas dernier SUPER_ADMIN). */
  readonlyRoles?: GrantflowRoleCode[];
  /** Pour testid stables côté RTL. */
  testIdPrefix?: string;
}

/**
 * Sélecteur multi-rôles à boutons toggleables. Préfère cette UX au
 * `<select multiple>` (peu accessible, mal stylé) et à un combobox qui
 * surchargerait l'écran pour 11 options. Aligné sur la même charte que
 * le filtre statut côté Suppliers.
 *
 * Sécurité : `readonlyRoles` permet d'empêcher un toggle qui violerait
 * le garde-fou anti-lock-out (le dernier SUPER_ADMIN ne peut pas se
 * retirer SUPER_ADMIN). Le backend rejettera de toute façon — c'est
 * de l'UX préventive.
 */
export function AdminUserRoleSelector({
  value,
  onChange,
  disabled,
  readonlyRoles = [],
  testIdPrefix = 'role',
}: AdminUserRoleSelectorProps) {
  const has = (r: GrantflowRoleCode) => value.includes(r);

  const toggle = (r: GrantflowRoleCode) => {
    if (disabled) return;
    if (readonlyRoles.includes(r) && has(r)) return; // pas de retrait
    onChange(has(r) ? value.filter((x) => x !== r) : [...value, r]);
  };

  return (
    <div
      role="group"
      aria-label="Rôles de l'utilisateur"
      data-testid={`${testIdPrefix}-selector`}
      data-selected-count={value.length}
      className="flex flex-wrap gap-2"
    >
      {GRANTFLOW_ROLES.map((r) => {
        const selected = has(r);
        const locked = readonlyRoles.includes(r);
        return (
          <Button
            key={r}
            type="button"
            size="sm"
            variant={selected ? 'default' : 'outline'}
            onClick={() => toggle(r)}
            disabled={disabled || (locked && selected)}
            aria-pressed={selected}
            data-testid={`${testIdPrefix}-${r}`}
            data-selected={selected ? 'true' : 'false'}
            data-locked={locked ? 'true' : 'false'}
            title={locked && selected ? 'Rôle verrouillé (dernier SUPER_ADMIN)' : undefined}
            className={cn(
              'inline-flex items-center gap-1.5',
              // Inactif foncé (non sélectionné) en aqua très clair
              !selected && 'border-ipd-50 text-slate-text hover:bg-ipd-50/40',
            )}
          >
            {selected && <Check className="h-3 w-3" aria-hidden />}
            <span>{ROLE_LABELS_FR[r]}</span>
          </Button>
        );
      })}
    </div>
  );
}

/** Helper pour afficher des rôles en lecture seule (badges compactes). */
export function AdminUserRolesBadges({ roles }: { roles: string[] }) {
  if (roles.length === 0) {
    return <span className="text-xs italic text-slate-muted">Aucun rôle</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {roles.map((r) => (
        <span
          key={r}
          data-testid={`role-badge-${r}`}
          className="inline-flex items-center rounded-full bg-ipd-50 px-2 py-0.5 text-xs font-medium text-ipd-darker"
        >
          {ROLE_LABELS_FR[r as GrantflowRoleCode] ?? r}
        </span>
      ))}
    </div>
  );
}

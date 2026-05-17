'use client';

import { useSession } from 'next-auth/react';
import { useMemo } from 'react';
import type { GrantflowRole } from '@/lib/auth';

export interface Permissions {
  /** Rôles courants. */
  roles: GrantflowRole[];
  has: (role: GrantflowRole) => boolean;
  hasAny: (...roles: GrantflowRole[]) => boolean;

  // ------------------ Procurement (sprint F2) ------------------
  canCreatePR: () => boolean;
  /** Approuver une DA en tant que PI sur SON projet (vérification serveur). */
  canApprovePRAsPi: () => boolean;
  /** Approuver une DA en tant que CG (étape pending_cg). */
  canApprovePRAsCg: () => boolean;
  /** Approuver une DA en tant que DAF (étape pending_daf). */
  canApprovePRAsDaf: () => boolean;
  /** Approuver une DA petty_cash en tant que Caissier. */
  canApprovePRAsCash: () => boolean;
  /** Édition d'une DA (seulement par owner si draft + DEMANDEUR/PI/SA). */
  canEditPR: (ownerId?: string | null, userId?: string | null) => boolean;
  /** Annuler une DA draft (idem édition). */
  canCancelPR: (ownerId?: string | null, userId?: string | null) => boolean;
  /** Régulariser une avance de mission. */
  canSettleCashAdvance: () => boolean;

  canCreatePO: () => boolean;
  canManagePO: () => boolean;

  canReceive: () => boolean;

  // ------------------ Invoicing (sprint F3) ------------------
  /** Upload PDF facture (capture OCR) — COMPTABLE / SUPER_ADMIN. */
  canUploadInvoice: () => boolean;
  /** Lancer le matching 3-voies (submit) — COMPTABLE / SUPER_ADMIN. */
  canMatchInvoice: () => boolean;
  /** Forcer matched malgré exception — DAF / SUPER_ADMIN. */
  canForceMatchInvoice: () => boolean;
  /** Comptabiliser (post) — COMPTABLE / DAF / SUPER_ADMIN. */
  canPostInvoice: () => boolean;
  /** Annuler la comptabilisation — DAF / SUPER_ADMIN. */
  canCancelPosting: () => boolean;
  /** Rejeter une facture — COMPTABLE / DAF / SUPER_ADMIN. */
  canRejectInvoice: () => boolean;
  /** Voir les factures (tous sauf BAILLEUR lecture seule — implicite côté serveur). */
  canViewInvoice: () => boolean;
  /** Consulter une écriture comptable. */
  canViewJournalEntry: () => boolean;
}

/**
 * Hook RBAC côté UI. Lit `session.roles` et expose des helpers booléens
 * pour cacher/afficher les actions. Les vérifs serveur restent
 * autoritaires — ce hook empêche juste de proposer des actions inutiles.
 *
 * Sprint F2 : périmètre procurement (DA / BC / GR). Sera étendu pour
 * accounting/treasury/reporting dans les sprints suivants.
 */
export function usePermissions(): Permissions {
  const { data: session } = useSession();
  const roles = (session?.roles ?? []) as GrantflowRole[];

  return useMemo<Permissions>(() => {
    const has = (role: GrantflowRole) => roles.includes(role);
    const hasAny = (...rs: GrantflowRole[]) => rs.some((r) => roles.includes(r));

    return {
      roles,
      has,
      hasAny,

      // Procurement — DA
      canCreatePR: () => hasAny('DEMANDEUR', 'PI', 'SUPER_ADMIN'),
      canApprovePRAsPi: () => hasAny('PI', 'SUPER_ADMIN'),
      canApprovePRAsCg: () => hasAny('CONTROLEUR', 'SUPER_ADMIN'),
      canApprovePRAsDaf: () => hasAny('DAF', 'SUPER_ADMIN'),
      canApprovePRAsCash: () => hasAny('CAISSIER', 'SUPER_ADMIN'),
      canEditPR: (ownerId, userId) => {
        if (hasAny('SUPER_ADMIN')) return true;
        if (!ownerId || !userId) return hasAny('DEMANDEUR', 'PI');
        return ownerId === userId && hasAny('DEMANDEUR', 'PI');
      },
      canCancelPR: (ownerId, userId) => {
        if (hasAny('SUPER_ADMIN')) return true;
        if (!ownerId || !userId) return hasAny('DEMANDEUR', 'PI');
        return ownerId === userId && hasAny('DEMANDEUR', 'PI');
      },
      canSettleCashAdvance: () => hasAny('CAISSIER', 'DAF', 'SUPER_ADMIN'),

      // Procurement — BC
      canCreatePO: () => hasAny('ACHETEUR', 'SUPER_ADMIN'),
      canManagePO: () => hasAny('ACHETEUR', 'DAF', 'SUPER_ADMIN'),

      // Procurement — Réception
      canReceive: () => hasAny('MAGASINIER', 'SUPER_ADMIN'),

      // Invoicing — F3
      canUploadInvoice: () => hasAny('COMPTABLE', 'SUPER_ADMIN'),
      canMatchInvoice: () => hasAny('COMPTABLE', 'SUPER_ADMIN'),
      canForceMatchInvoice: () => hasAny('DAF', 'SUPER_ADMIN'),
      canPostInvoice: () => hasAny('COMPTABLE', 'DAF', 'SUPER_ADMIN'),
      canCancelPosting: () => hasAny('DAF', 'SUPER_ADMIN'),
      canRejectInvoice: () => hasAny('COMPTABLE', 'DAF', 'SUPER_ADMIN'),
      canViewInvoice: () =>
        hasAny(
          'COMPTABLE',
          'DAF',
          'CONTROLEUR',
          'SUPER_ADMIN',
          'TRESORIER',
          'ACHETEUR',
          'BAILLEUR',
          'DEMANDEUR',
          'PI',
        ),
      canViewJournalEntry: () =>
        hasAny('COMPTABLE', 'DAF', 'CONTROLEUR', 'SUPER_ADMIN'),
    };
  }, [roles]);
}

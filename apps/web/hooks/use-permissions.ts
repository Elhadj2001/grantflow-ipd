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

  // ------------------ Treasury (sprint F4b) ------------------
  /** Voir les payment runs (lecture). */
  canViewPaymentRun: () => boolean;
  /** Créer un payment run (regrouper factures à payer) — TRESORIER / DAF / SUPER_ADMIN. */
  canCreatePaymentRun: () => boolean;
  /** Préparer (snapshot IBAN + statut prepared) — TRESORIER / DAF / SUPER_ADMIN. */
  canPreparePaymentRun: () => boolean;
  /** Approuver et exécuter (séparation des tâches) — DAF / SUPER_ADMIN. */
  canApprovePaymentRun: () => boolean;
  /** Générer le XML SEPA pain.001 — TRESORIER / DAF / SUPER_ADMIN. */
  canGenerateSepa: () => boolean;
  /** Marquer le SEPA comme envoyé à la banque. */
  canMarkSepaSent: () => boolean;
  /** Acknowledger les alertes IBAN (anti-fraude) — DAF / SUPER_ADMIN. */
  canAcknowledgeIbanAlerts: () => boolean;

  // ------------------ Reporting bailleur (sprint F5a) ------------------
  /**
   * Voir les rapports bailleur et templates (lecture). BAILLEUR a un
   * accès limité (filtrage UI sur status=sent uniquement), géré par
   * `filterReportsForBailleur` côté lib.
   */
  canViewReporting: () => boolean;
  /** Créer un nouveau rapport bailleur (POST /donor-reports). */
  canCreateDonorReport: () => boolean;
  /** Créer ou éditer un template (POST /templates + addMappings). */
  canManageDonorTemplate: () => boolean;
  /** Lock un rapport draft → locked (génère PDF/Excel). */
  canLockDonorReport: () => boolean;
  /**
   * Envoyer un rapport au bailleur (lock → sent). Séparation des tâches :
   * seul le DAF (ou SUPER_ADMIN) peut autoriser l'envoi.
   */
  canSendDonorReport: () => boolean;
  /**
   * Supprimer un template — réservé SUPER_ADMIN (pas d'endpoint backend
   * pour l'instant, action désactivée dans tous les cas mais le helper
   * permet de prévoir l'UX future).
   */
  canDeleteDonorTemplate: () => boolean;

  // ------------------ Clôture mensuelle (sprint F5b-b) ------------------
  /**
   * Voir la liste des périodes fiscales et leurs findings — lecture
   * accessible à tous les rôles internes finance (COMPTABLE jusqu'à DAF).
   * Le BAILLEUR n'a PAS accès au workflow de clôture (vue purement interne).
   */
  canViewClosure: () => boolean;
  /** Lancer le precheck — COMPTABLE / CONTROLEUR / DAF / SUPER_ADMIN. */
  canRunPrecheck: () => boolean;
  /** Passer les FNP (POST /accruals) — COMPTABLE / CONTROLEUR / DAF / SUPER_ADMIN. */
  canRunAccruals: () => boolean;
  /** Saisir les CCA/PCA (POST /prepayments) — COMPTABLE / CONTROLEUR / DAF / SUPER_ADMIN. */
  canRunPrepayments: () => boolean;
  /** Run dotations 689 / reprises 789 — CONTROLEUR / DAF / SUPER_ADMIN. */
  canRunDedicatedFunds: () => boolean;
  /** Clôturer une période — CONTROLEUR / DAF / SUPER_ADMIN. */
  canClosePeriod: () => boolean;
  /** Ré-ouvrir une période close — DAF / SUPER_ADMIN seulement. */
  canReopenPeriod: () => boolean;
  /** Override DAF des findings BLOCKING au close — DAF / SUPER_ADMIN. */
  canOverrideBlockingClose: () => boolean;
  /** Générer un état financier (TER/BILAN/RESULTAT/FONDS_DEDIES). */
  canCreateStatement: () => boolean;
  /** Verrouiller un état financier (immutable après) — DAF / SUPER_ADMIN. */
  canLockStatement: () => boolean;

  // ------------------ Pilotage (sprint F-PILOTAGE) ------------------
  /** Portefeuille global des conventions — CG / DAF / SUPER_ADMIN. */
  canViewGrantPortfolio: () => boolean;
  /**
   * Détail d'un grant. CG/DAF/SA voient tout. PI ne voit que les grants
   * de SES projets (cross-PI safety) — `piUserIdOfGrant` (project.piUserId)
   * doit alors matcher l'utilisateur courant.
   *
   * `currentUserId` est l'app_user.id (pas le keycloak `sub`) — souvent
   * récupéré depuis session.appUserId si exposé, ou `null` côté front et
   * appliqué par le serveur en cas de doute. Cette vérification UI est
   * un voile : la sécurité réelle est `assertCanViewGrant` côté backend.
   */
  canViewGrant: (piUserIdOfGrant?: string | null, currentUserId?: string | null) => boolean;
  /** Vue analytique globale (cross-conventions) — CG / DAF / SUPER_ADMIN. */
  canViewAnalytics: () => boolean;
  /** Paramétrer une convention (créer / éditer) — CG / SUPER_ADMIN. */
  canParameterGrant: () => boolean;
  /**
   * Éditer un grant déjà existant. Verrouillé si transactions actives
   * (passé en argument depuis la page).
   */
  canEditGrant: (hasTransactions: boolean) => boolean;
  /** Page "Mes Projets" — PI uniquement. */
  canViewMyProjects: () => boolean;

  // ------------------ Référentiel (sprint F5b-c) ------------------
  /**
   * CRUD fournisseur. Asymétrie volontaire avec budget-line :
   * ACHETEUR gère les fournisseurs (sourcing) mais ne touche pas aux
   * lignes budgétaires (paramétrage CG/DAF).
   */
  canManageSuppliers: () => boolean;
  /** Soft delete + restore fournisseur — DAF / SUPER_ADMIN. */
  canDeleteSupplier: () => boolean;
  /**
   * CRUD ligne budgétaire dans une convention. Paramétrage CG/DAF —
   * **pas ACHETEUR** (contrairement aux fournisseurs).
   */
  canManageBudgetLines: () => boolean;
  /** Soft delete + restore ligne budgétaire — DAF / SUPER_ADMIN. */
  canDeleteBudgetLine: () => boolean;

  // ------------------ Référentiel — Bailleurs & Projets (sprint F-REF) ------------------
  /**
   * CRUD bailleur (donor). Paramétrage CG/DAF/SA — calé sur le RBAC
   * backend (`@Roles('CONTROLEUR','DAF','SUPER_ADMIN')` sur POST/PUT/PATCH).
   */
  canManageDonors: () => boolean;
  /** Soft delete + restore bailleur — DAF / SUPER_ADMIN. */
  canDeleteDonor: () => boolean;
  /**
   * CRUD projet. Mêmes rôles que bailleur côté POST/PUT/PATCH/DELETE
   * (`@Roles('CONTROLEUR','DAF','SUPER_ADMIN')` côté ProjectController).
   */
  canManageProjects: () => boolean;
  /**
   * Soft delete projet — CG/DAF/SA (le DELETE backend autorise CONTROLEUR,
   * contrairement aux fournisseurs/bailleurs réservés au DAF). Restore =
   * DAF/SA uniquement, mais ce helper couvre les deux côté UI.
   */
  canDeleteProject: () => boolean;

  // ------------------ Liste — gating fetch (sprint F-RBAC-LISTES) ------------------
  /**
   * Helpers calés EXACTEMENT sur les @Roles backend du sprint F-RBAC-LISTES.
   * À utiliser comme `options.enabled` sur useList{POs,GRs,Invoices,PaymentRuns}
   * pour éviter qu'un rôle non autorisé déclenche un 403 — le helper
   * `canViewX()` reste plus large (concerne l'AFFICHAGE / la page),
   * tandis que `canListX()` traduit la permission stricte de l'endpoint
   * de LISTE.
   */
  /** GET /purchase-orders — aligné backend @Roles. */
  canListPurchaseOrders: () => boolean;
  /** GET /goods-receipts — aligné backend @Roles. */
  canListGoodsReceipts: () => boolean;
  /** GET /invoices — aligné backend @Roles. */
  canListInvoices: () => boolean;
  /** GET /payment-runs — aligné backend @Roles. */
  canListPaymentRuns: () => boolean;

  // ------------------ Administration utilisateurs (sprint F-ADMIN-USERS) ------------------
  /**
   * Gérer les utilisateurs de l'application (CRUD + activate/deactivate
   * + reset password + role-mapping). Calé sur le @Roles côté backend
   * (`@Roles('SUPER_ADMIN', 'DAF')`).
   */
  canManageUsers: () => boolean;

  // ------------------ Simulateur facture démo (sprint F-INVOICE-SIM) ------------------
  /**
   * Déclencher le simulateur de facture fournisseur (mode démo). Calé sur
   * le @Roles backend (`@Roles('SUPER_ADMIN', 'CONTROLEUR', 'DAF')`).
   * Le bouton n'est de toute façon affiché que si le flag serveur
   * `demoInvoiceSimulator` est actif (cf. useFeatures).
   */
  canSimulateInvoice: () => boolean;
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

      // Treasury — F4b
      canViewPaymentRun: () =>
        hasAny('TRESORIER', 'DAF', 'CONTROLEUR', 'COMPTABLE', 'SUPER_ADMIN'),
      canCreatePaymentRun: () => hasAny('TRESORIER', 'DAF', 'SUPER_ADMIN'),
      canPreparePaymentRun: () => hasAny('TRESORIER', 'DAF', 'SUPER_ADMIN'),
      // Séparation des tâches : seul le DAF peut approuver (et donc
      // exécuter), même si le TRESORIER a préparé.
      canApprovePaymentRun: () => hasAny('DAF', 'SUPER_ADMIN'),
      canGenerateSepa: () => hasAny('TRESORIER', 'DAF', 'SUPER_ADMIN'),
      canMarkSepaSent: () => hasAny('TRESORIER', 'DAF', 'SUPER_ADMIN'),
      canAcknowledgeIbanAlerts: () => hasAny('DAF', 'SUPER_ADMIN'),

      // Reporting — F5a
      canViewReporting: () =>
        hasAny('CONTROLEUR', 'DAF', 'BAILLEUR', 'SUPER_ADMIN'),
      canCreateDonorReport: () => hasAny('CONTROLEUR', 'DAF', 'SUPER_ADMIN'),
      canManageDonorTemplate: () => hasAny('CONTROLEUR', 'SUPER_ADMIN'),
      canLockDonorReport: () =>
        hasAny('CONTROLEUR', 'DAF', 'SUPER_ADMIN'),
      // Séparation des tâches : DAF déclenche l'envoi (≠ CG qui prépare)
      canSendDonorReport: () => hasAny('DAF', 'SUPER_ADMIN'),
      canDeleteDonorTemplate: () => hasAny('SUPER_ADMIN'),

      // Clôture mensuelle — F5b-b (cale sur les @Roles du controller)
      canViewClosure: () =>
        hasAny('COMPTABLE', 'CONTROLEUR', 'DAF', 'TRESORIER', 'SUPER_ADMIN'),
      canRunPrecheck: () =>
        hasAny('COMPTABLE', 'CONTROLEUR', 'DAF', 'SUPER_ADMIN'),
      canRunAccruals: () =>
        hasAny('COMPTABLE', 'CONTROLEUR', 'DAF', 'SUPER_ADMIN'),
      canRunPrepayments: () =>
        hasAny('COMPTABLE', 'CONTROLEUR', 'DAF', 'SUPER_ADMIN'),
      canRunDedicatedFunds: () => hasAny('CONTROLEUR', 'DAF', 'SUPER_ADMIN'),
      canClosePeriod: () => hasAny('CONTROLEUR', 'DAF', 'SUPER_ADMIN'),
      canReopenPeriod: () => hasAny('DAF', 'SUPER_ADMIN'),
      // Seul le DAF peut acknowledger les BLOCKING (mêmes règles qu'un close
      // avec reason — le CG ne peut pas overrider, ça doit remonter au DAF).
      canOverrideBlockingClose: () => hasAny('DAF', 'SUPER_ADMIN'),
      canCreateStatement: () =>
        hasAny('COMPTABLE', 'CONTROLEUR', 'DAF', 'SUPER_ADMIN'),
      canLockStatement: () => hasAny('DAF', 'SUPER_ADMIN'),

      // Pilotage — F-PILOTAGE (US-065 : GO consulte le portefeuille des
      // conventions — @Roles pilotage lecture élargis en miroir côté API)
      canViewGrantPortfolio: () => hasAny('GO', 'CONTROLEUR', 'DAF', 'SUPER_ADMIN'),
      canViewGrant: (piUserIdOfGrant, currentUserId) => {
        if (hasAny('SUPER_ADMIN', 'DAF', 'CONTROLEUR')) return true;
        if (!hasAny('PI')) return false;
        // PI : autorisé seulement si owner du projet. Si l'info n'est
        // pas dispo (page de routage sans grant chargé), on laisse le
        // backend trancher — UI laisse passer optimistiquement, mais
        // l'API renvoie 403.
        if (!piUserIdOfGrant || !currentUserId) return true;
        return piUserIdOfGrant === currentUserId;
      },
      canViewAnalytics: () => hasAny('CONTROLEUR', 'DAF', 'SUPER_ADMIN'),
      canParameterGrant: () => hasAny('CONTROLEUR', 'SUPER_ADMIN'),
      canEditGrant: (hasTransactions) => {
        if (!hasAny('CONTROLEUR', 'SUPER_ADMIN')) return false;
        return !hasTransactions || hasAny('SUPER_ADMIN');
      },
      canViewMyProjects: () => hasAny('PI', 'SUPER_ADMIN'),

      // Référentiel — F5b-c (calé sur les @Roles du controller)
      // Suppliers: ACHETEUR + CONTROLEUR + DAF + SUPER_ADMIN.
      // Asymétrie volontaire : ACHETEUR gère le sourcing, mais NE TOUCHE
      // PAS aux lignes budgétaires (paramétrage CG/DAF).
      canManageSuppliers: () =>
        hasAny('ACHETEUR', 'CONTROLEUR', 'DAF', 'SUPER_ADMIN'),
      canDeleteSupplier: () => hasAny('DAF', 'SUPER_ADMIN'),
      // BudgetLine : CONTROLEUR + DAF + SUPER_ADMIN (pas ACHETEUR).
      canManageBudgetLines: () => hasAny('CONTROLEUR', 'DAF', 'SUPER_ADMIN'),
      canDeleteBudgetLine: () => hasAny('DAF', 'SUPER_ADMIN'),

      // Référentiel — Bailleurs (F-REF). Aligné sur @Roles backend
      // POST/PUT/PATCH /donors = CONTROLEUR/DAF/SA ; DELETE+restore = DAF/SA.
      canManageDonors: () => hasAny('CONTROLEUR', 'DAF', 'SUPER_ADMIN'),
      canDeleteDonor: () => hasAny('DAF', 'SUPER_ADMIN'),
      // Référentiel — Projets (F-REF). POST/PUT/PATCH/DELETE = CG/DAF/SA ;
      // restore = DAF/SA. On expose un seul helper canDeleteProject pour
      // l'UI (le bouton "Supprimer" et le bouton "Restaurer" portent le
      // même gating côté front ; le backend distinguera DAF pour le restore).
      canManageProjects: () => hasAny('CONTROLEUR', 'DAF', 'SUPER_ADMIN'),
      canDeleteProject: () => hasAny('CONTROLEUR', 'DAF', 'SUPER_ADMIN'),

      // Liste — F-RBAC-LISTES — STRICTEMENT aligné sur les @Roles backend.
      // Toute modif ici doit être miroir dans le @Roles du controller.
      canListPurchaseOrders: () =>
        hasAny(
          'ACHETEUR',
          'MAGASINIER',
          'COMPTABLE',
          'CONTROLEUR',
          'DAF',
          'TRESORIER',
          'SUPER_ADMIN',
        ),
      canListGoodsReceipts: () =>
        hasAny(
          'MAGASINIER',
          'ACHETEUR',
          'COMPTABLE',
          'CONTROLEUR',
          'DAF',
          'SUPER_ADMIN',
        ),
      canListInvoices: () =>
        hasAny(
          'ACHETEUR',
          'COMPTABLE',
          'CONTROLEUR',
          'DAF',
          'TRESORIER',
          'DEMANDEUR',
          'PI',
          'SUPER_ADMIN',
        ),
      canListPaymentRuns: () =>
        hasAny('TRESORIER', 'COMPTABLE', 'CONTROLEUR', 'DAF', 'SUPER_ADMIN'),

      // Administration des utilisateurs — F-ADMIN-USERS
      // Aligné sur @Roles('SUPER_ADMIN','DAF') côté AdminUsersController.
      canManageUsers: () => hasAny('SUPER_ADMIN', 'DAF'),

      // Simulateur facture démo (sprint F-INVOICE-SIM)
      canSimulateInvoice: () => hasAny('SUPER_ADMIN', 'CONTROLEUR', 'DAF'),
    };
  }, [roles]);
}

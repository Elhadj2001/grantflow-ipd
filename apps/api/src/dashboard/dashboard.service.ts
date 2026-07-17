import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import type { Role } from '../auth/types/roles';

/**
 * US-066 — endpoint dashboard agrégé.
 *
 * Constat audit refonte UI : le dashboard front tirait jusqu'à 13 requêtes
 * (dont un fan-out de 5 listes DA mono-statut à pageSize=1 juste pour les
 * `total`). Ce service renvoie TOUS les compteurs en UNE réponse ; les 4
 * requêtes SQL sous-jacentes partent en parallèle (Promise.all).
 *
 * RBAC — même sémantique que les listes sources :
 *  - DA en attente : FULL_VIEW voit tout ; les autres (DEMANDEUR, PI…) ne
 *    comptent que LEURS DA (bridge email → app_user, sans auto-provisioning).
 *  - Factures à matcher / paiements du mois : compte GLOBAL réservé aux
 *    rôles de pilotage comptable ; `null` pour les autres (le front masque
 *    la carte). On ne réplique pas ici le scoping fin par BC/DA des listes.
 *  - Conventions actives : visible par tous (y compris BAILLEUR).
 */

export const PENDING_PR_STATUSES = [
  'submitted',
  'pending_pi',
  'pending_cg',
  'pending_daf',
  'pending_caissier',
] as const;
export type PendingPrStatus = (typeof PENDING_PR_STATUSES)[number];

/** Rôles voyant toutes les DA (aligné PurchaseRequestService.FULL_VIEW_ROLES). */
const PR_FULL_VIEW_ROLES: ReadonlyArray<Role> = [
  'CONTROLEUR',
  'DAF',
  'COMPTABLE',
  'TRESORIER',
  'SUPER_ADMIN',
];

/** Rôles autorisés au compte GLOBAL factures/paiements (pilotage comptable). */
const ACCOUNTING_VIEW_ROLES: ReadonlyArray<Role> = [
  'COMPTABLE',
  'CONTROLEUR',
  'DAF',
  'TRESORIER',
  'SUPER_ADMIN',
];

export interface DashboardSummary {
  prPending: {
    byStatus: Record<PendingPrStatus, number>;
    total: number;
    /** true si le compte est restreint aux DA de l'utilisateur. */
    scopedToOwn: boolean;
  };
  /** Factures en statut `captured` (à rapprocher). null = rôle non autorisé. */
  invoicesToMatch: number | null;
  activeGrants: number;
  /** Runs `executed` depuis le 1er du mois (runDate). null = rôle non autorisé. */
  paymentsExecutedThisMonth: number | null;
}

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(private readonly prisma: PrismaService) {}

  async summary(actor: AuthenticatedUser): Promise<DashboardSummary> {
    const hasFullPrView = actor.roles.some((r) => PR_FULL_VIEW_ROLES.includes(r));
    const hasAccountingView = actor.roles.some((r) => ACCOUNTING_VIEW_ROLES.includes(r));

    // Scoping DA : bridge email → app_user SANS auto-provisioning (un user
    // jamais vu n'a par définition aucune DA à compter).
    let requestedBy: string | undefined;
    if (!hasFullPrView) {
      const appUser = await this.prisma.appUser.findUnique({
        where: { email: actor.email },
        select: { id: true },
      });
      if (!appUser) {
        return this.emptyScopedSummary(actor, hasAccountingView);
      }
      requestedBy = appUser.id;
    }

    const firstOfMonth = this.firstOfCurrentMonthUtc();

    const [prGroups, invoicesToMatch, activeGrants, paymentsExecutedThisMonth] =
      await Promise.all([
        this.prisma.purchaseRequest.groupBy({
          by: ['status'],
          where: {
            status: { in: [...PENDING_PR_STATUSES] },
            ...(requestedBy ? { requestedBy } : {}),
          },
          _count: { _all: true },
        }),
        hasAccountingView
          ? this.prisma.invoice.count({ where: { status: 'captured' } })
          : Promise.resolve(null),
        this.prisma.grantAgreement.count({ where: { status: 'active' } }),
        hasAccountingView
          ? this.prisma.paymentRun.count({
              where: { status: 'executed', runDate: { gte: firstOfMonth } },
            })
          : Promise.resolve(null),
      ]);

    const byStatus = Object.fromEntries(
      PENDING_PR_STATUSES.map((s) => [s, 0]),
    ) as Record<PendingPrStatus, number>;
    for (const g of prGroups) {
      byStatus[g.status as PendingPrStatus] = g._count._all;
    }
    const total = Object.values(byStatus).reduce((sum, n) => sum + n, 0);

    this.logger.log(
      { actorId: actor.id, scopedToOwn: !hasFullPrView, prPendingTotal: total },
      'dashboard summary computed',
    );

    return {
      prPending: { byStatus, total, scopedToOwn: !hasFullPrView },
      invoicesToMatch,
      activeGrants,
      paymentsExecutedThisMonth,
    };
  }

  /** Cas user inconnu de app_user : 0 DA propre, le reste selon les droits. */
  private async emptyScopedSummary(
    actor: AuthenticatedUser,
    hasAccountingView: boolean,
  ): Promise<DashboardSummary> {
    const firstOfMonth = this.firstOfCurrentMonthUtc();
    const [invoicesToMatch, activeGrants, paymentsExecutedThisMonth] = await Promise.all([
      hasAccountingView
        ? this.prisma.invoice.count({ where: { status: 'captured' } })
        : Promise.resolve(null),
      this.prisma.grantAgreement.count({ where: { status: 'active' } }),
      hasAccountingView
        ? this.prisma.paymentRun.count({
            where: { status: 'executed', runDate: { gte: firstOfMonth } },
          })
        : Promise.resolve(null),
    ]);
    const byStatus = Object.fromEntries(
      PENDING_PR_STATUSES.map((s) => [s, 0]),
    ) as Record<PendingPrStatus, number>;
    return {
      prPending: { byStatus, total: 0, scopedToOwn: true },
      invoicesToMatch,
      activeGrants,
      paymentsExecutedThisMonth,
    };
  }

  private firstOfCurrentMonthUtc(): Date {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  }
}

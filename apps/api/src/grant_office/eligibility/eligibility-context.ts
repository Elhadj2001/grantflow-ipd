import type { Prisma } from '@prisma/client';

/**
 * Domaine des catégories comptables — miroir des CHECK PostgreSQL
 * `ref.budget_line.category` (US-055) et `grant_office.expense_nature.category`
 * (US-030). Type documentaire : la cohérence métier est validée par le moteur
 * (LineNatureCoherentRule, ADR-007) et le CHECK PG — PAS par Zod (règle 8/§8
 * CLAUDE.md : pas de validation d'éligibilité dupliquée).
 */
export type BudgetCategory =
  | 'functioning'
  | 'equipment'
  | 'personnel'
  | 'missions'
  | 'subcontracting'
  | 'overhead'
  | 'other';

/**
 * Données transportées entre les règles d'éligibilité (ADR-007).
 *
 * - pr                  : la demande d'achat évaluée.
 * - actor               : l'utilisateur qui soumet (règles RBAC indirectes).
 * - grant               : la convention parent.
 * - activeNoteTechnique : Note Technique active du grant. Si null, certaines
 *                         règles ne peuvent pas s'évaluer (l'engine doit le
 *                         détecter en amont).
 * - eligibilityRules    : règles spécifiques de la convention pour ce grant.
 * - budgetLine          : la ligne budgétaire ciblée par la DA.
 * - expenseNature       : nature de dépense résolue depuis pr.expenseNatureCode.
 * - now                 : horloge injectée (testabilité, cf. fakeTimers / F22).
 */
export interface EligibilityContext {
  pr: {
    id?: string;
    grantId: string;
    budgetLineId: string;
    totalAmount: Prisma.Decimal;
    /** Populé après convertToXof (ADR-005). */
    totalAmountXof?: number;
    currency: string;
    expenseNatureCode: string;
    requestedById: string;
    requestedAt?: Date;
  };
  actor: {
    id: string;
    roles: string[];
  };
  grant: {
    id: string;
    currency: string;
    startDate: Date;
    endDate: Date;
  };
  activeNoteTechnique: {
    id: string;
    overheadRuleId: string | null;
    singleActorAuthorized: boolean;
  } | null;
  eligibilityRules: Array<{
    expenseNatureId: string;
    maxPerRequestXof: bigint | null;
    maxPerYearXof: bigint | null;
    excluded: boolean;
  }>;
  budgetLine: {
    id: string;
    budgetedAmountXof: bigint | null;
    currency: string | null;
    /**
     * Catégorie comptable RÉSOLUE de la ligne (US-056) : lecture directe de
     * `ref.budget_line.category` (US-055) ; si NULL (donnée historique
     * pré-US-055), fallback proxy = catégorie de la nature (WARN
     * `us049_proxy_fallback_used`, jamais bloquant). Jamais null après build.
     */
    category: BudgetCategory | string;
  };
  expenseNature: {
    id: string;
    code: string;
    category: string;
  };
  now: Date;
}

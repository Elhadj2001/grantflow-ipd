import type { Prisma } from '@prisma/client';

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
    category: string;
  };
  expenseNature: {
    id: string;
    code: string;
    category: string;
  };
  now: Date;
}

import { Injectable } from '@nestjs/common';
import type { EligibilityRule } from './rule.interface';
import type { EligibilityContext } from '../eligibility-context';
import type { Verdict } from '../verdict';
import { OK, blocked } from '../verdict';

/**
 * US-044 — Cohérence ligne budgétaire ↔ nature de dépense (ADR-007).
 *
 * Une nature de dépense ne peut être imputée que sur une ligne budgétaire
 * dont la catégorie est compatible. La matrice ci-dessous traduit les
 * catégories du référentiel `expense_nature` (CHECK : functioning,
 * equipment, personnel, missions, subcontracting, overhead, other).
 *
 * Tolérances métier :
 * - une ligne `functioning` accepte aussi l'`overhead` (frais indirects
 *   refacturables imputés en fonctionnement) ;
 * - une ligne `other` est volontairement tolérante (fourre-tout
 *   conventionnel) et accepte functioning / overhead en plus de `other`.
 *
 * Si la catégorie de la ligne budgétaire n'est pas répertoriée dans la
 * matrice, la règle ne bloque pas (OK) : une catégorie inconnue relève
 * d'une autre règle / d'un contrôle référentiel, pas de la cohérence.
 */
const COMPATIBILITY_MATRIX: Record<string, readonly string[]> = {
  functioning: ['functioning', 'overhead'],
  equipment: ['equipment'],
  personnel: ['personnel'],
  missions: ['missions'],
  subcontracting: ['subcontracting'],
  overhead: ['overhead'],
  other: ['other', 'functioning', 'overhead'], // 'other' tolérant
};

@Injectable()
export class LineNatureCoherentRule implements EligibilityRule {
  readonly code = 'ELIG_LINE_NATURE_INCOHERENT';
  readonly severity = 'blocking' as const;

  async check(ctx: EligibilityContext): Promise<Verdict> {
    const lineCategory = ctx.budgetLine.category;
    const natureCategory = ctx.expenseNature.category;

    const allowed = COMPATIBILITY_MATRIX[lineCategory];

    // Catégorie de ligne non répertoriée : ne pas bloquer (cf. doc ci-dessus).
    if (allowed === undefined) {
      return OK;
    }

    if (allowed.includes(natureCategory)) {
      return OK;
    }

    return blocked(
      this.code,
      `Nature ${ctx.expenseNature.code} (${natureCategory}) incompatible avec une ligne budgétaire ${lineCategory}.`,
      { lineCategory, natureCategory },
    );
  }
}

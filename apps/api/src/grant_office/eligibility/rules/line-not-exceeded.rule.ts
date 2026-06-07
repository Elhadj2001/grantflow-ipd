import { Injectable } from '@nestjs/common';
import type { EligibilityRule } from './rule.interface';
import type { EligibilityContext } from '../eligibility-context';
import type { Verdict } from '../verdict';
import { OK, blocked } from '../verdict';

/**
 * Règle d'éligibilité LineNotExceeded (US-043, ADR-007).
 *
 * Vérifie que le montant total de la DA (en XOF) ne dépasse pas le plafond
 * unitaire par requête (`maxPerRequestXof`) défini pour la nature de dépense
 * dans les règles d'éligibilité de la convention.
 *
 * Pré-requis : `pr.totalAmountXof` doit avoir été calculé en amont via
 * `ExchangeRateService.convertToXof` (US-049, ADR-005). Si absent, la règle
 * bloque explicitement plutôt que de comparer un montant non converti.
 *
 * Remarque précision : `Number(bigint)` est sûr ici car les montants XOF
 * restent largement sous 2^53.
 */
@Injectable()
export class LineNotExceededRule implements EligibilityRule {
  readonly code = 'ELIG_LINE_BUDGET_EXCEEDED';
  readonly severity = 'blocking' as const;

  async check(ctx: EligibilityContext): Promise<Verdict> {
    const rule = ctx.eligibilityRules.find(
      (r) => r.expenseNatureId === ctx.expenseNature.id,
    );
    const threshold = rule?.maxPerRequestXof ?? null;

    const totalAmountXof = ctx.pr.totalAmountXof;
    if (totalAmountXof === undefined || totalAmountXof === null) {
      return blocked(
        'ELIG_XOF_NOT_COMPUTED',
        'Montant XOF non calculé (convertToXof requis en amont, US-049).',
      );
    }

    if (threshold === null) {
      return OK;
    }

    if (totalAmountXof > Number(threshold)) {
      return blocked(
        'ELIG_LINE_BUDGET_EXCEEDED',
        `Montant ${totalAmountXof} XOF dépasse le plafond par requête ${threshold} XOF.`,
        { maxPerRequestXof: Number(threshold), totalAmountXof },
      );
    }

    return OK;
  }
}

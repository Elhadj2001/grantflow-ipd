import { Injectable } from '@nestjs/common';
import type { EligibilityRule } from './rule.interface';
import type { EligibilityContext } from '../eligibility-context';
import type { Verdict } from '../verdict';
import { OK, blocked } from '../verdict';

/**
 * US-042 — Fenêtre temporelle de la convention.
 *
 * Une dépense n'est éligible que si sa date effective tombe dans la fenêtre
 * [grant.startDate, grant.endDate] (bornes INCLUSIVES). La date effective est
 * `pr.requestedAt` si renseignée, sinon l'horloge injectée `ctx.now`.
 *
 * Règle bloquante (ADR-007) : une DA hors fenêtre ne peut pas être soumise.
 */
@Injectable()
export class DateWindowRule implements EligibilityRule {
  readonly code = 'ELIG_DATE_OUT_OF_WINDOW';
  readonly severity = 'blocking' as const;

  async check(ctx: EligibilityContext): Promise<Verdict> {
    const effectiveDate = ctx.pr.requestedAt ?? ctx.now;
    const effective = effectiveDate.getTime();
    const start = ctx.grant.startDate.getTime();
    const end = ctx.grant.endDate.getTime();

    if (effective < start || effective > end) {
      return blocked(
        this.code,
        `Date ${effectiveDate.toISOString().slice(0, 10)} hors de la fenêtre de la convention.`,
        {
          startDate: ctx.grant.startDate,
          endDate: ctx.grant.endDate,
        },
      );
    }

    return OK;
  }
}

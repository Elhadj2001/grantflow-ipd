import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import type { EligibilityRule } from './rule.interface';
import type { EligibilityContext } from '../eligibility-context';
import type { Verdict } from '../verdict';
import { OK, blocked } from '../verdict';

/**
 * Règle d'éligibilité PeriodNotClosed (US-047, ADR-007).
 *
 * Vérifie qu'une période fiscale OUVERTE couvre la date effective de la DA.
 * La date effective est `pr.requestedAt` si renseignée, sinon l'horloge
 * injectée `now` (testabilité, cf. F22).
 *
 * Une période est éligible si elle encadre la date (`startDate <= date <=
 * endDate`) et n'est pas clôturée (`isClosed = false`). En l'absence d'une
 * telle période, aucune écriture comptable ne pourra être passée (cf. règle
 * d'or 7, trigger `gl.check_period_open`) : la règle bloque donc en amont.
 *
 * Cette règle nécessite un accès base (lookup `fiscalPeriod`) : injection de
 * `PrismaService` via le constructeur.
 */
@Injectable()
export class PeriodNotClosedRule implements EligibilityRule {
  readonly code = 'ELIG_PERIOD_CLOSED';
  readonly severity = 'blocking' as const;

  constructor(private readonly prisma: PrismaService) {}

  async check(ctx: EligibilityContext): Promise<Verdict> {
    const effectiveDate = ctx.pr.requestedAt ?? ctx.now;

    const period = await this.prisma.fiscalPeriod.findFirst({
      where: {
        startDate: { lte: effectiveDate },
        endDate: { gte: effectiveDate },
        isClosed: false,
      },
      select: { id: true, code: true },
    });

    if (period) {
      return OK;
    }

    return blocked(
      'ELIG_PERIOD_CLOSED',
      `Aucune période fiscale ouverte ne couvre la date ${effectiveDate.toISOString().slice(0, 10)}.`,
      { effectiveDate: effectiveDate.toISOString().slice(0, 10) },
    );
  }
}

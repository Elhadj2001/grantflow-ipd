import { Injectable } from '@nestjs/common';
import type { EligibilityRule } from './rule.interface';
import type { EligibilityContext } from '../eligibility-context';
import type { Verdict } from '../verdict';
import { OK, blocked } from '../verdict';

/**
 * Règle d'éligibilité : dépense déjà refacturée à Pasteur Paris (US-045, ADR-007).
 *
 * Une dépense déjà refacturée à l'Institut Pasteur (Paris) ne peut pas être
 * imputée une seconde fois sur une convention bailleur — sinon double
 * financement de la même charge.
 *
 * TODO Sprint S6 : ajouter pr.pasteurParisReimbursed au DDL/DTO ; tant
 * qu'absent, no-op. Le drapeau n'existe pas encore ni dans
 * `EligibilityContext.pr` ni dans le schéma Prisma. La règle est donc livrée
 * dès maintenant (placeholder centralisé conforme à l'ADR-007) mais reste
 * effectivement inerte tant que le drapeau n'est pas peuplé : on le lit de
 * façon défensive via un cast local, sans modifier le type du contexte.
 */
@Injectable()
export class NotPasteurParisReimbursedRule implements EligibilityRule {
  readonly code = 'ELIG_PASTEUR_PARIS_REIMBURSED';
  readonly severity = 'blocking' as const;

  async check(ctx: EligibilityContext): Promise<Verdict> {
    // Lecture défensive : le drapeau n'est pas (encore) dans le type du
    // contexte. Tant qu'il est absent (undefined) la règle est un no-op.
    const flag = (ctx.pr as { pasteurParisReimbursed?: boolean }).pasteurParisReimbursed;

    if (flag === true) {
      return blocked(
        'ELIG_PASTEUR_PARIS_REIMBURSED',
        'Dépense déjà refacturée à Pasteur Paris — non éligible.',
      );
    }

    return OK;
  }
}

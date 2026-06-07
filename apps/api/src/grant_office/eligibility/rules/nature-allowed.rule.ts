import { Injectable } from '@nestjs/common';
import type { EligibilityRule } from './rule.interface';
import type { EligibilityContext } from '../eligibility-context';
import type { Verdict } from '../verdict';
import { OK, blocked } from '../verdict';

/**
 * NatureAllowedRule (US-041) — règle d'éligibilité « nature autorisée ».
 *
 * Vérifie qu'une nature de dépense n'est pas explicitement exclue par la
 * Note Technique active de la convention (ADR-006, ADR-007).
 *
 * Sémantique :
 * - Pas de Note Technique active → on ne peut rien valider : blocked
 *   ('ELIG_NO_ACTIVE_NOTE_TECHNIQUE'). C'est l'engine qui doit normalement
 *   le détecter en amont, mais la règle reste défensive.
 * - Règle d'éligibilité trouvée pour la nature ET excluded = true →
 *   blocked('ELIG_NATURE_NOT_ALLOWED').
 * - Aucune règle trouvée pour la nature → OK. Mode PERMISSIF assumé :
 *   l'absence d'entrée signifie « implicitement éligible ». Un mode strict
 *   (whitelist : tout ce qui n'est pas listé est refusé) pourrait être
 *   introduit ultérieurement via un flag porté par la Note Technique.
 * - Règle trouvée mais excluded = false → OK.
 */
@Injectable()
export class NatureAllowedRule implements EligibilityRule {
  readonly code = 'ELIG_NATURE_NOT_ALLOWED';
  readonly severity = 'blocking' as const;

  async check(ctx: EligibilityContext): Promise<Verdict> {
    if (ctx.activeNoteTechnique === null) {
      return blocked(
        'ELIG_NO_ACTIVE_NOTE_TECHNIQUE',
        'Aucune Note Technique active pour cette convention.',
      );
    }

    const rule = ctx.eligibilityRules.find(
      (r) => r.expenseNatureId === ctx.expenseNature.id,
    );

    if (rule !== undefined && rule.excluded === true) {
      return blocked(
        'ELIG_NATURE_NOT_ALLOWED',
        `Nature ${ctx.expenseNature.code} explicitement exclue par la Note Technique active.`,
        { expenseNatureCode: ctx.expenseNature.code },
      );
    }

    // Aucune règle trouvée (mode permissif) ou règle non exclue → éligible.
    return OK;
  }
}

import { Injectable, Logger, NotImplementedException } from '@nestjs/common';
import type { EligibilityContext } from './eligibility-context';
import type { Verdict } from './verdict';

/**
 * EligibilityEngine — moteur CENTRALISÉ de validation des règles
 * d'éligibilité métier IPD issues du PPT IPD slide 7 (cf. ADR-007).
 *
 * Composition (US-040 pose les types ; règles & orchestration à venir) :
 *  - contrat `EligibilityRule` (rules/rule.interface.ts) ;
 *  - type `Verdict` (verdict.ts : ok / blocked / warning) ;
 *  - `EligibilityContext` (eligibility-context.ts) ;
 *  - 7 règles core : US-041 → US-047 ;
 *  - orchestration `validate()` : US-048.
 *
 * Règle d'or n°8 (CLAUDE.md) : aucune validation d'éligibilité métier ne doit
 * exister hors de ce moteur. Zod valide la STRUCTURE ; ce moteur la COHÉRENCE.
 *
 * @see docs/adr/adr-007-eligibility-engine.md
 */
@Injectable()
export class EligibilityEngineService {
  private readonly logger = new Logger(EligibilityEngineService.name);

  /**
   * Évalue toutes les règles enregistrées contre le contexte fourni et
   * retourne un Verdict agrégé. Implémentation US-048 (Sprint S5).
   */
  async validate(_context: EligibilityContext): Promise<Verdict> {
    this.logger.warn(
      { event: 'eligibility_engine_not_implemented' },
      'EligibilityEngine.validate appelé (placeholder US-040)',
    );
    throw new NotImplementedException(
      'EligibilityEngine.validate sera implémenté en US-048 (Sprint S5).',
    );
  }
}

import { Injectable, Logger, NotImplementedException } from '@nestjs/common';

/**
 * EligibilityEngine — moteur CENTRALISÉ de validation des règles
 * d'éligibilité métier IPD (cf. ADR-007).
 *
 * Responsabilités FUTURES (Sprint S5+) — actuellement PLACEHOLDER :
 *  - Valider qu'une dépense (nature, montant XOF, date) est éligible pour
 *    une convention, à partir de grant_office.eligibility_rule et du
 *    catalogue grant_office.expense_nature.
 *  - Appliquer les plafonds (max_per_request_xof, max_per_year_xof) et le
 *    flag `excluded`.
 *  - Contrôler la fenêtre temporelle (dates de la convention / Note Technique).
 *  - Gérer la refacturation Pasteur Paris.
 *
 * Règle d'or n°8 (CLAUDE.md) : aucune validation d'éligibilité métier ne doit
 * exister hors de ce moteur. Zod valide la STRUCTURE ; ce moteur valide la
 * COHÉRENCE métier.
 */
@Injectable()
export class EligibilityEngineService {
  private readonly logger = new Logger(EligibilityEngineService.name);

  /**
   * PLACEHOLDER. Lèvera l'évaluation d'éligibilité une fois implémentée.
   * @throws NotImplementedException tant que le moteur n'est pas livré.
   */
  validate(): never {
    this.logger.warn({ event: 'eligibility_engine_not_implemented' }, 'EligibilityEngine.validate appelé (placeholder)');
    throw new NotImplementedException('EligibilityEngine sera implémenté en Sprint S5+');
  }
}

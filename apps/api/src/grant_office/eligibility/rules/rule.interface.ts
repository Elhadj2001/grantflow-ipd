import type { Verdict } from '../verdict';
import type { EligibilityContext } from '../eligibility-context';

/**
 * Contrat commun à toutes les règles d'éligibilité (ADR-007).
 *
 * - code     : identifiant stable (ex 'ELIG_NATURE_NOT_ALLOWED'). Utilisé
 *              dans les logs et les codes d'erreur côté UI.
 * - severity : 'blocking' = lève blocked si non satisfait ;
 *              'warning' = lève warning, n'empêche pas.
 * - check    : évalue la règle contre le contexte, retourne un Verdict.
 *              Async pour permettre les lookups DB si nécessaire.
 *
 * Les 7 règles core sont livrées en US-041 à US-047 ; l'orchestrateur en
 * US-048.
 */
export interface EligibilityRule {
  readonly code: string;
  readonly severity: 'blocking' | 'warning';
  check(context: EligibilityContext): Promise<Verdict>;
}

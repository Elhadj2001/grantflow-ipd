import type { Verdict, BlockedVerdict, WarningVerdict } from './verdict';

/**
 * Résultat agrégé d'une évaluation EligibilityEngine (US-048, ADR-007).
 *
 * - ok              : true si aucune règle blocking n'a refusé.
 * - blockedVerdicts : liste des verdicts blocked retournés (≥ 1 si !ok).
 * - warnings        : liste des verdicts warning collectés (non bloquants,
 *                     à surfacer côté UI).
 * - verdictsByRule  : map code → verdict (debug + log).
 */
export interface EligibilityResult {
  ok: boolean;
  blockedVerdicts: BlockedVerdict[];
  warnings: WarningVerdict[];
  verdictsByRule: Record<string, Verdict>;
}

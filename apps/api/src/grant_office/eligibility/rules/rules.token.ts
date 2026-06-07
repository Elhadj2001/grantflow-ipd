import type { EligibilityRule } from './rule.interface';

/**
 * Token NestJS pour injecter la liste des règles EligibilityRule
 * enregistrées. Utilisé en Multi-Inject via @Inject(ELIGIBILITY_RULES).
 */
export const ELIGIBILITY_RULES = Symbol('ELIGIBILITY_RULES');

export type EligibilityRulesProvider = EligibilityRule[];

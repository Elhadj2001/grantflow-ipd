import { Inject, Injectable, Logger } from '@nestjs/common';
import type { EligibilityContext } from './eligibility-context';
import type { EligibilityResult } from './eligibility-result';
import type { Verdict, BlockedVerdict, WarningVerdict } from './verdict';
import { isBlocking, isWarning } from './verdict';
import { ELIGIBILITY_RULES, type EligibilityRulesProvider } from './rules/rules.token';

/**
 * EligibilityEngine — orchestrateur des règles d'éligibilité (ADR-007).
 *
 * Évalue toutes les règles enregistrées (Multi-Inject via ELIGIBILITY_RULES)
 * EN PARALLÈLE et agrège les verdicts :
 *  - ≥ 1 verdict `blocked` → résultat global non éligible (ok = false) ;
 *  - les `warning` sont collectés séparément (non bloquants, surfacés UI).
 *
 * Règle d'or n°8 (CLAUDE.md) : toute validation d'éligibilité métier passe
 * par ce moteur. Les règles concrètes : US-041 → US-047.
 *
 * @see docs/adr/adr-007-eligibility-engine.md
 */
@Injectable()
export class EligibilityEngineService {
  private readonly logger = new Logger(EligibilityEngineService.name);

  constructor(
    @Inject(ELIGIBILITY_RULES)
    private readonly rules: EligibilityRulesProvider,
  ) {}

  async validate(context: EligibilityContext): Promise<EligibilityResult> {
    const verdictsByRule: Record<string, Verdict> = {};
    const blockedVerdicts: BlockedVerdict[] = [];
    const warnings: WarningVerdict[] = [];

    // Exécution PARALLÈLE : les règles sont indépendantes.
    const evaluations = await Promise.all(
      this.rules.map(async (rule) => ({ rule, verdict: await rule.check(context) })),
    );

    for (const { rule, verdict } of evaluations) {
      verdictsByRule[rule.code] = verdict;
      if (isBlocking(verdict)) {
        blockedVerdicts.push(verdict);
      } else if (isWarning(verdict)) {
        warnings.push(verdict);
      }
    }

    const result: EligibilityResult = {
      ok: blockedVerdicts.length === 0,
      blockedVerdicts,
      warnings,
      verdictsByRule,
    };

    this.logger.log(
      {
        event: 'eligibility_validation',
        prId: context.pr.id,
        grantId: context.pr.grantId,
        rulesEvaluated: this.rules.length,
        blockedCount: blockedVerdicts.length,
        warningCount: warnings.length,
        ok: result.ok,
        blockedCodes: blockedVerdicts.map((v) => v.code),
        warningCodes: warnings.map((v) => v.code),
      },
      result.ok
        ? `Eligibility OK (${warnings.length} warning(s))`
        : `Eligibility BLOCKED by ${blockedVerdicts.length} rule(s)`,
    );

    return result;
  }
}

import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ExchangeRateModule } from '../../referential/exchange-rate/exchange-rate.module';
import { EligibilityEngineService } from './eligibility-engine.service';
import { EligibilityContextBuilder } from './eligibility-context-builder.service';
import { NatureAllowedRule } from './rules/nature-allowed.rule';
import { DateWindowRule } from './rules/date-window.rule';
import { LineNotExceededRule } from './rules/line-not-exceeded.rule';
import { LineNatureCoherentRule } from './rules/line-nature-coherent.rule';
import { NotPasteurParisReimbursedRule } from './rules/not-pasteur-paris-reimbursed.rule';
import { NoCrossProjectDuplicateRule } from './rules/no-cross-project-duplicate.rule';
import { PeriodNotClosedRule } from './rules/period-not-closed.rule';
import { ELIGIBILITY_RULES } from './rules/rules.token';
import type { EligibilityRule } from './rules/rule.interface';

/**
 * Module Eligibility (ADR-007). Enregistre les 7 règles core (US-041→047)
 * + l'orchestrateur EligibilityEngine (US-048). Le token ELIGIBILITY_RULES
 * agrège les règles via useFactory (Multi-Inject) — l'ORDRE n'a pas
 * d'importance, l'engine exécute tout en parallèle.
 *
 * US-049 : expose aussi EligibilityContextBuilder (charge le contexte depuis
 * la BD + convertit en XOF) pour que PurchaseRequestService puisse brancher
 * l'éligibilité au moment du submit. Nécessite ExchangeRateModule (conversion).
 */
@Module({
  imports: [PrismaModule, ExchangeRateModule],
  providers: [
    NatureAllowedRule,
    DateWindowRule,
    LineNotExceededRule,
    LineNatureCoherentRule,
    NotPasteurParisReimbursedRule,
    NoCrossProjectDuplicateRule,
    PeriodNotClosedRule,
    {
      provide: ELIGIBILITY_RULES,
      useFactory: (...rules: EligibilityRule[]): EligibilityRule[] => rules,
      inject: [
        NatureAllowedRule,
        DateWindowRule,
        LineNotExceededRule,
        LineNatureCoherentRule,
        NotPasteurParisReimbursedRule,
        NoCrossProjectDuplicateRule,
        PeriodNotClosedRule,
      ],
    },
    EligibilityEngineService,
    EligibilityContextBuilder,
  ],
  exports: [EligibilityEngineService, EligibilityContextBuilder],
})
export class EligibilityModule {}

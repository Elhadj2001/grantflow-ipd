import { Module } from '@nestjs/common';
import { EligibilityEngineService } from './eligibility-engine.service';

/**
 * Module Eligibility — héberge l'EligibilityEngine (ADR-007).
 * US-033 : placeholder. Sera connecté à expense_nature / eligibility_rule
 * en Sprint S5+.
 */
@Module({
  providers: [EligibilityEngineService],
  exports: [EligibilityEngineService],
})
export class EligibilityModule {}

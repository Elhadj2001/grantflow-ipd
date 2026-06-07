import { Module } from '@nestjs/common';
import { ExpenseNatureModule } from './expense-nature/expense-nature.module';
import { OverheadRuleModule } from './overhead-rule/overhead-rule.module';
import { NoteTechniqueModule } from './note-technique/note-technique.module';
import { EligibilityModule } from './eligibility/eligibility.module';

/**
 * Module racine du bounded context Grant Office (Phase 5A).
 * Agrège les sous-modules : catalogue natures de dépense (read-only),
 * règles d'overhead (CRUD), Notes Techniques (CRUD draft — workflow S5),
 * eligibility engine (placeholder S5+). Réf : ADR-006, ADR-007.
 */
@Module({
  imports: [ExpenseNatureModule, OverheadRuleModule, NoteTechniqueModule, EligibilityModule],
  exports: [ExpenseNatureModule, OverheadRuleModule, NoteTechniqueModule, EligibilityModule],
})
export class GrantOfficeModule {}

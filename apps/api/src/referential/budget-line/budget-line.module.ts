import { Module } from '@nestjs/common';
import { BudgetLineController } from './budget-line.controller';
import { BudgetLineService } from './budget-line.service';
import { ExchangeRateModule } from '../exchange-rate/exchange-rate.module';

@Module({
  // US-024 (ADR-005) : BudgetLineService fige l'équivalent XOF via
  // ExchangeRateService au paramétrage de la ligne budgétaire.
  imports: [ExchangeRateModule],
  controllers: [BudgetLineController],
  providers: [BudgetLineService],
  exports: [BudgetLineService],
})
export class BudgetLineModule {}

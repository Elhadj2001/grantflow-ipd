import { Module } from '@nestjs/common';
import { BudgetLineController } from './budget-line.controller';
import { BudgetLineService } from './budget-line.service';

@Module({
  controllers: [BudgetLineController],
  providers: [BudgetLineService],
  exports: [BudgetLineService],
})
export class BudgetLineModule {}

import { Module } from '@nestjs/common';
import { ExpenseNatureController } from './expense-nature.controller';
import { ExpenseNatureService } from './expense-nature.service';

@Module({
  controllers: [ExpenseNatureController],
  providers: [ExpenseNatureService],
  exports: [ExpenseNatureService],
})
export class ExpenseNatureModule {}

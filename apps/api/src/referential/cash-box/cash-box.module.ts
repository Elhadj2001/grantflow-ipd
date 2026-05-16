import { Module } from '@nestjs/common';
import { CashBoxController } from './cash-box.controller';
import { CashBoxService } from './cash-box.service';

@Module({
  controllers: [CashBoxController],
  providers: [CashBoxService],
  exports: [CashBoxService],
})
export class CashBoxModule {}

import { Module } from '@nestjs/common';
import { OverheadRuleController } from './overhead-rule.controller';
import { OverheadRuleService } from './overhead-rule.service';

@Module({
  controllers: [OverheadRuleController],
  providers: [OverheadRuleService],
  exports: [OverheadRuleService],
})
export class OverheadRuleModule {}

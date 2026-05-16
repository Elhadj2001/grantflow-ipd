import { Module } from '@nestjs/common';
import { AnalyticalAxisController } from './analytical-axis.controller';
import { AnalyticalAxisService } from './analytical-axis.service';

@Module({
  controllers: [AnalyticalAxisController],
  providers: [AnalyticalAxisService],
  exports: [AnalyticalAxisService],
})
export class AnalyticalAxisModule {}

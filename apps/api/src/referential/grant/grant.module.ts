import { Module } from '@nestjs/common';
import { GrantController } from './grant.controller';
import { GrantService } from './grant.service';

@Module({
  controllers: [GrantController],
  providers: [GrantService],
  exports: [GrantService],
})
export class GrantModule {}

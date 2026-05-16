import { Module } from '@nestjs/common';
import { GlAccountController } from './gl-account.controller';
import { GlAccountService } from './gl-account.service';

@Module({
  controllers: [GlAccountController],
  providers: [GlAccountService],
  exports: [GlAccountService],
})
export class GlAccountModule {}

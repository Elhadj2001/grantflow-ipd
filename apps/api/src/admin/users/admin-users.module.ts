import { Module } from '@nestjs/common';
import { KeycloakAdminModule } from '../keycloak/keycloak-admin.module';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';

@Module({
  imports: [KeycloakAdminModule],
  controllers: [AdminUsersController],
  providers: [AdminUsersService],
  exports: [AdminUsersService],
})
export class AdminUsersModule {}

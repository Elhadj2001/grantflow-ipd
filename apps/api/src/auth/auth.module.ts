import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { AuthController } from './auth.controller';
import { AuditLogInterceptor } from '../common/interceptors/audit-log.interceptor';

/**
 * Module d'authentification + autorisation + audit.
 *
 * Wiring global :
 *   1. `JwtAuthGuard`   (APP_GUARD #1) — peuple `req.user` ou rejette en 401.
 *   2. `RolesGuard`     (APP_GUARD #2) — lit `@Roles()` et autorise / 403.
 *   3. `AuditLogInterceptor` (APP_INTERCEPTOR) — trace toute mutation 2xx/4xx.
 *
 * IMPORTANT : Nest exécute les `APP_GUARD` dans l'ordre de déclaration
 * du tableau `providers`. JwtAuthGuard DOIT précéder RolesGuard pour
 * que `req.user` soit déjà populé quand RolesGuard lit `user.roles`.
 *
 * `JwtModule` est conservé non pas pour valider les tokens Keycloak
 * (c'est `JwtStrategy` + `jwks-rsa` qui s'en charge via RS256), mais
 * pour pouvoir signer des tokens internes en sprint futur (ex : tokens
 * de download court-terme pour les fichiers MinIO).
 */
@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (cfg: ConfigService) => ({
        secret: cfg.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: cfg.get<string>('JWT_EXPIRES_IN', '8h') },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController],
  providers: [
    JwtStrategy,
    JwtAuthGuard,
    RolesGuard,
    AuditLogInterceptor,
    // Ordre significatif : JwtAuthGuard avant RolesGuard.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditLogInterceptor },
  ],
  exports: [JwtStrategy, PassportModule, JwtModule],
})
export class AuthModule {}

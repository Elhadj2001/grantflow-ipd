import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';

/**
 * Module Auth — placeholder.
 *
 * À compléter au Sprint 0 avec :
 * - Stratégie passport-jwt vérifiant le token Keycloak (RS256, JWKS endpoint)
 * - Guard JwtAuthGuard + RolesGuard + PermissionsGuard
 * - Décorateurs @CurrentUser(), @RequireRole(), @RequirePermission()
 *
 * Voir ANTIGRAVITY_PROMPTS.md — Sprint 0.
 */
@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (cfg: ConfigService) => ({
        secret: cfg.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: cfg.get<string>('JWT_EXPIRES_IN', '8h') },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [],
  providers: [],
  exports: [JwtModule],
})
export class AuthModule {}

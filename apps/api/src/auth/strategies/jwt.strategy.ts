import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy, type StrategyOptions } from 'passport-jwt';
import { passportJwtSecret } from 'jwks-rsa';
import { isRole, type Role } from '../types/roles';
import type { KeycloakUser } from '../types/authenticated-user.type';

/**
 * Forme attendue de l'access token Keycloak (claims utilisés uniquement).
 * Tous les champs sont optionnels sauf `sub` — passport-jwt garantit déjà
 * la signature RS256, l'issuer et l'audience avant que `validate()` ne
 * soit appelé.
 */
interface KeycloakAccessTokenPayload {
  sub: string;
  email?: string;
  preferred_username?: string;
  name?: string;
  /** Claim custom mappé via `realm-roles` (cf. docker/keycloak/realm.json L112-126). */
  roles?: string[];
  /** Fallback Keycloak standard si le mapper custom est désactivé. */
  realm_access?: { roles?: string[] };
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  private static readonly logger = new Logger(JwtStrategy.name);

  constructor(config: ConfigService) {
    const keycloakUrl = config.getOrThrow<string>('KEYCLOAK_URL');
    const realm = config.getOrThrow<string>('KEYCLOAK_REALM');
    const audience = config.getOrThrow<string>('KEYCLOAK_CLIENT_ID');
    const issuer = `${keycloakUrl}/realms/${realm}`;
    const jwksUri = `${issuer}/protocol/openid-connect/certs`;

    const options: StrategyOptions = {
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      algorithms: ['RS256'],
      issuer,
      audience,
      secretOrKeyProvider: passportJwtSecret({
        cache: true,
        cacheMaxAge: 10 * 60 * 1000,
        rateLimit: true,
        jwksRequestsPerMinute: 10,
        jwksUri,
      }),
    };

    super(options);
    JwtStrategy.logger.log(`JWKS endpoint: ${jwksUri} (issuer=${issuer}, audience=${audience})`);
  }

  /**
   * Mappe le payload Keycloak vers l'abstraction métier `AuthenticatedUser`.
   *
   * Notes :
   *  - Les rôles inconnus (ne figurant pas dans `ROLES`) sont silencieusement
   *    filtrés — ne JAMAIS faire confiance aveuglément à un claim externe.
   *  - Si le token n'a pas de `sub` (cas pathologique post-vérif crypto),
   *    on rejette explicitement. Le BusinessException dédié (AUTH.INVALID_TOKEN)
   *    sera posé par le JwtAuthGuard (module 2) — ici on s'en tient à la
   *    `UnauthorizedException` de Nest pour ne pas créer de dépendance cyclique.
   */
  validate(payload: KeycloakAccessTokenPayload): KeycloakUser {
    if (!payload.sub) {
      throw new UnauthorizedException('Access token sans subject');
    }

    const rawRoles: string[] = payload.roles ?? payload.realm_access?.roles ?? [];
    const roles: Role[] = rawRoles.filter(isRole);

    return {
      id: payload.sub,
      email: payload.email ?? '',
      fullName: payload.name ?? payload.preferred_username ?? '',
      roles,
    };
  }
}

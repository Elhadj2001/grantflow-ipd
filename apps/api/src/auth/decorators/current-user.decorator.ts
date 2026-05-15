import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedUser } from '../types/authenticated-user.type';

/**
 * Injecte l'utilisateur authentifié dans un handler de controller.
 *
 * Retourne l'abstraction `AuthenticatedUser` — pas `KeycloakUser` —
 * pour ne pas coupler les controllers au provider IDP.
 *
 * Préconditions :
 *  - La route doit être protégée par `JwtAuthGuard` (cas par défaut
 *    via APP_GUARD global). Sinon `req.user` est `undefined` et
 *    l'invariant est rompu — on lève une erreur "early & loud" plutôt
 *    que de laisser le handler downstream cracher sur `user.id`.
 *
 * @example
 *   @Post()
 *   create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateDto) {
 *     return this.svc.create(user, dto);
 *   }
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const req = ctx.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    if (!req.user) {
      throw new Error(
        '@CurrentUser() used on a route without JwtAuthGuard — req.user is undefined',
      );
    }
    return req.user;
  },
);

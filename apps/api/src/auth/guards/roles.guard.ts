import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ForbiddenRoleException } from '../../common/exceptions/business.exception';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { Role } from '../types/roles';
import type { AuthenticatedUser } from '../types/authenticated-user.type';

/**
 * Garde RBAC.
 *
 * Lit la métadata `@Roles(...)` (handler + classe). Si aucune métadata
 * n'est posée, la route est laissée passer — l'autorisation est gérée
 * ailleurs (typiquement : `JwtAuthGuard` seul + logique métier).
 *
 * Si `@Roles(...)` est posé :
 *  - `req.user` doit exister (sinon mis-config — pas de `JwtAuthGuard` en amont).
 *  - L'intersection `user.roles ∩ requiredRoles` doit être non-vide (OR-logique).
 *  - Un user authentifié sans aucun rôle reconnu (ex: claim mal mappé côté
 *    Keycloak) lève `ForbiddenRoleException` plutôt qu'un crash.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    const user = req.user;
    const userRoles: readonly Role[] = user?.roles ?? [];

    if (userRoles.length === 0) {
      throw new ForbiddenRoleException(required, userRoles);
    }

    const granted = userRoles.some((r) => required.includes(r));
    if (!granted) {
      throw new ForbiddenRoleException(required, userRoles);
    }
    return true;
  }
}

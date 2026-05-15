import { SetMetadata, type CustomDecorator } from '@nestjs/common';
import type { Role } from '../types/roles';

/**
 * Clé de métadata utilisée par `RolesGuard` pour récupérer la liste
 * de rôles requis (lecture via `Reflector.getAllAndOverride`).
 */
export const ROLES_KEY = 'roles';

/**
 * Décorateur variadique typé : exige qu'au moins UN des rôles listés
 * soit présent dans `req.user.roles` (OR-logique).
 *
 * @example
 *   @Roles('DAF', 'CONTROLEUR')   // DAF OR CONTROLEUR
 *   @Post()
 *   approve() { ... }
 *
 * Le typage `Role` empêche d'appeler `@Roles('TYPO')` à la compilation.
 */
export const Roles = (...roles: Role[]): CustomDecorator<string> =>
  SetMetadata(ROLES_KEY, roles);

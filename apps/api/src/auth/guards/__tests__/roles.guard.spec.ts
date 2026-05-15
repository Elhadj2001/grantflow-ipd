import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { RolesGuard } from '../roles.guard';
import { ForbiddenRoleException } from '../../../common/exceptions/business.exception';
import { ErrorCode } from '../../../common/exceptions/error-codes';
import { ROLES_KEY } from '../../decorators/roles.decorator';
import type { AuthenticatedUser } from '../../types/authenticated-user.type';
import type { Role } from '../../types/roles';

/**
 * Tests unitaires du RolesGuard.
 *
 * Scope :
 *  - Absence de @Roles → pass-through
 *  - OR-logique sur les rôles requis
 *  - User authentifié mais sans aucun rôle reconnu → 403 (pas un crash)
 *  - User absent (mis-config : pas de JwtAuthGuard en amont) → 403
 */
describe('RolesGuard', () => {
  let reflector: jest.Mocked<Reflector>;
  let guard: RolesGuard;

  function ctxWithUser(user?: AuthenticatedUser): ExecutionContext {
    return {
      getHandler: jest.fn().mockReturnValue(function handler(): void {}),
      getClass: jest.fn().mockReturnValue(class HandlerClass {}),
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue({ user }),
      }),
    } as unknown as ExecutionContext;
  }

  const userOf = (...roles: Role[]): AuthenticatedUser => ({
    id: 'u-1',
    email: 'a@b.sn',
    fullName: 'A B',
    roles,
  });

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() } as unknown as jest.Mocked<Reflector>;
    guard = new RolesGuard(reflector);
  });

  it('lets the request pass when no @Roles metadata is set', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    expect(guard.canActivate(ctxWithUser(userOf('DEMANDEUR')))).toBe(true);
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(ROLES_KEY, [
      expect.anything(),
      expect.anything(),
    ]);
  });

  it('lets the request pass when @Roles is an empty array', () => {
    reflector.getAllAndOverride.mockReturnValue([]);
    expect(guard.canActivate(ctxWithUser(userOf('DEMANDEUR')))).toBe(true);
  });

  it('grants access when user has at least one of the required roles (OR)', () => {
    reflector.getAllAndOverride.mockReturnValue(['DAF', 'CONTROLEUR'] satisfies Role[]);
    expect(guard.canActivate(ctxWithUser(userOf('CONTROLEUR')))).toBe(true);
  });

  it('grants access when user has multiple required roles', () => {
    reflector.getAllAndOverride.mockReturnValue(['DAF', 'CONTROLEUR'] satisfies Role[]);
    expect(guard.canActivate(ctxWithUser(userOf('DAF', 'CONTROLEUR')))).toBe(true);
  });

  it('throws FORBIDDEN_ROLE when user has roles but none match', () => {
    reflector.getAllAndOverride.mockReturnValue(['DAF', 'CONTROLEUR'] satisfies Role[]);
    try {
      guard.canActivate(ctxWithUser(userOf('DEMANDEUR')));
      fail('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ForbiddenRoleException);
      const ex = e as ForbiddenRoleException;
      expect(ex.code).toBe(ErrorCode.AUTH.FORBIDDEN_ROLE);
      expect(ex.details).toEqual({
        requiredRoles: ['DAF', 'CONTROLEUR'],
        userRoles: ['DEMANDEUR'],
      });
    }
  });

  it('throws FORBIDDEN_ROLE when user has empty roles (JWT valid but no role claim)', () => {
    reflector.getAllAndOverride.mockReturnValue(['PI'] satisfies Role[]);
    try {
      guard.canActivate(ctxWithUser(userOf()));
      fail('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ForbiddenRoleException);
      expect((e as ForbiddenRoleException).code).toBe(ErrorCode.AUTH.FORBIDDEN_ROLE);
    }
  });

  it('throws FORBIDDEN_ROLE when req.user is undefined (mis-config)', () => {
    reflector.getAllAndOverride.mockReturnValue(['DAF'] satisfies Role[]);
    try {
      guard.canActivate(ctxWithUser(undefined));
      fail('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ForbiddenRoleException);
    }
  });
});

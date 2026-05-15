import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { JwtAuthGuard } from '../jwt-auth.guard';
import { UnauthenticatedException } from '../../../common/exceptions/business.exception';
import { ErrorCode } from '../../../common/exceptions/error-codes';
import { IS_PUBLIC_KEY } from '../../decorators/public.decorator';
import type { AuthenticatedUser } from '../../types/authenticated-user.type';

/**
 * Tests unitaires du JwtAuthGuard.
 *
 * Scope :
 *  - Bypass `@Public()`
 *  - Traduction des erreurs passport/jsonwebtoken → BusinessException
 *  - Propagation des BusinessException déjà typées
 *  - Cas nominal : user retourné tel quel
 *
 * Hors scope (couvert par les tests d'intégration .skip — module 6) :
 *  - Vraie vérification JWKS contre un Keycloak réel.
 */
describe('JwtAuthGuard', () => {
  let reflector: jest.Mocked<Reflector>;
  let guard: JwtAuthGuard;

  function mockContext(): ExecutionContext {
    return {
      getHandler: jest.fn().mockReturnValue(function handler(): void {}),
      getClass: jest.fn().mockReturnValue(class HandlerClass {}),
      switchToHttp: jest.fn().mockReturnValue({ getRequest: jest.fn().mockReturnValue({}) }),
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() } as unknown as jest.Mocked<Reflector>;
    guard = new JwtAuthGuard(reflector);
  });

  describe('canActivate (bypass @Public)', () => {
    it('returns true without calling passport when @Public() is set', () => {
      reflector.getAllAndOverride.mockReturnValue(true);
      const superSpy = jest
        .spyOn(Object.getPrototypeOf(Object.getPrototypeOf(guard)), 'canActivate')
        .mockImplementation(() => {
          throw new Error('super.canActivate should NOT be called for public routes');
        });

      expect(guard.canActivate(mockContext())).toBe(true);
      expect(reflector.getAllAndOverride).toHaveBeenCalledWith(IS_PUBLIC_KEY, [
        expect.anything(),
        expect.anything(),
      ]);
      expect(superSpy).not.toHaveBeenCalled();
      superSpy.mockRestore();
    });

    it('delegates to super.canActivate when @Public() is absent', () => {
      reflector.getAllAndOverride.mockReturnValue(undefined);
      const superSpy = jest
        .spyOn(Object.getPrototypeOf(Object.getPrototypeOf(guard)), 'canActivate')
        .mockReturnValue(true);

      expect(guard.canActivate(mockContext())).toBe(true);
      expect(superSpy).toHaveBeenCalled();
      superSpy.mockRestore();
    });
  });

  describe('handleRequest (translation des erreurs passport)', () => {
    const ctx = mockContext();
    const validUser: AuthenticatedUser = {
      id: 'u-1',
      email: 'a@b.sn',
      fullName: 'A B',
      roles: ['DEMANDEUR'],
    };

    it('returns the user on success', () => {
      const result = guard.handleRequest<AuthenticatedUser>(null, validUser, undefined, ctx);
      expect(result).toBe(validUser);
    });

    it('throws EXPIRED_TOKEN on TokenExpiredError from jsonwebtoken', () => {
      const info = Object.assign(new Error('jwt expired'), { name: 'TokenExpiredError' });
      const action = () => guard.handleRequest<AuthenticatedUser>(null, false, info, ctx);
      expect(action).toThrow(UnauthenticatedException);
      try {
        action();
      } catch (e) {
        expect((e as UnauthenticatedException).code).toBe(ErrorCode.AUTH.EXPIRED_TOKEN);
      }
    });

    it('throws INVALID_TOKEN on JsonWebTokenError', () => {
      const info = Object.assign(new Error('invalid signature'), { name: 'JsonWebTokenError' });
      const action = () => guard.handleRequest<AuthenticatedUser>(null, false, info, ctx);
      expect(action).toThrow(UnauthenticatedException);
      try {
        action();
      } catch (e) {
        expect((e as UnauthenticatedException).code).toBe(ErrorCode.AUTH.INVALID_TOKEN);
      }
    });

    it('throws INVALID_TOKEN on NotBeforeError', () => {
      const info = Object.assign(new Error('not before'), { name: 'NotBeforeError' });
      const action = () => guard.handleRequest<AuthenticatedUser>(null, false, info, ctx);
      try {
        action();
      } catch (e) {
        expect((e as UnauthenticatedException).code).toBe(ErrorCode.AUTH.INVALID_TOKEN);
      }
    });

    it('throws UNAUTHENTICATED when no token is provided (no err, no info)', () => {
      const action = () => guard.handleRequest<AuthenticatedUser>(null, false, undefined, ctx);
      try {
        action();
      } catch (e) {
        expect((e as UnauthenticatedException).code).toBe(ErrorCode.AUTH.UNAUTHENTICATED);
      }
    });

    it('throws UNAUTHENTICATED when JwtStrategy.validate() throws a plain Error', () => {
      const err = new Error('Access token sans subject');
      const action = () => guard.handleRequest<AuthenticatedUser>(err, false, undefined, ctx);
      try {
        action();
      } catch (e) {
        expect((e as UnauthenticatedException).code).toBe(ErrorCode.AUTH.UNAUTHENTICATED);
        expect((e as UnauthenticatedException).message).toContain('Access token sans subject');
      }
    });

    it('propagates a BusinessException already typed (does not wrap it)', () => {
      const original = new UnauthenticatedException(ErrorCode.AUTH.INVALID_TOKEN, 'tampered');
      try {
        guard.handleRequest<AuthenticatedUser>(original, false, undefined, ctx);
      } catch (e) {
        expect(e).toBe(original);
      }
    });
  });
});

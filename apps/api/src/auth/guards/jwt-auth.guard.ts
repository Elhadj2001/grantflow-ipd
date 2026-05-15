import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import {
  BusinessException,
  UnauthenticatedException,
} from '../../common/exceptions/business.exception';
import { ErrorCode } from '../../common/exceptions/error-codes';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { AuthenticatedUser } from '../types/authenticated-user.type';

/**
 * Garde d'authentification globale.
 *
 *  - Court-circuite la vérification si le handler ou la classe portent `@Public()`.
 *  - Délègue la vérification cryptographique à `AuthGuard('jwt')` (cf. JwtStrategy).
 *  - Traduit les erreurs `passport` / `jsonwebtoken` en `BusinessException`
 *    typées avec un code d'erreur i18n stable (cf. error-codes.ts).
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  override canActivate(context: ExecutionContext): ReturnType<CanActivate['canActivate']> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic === true) return true;
    return super.canActivate(context);
  }

  /**
   * `handleRequest` est appelé par passport APRÈS la vérification crypto.
   *  - Si la signature/iss/aud sont KO → `err` est null, `user` est `false`,
   *    `info` contient l'erreur jsonwebtoken (TokenExpiredError, JsonWebTokenError…).
   *  - Si `JwtStrategy.validate()` a thrown → `err` porte l'exception.
   *  - Cas nominal → `user` est l'`AuthenticatedUser` retourné par `validate()`.
   */
  override handleRequest<TUser = AuthenticatedUser>(
    err: unknown,
    user: TUser | false | null,
    info: unknown,
    _context: ExecutionContext,
    _status?: unknown,
  ): TUser {
    if (err || !user) {
      throw JwtAuthGuard.translatePassportError(err, info);
    }
    return user;
  }

  /**
   * Mappe les erreurs renvoyées par `passport-jwt` / `jsonwebtoken` vers
   * un code d'erreur stable. Une erreur déjà typée `BusinessException`
   * (ex: levée explicitement par la strategy) est propagée telle quelle.
   */
  private static translatePassportError(err: unknown, info: unknown): BusinessException {
    if (err instanceof BusinessException) return err;

    if (info instanceof Error) {
      if (info.name === 'TokenExpiredError') {
        return new UnauthenticatedException(ErrorCode.AUTH.EXPIRED_TOKEN, 'Access token expired');
      }
      if (info.name === 'JsonWebTokenError' || info.name === 'NotBeforeError') {
        return new UnauthenticatedException(ErrorCode.AUTH.INVALID_TOKEN, 'Access token invalid');
      }
    }

    if (err instanceof Error && err.message) {
      return new UnauthenticatedException(ErrorCode.AUTH.UNAUTHENTICATED, err.message);
    }

    return new UnauthenticatedException(
      ErrorCode.AUTH.UNAUTHENTICATED,
      'No valid access token provided',
    );
  }
}

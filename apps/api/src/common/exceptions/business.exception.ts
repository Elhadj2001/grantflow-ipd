import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode, type ErrorCodeValue } from './error-codes';
import type { Role } from '../../auth/types/roles';

/**
 * Forme sérialisée d'une `BusinessException` (corps de la réponse HTTP).
 *
 * En PROD un `ExceptionFilter` global devra masquer `message` et `details`
 * pour ne renvoyer que `{ code }` au client — cf. ErrorCode catalogue.
 * En DEV/TEST on conserve l'objet complet pour faciliter le debug.
 */
export interface BusinessExceptionBody {
  code: ErrorCodeValue;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Exception métier typée. Toutes les erreurs fonctionnelles de l'API
 * doivent passer par cette classe (ou une sous-classe) — jamais de
 * `HttpException` nu, jamais de `throw new Error(...)`.
 */
export class BusinessException extends HttpException {
  constructor(
    public readonly code: ErrorCodeValue,
    status: HttpStatus,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    const body: BusinessExceptionBody = { code, message };
    if (details !== undefined) body.details = details;
    super(body, status);
  }
}

/**
 * 401 — accès sans authentification valide.
 *
 * Couvre :
 *  - aucun bearer token fourni       → `AUTH.UNAUTHENTICATED`
 *  - token expiré                    → `AUTH.EXPIRED_TOKEN`
 *  - token mal formé / signature KO  → `AUTH.INVALID_TOKEN`
 *
 * Le `JwtAuthGuard` traduit les erreurs passport/jsonwebtoken en l'un
 * de ces 3 codes.
 */
export class UnauthenticatedException extends BusinessException {
  constructor(
    code:
      | typeof ErrorCode.AUTH.UNAUTHENTICATED
      | typeof ErrorCode.AUTH.INVALID_TOKEN
      | typeof ErrorCode.AUTH.EXPIRED_TOKEN = ErrorCode.AUTH.UNAUTHENTICATED,
    message = 'Authentication required',
  ) {
    super(code, HttpStatus.UNAUTHORIZED, message);
  }
}

/**
 * 403 — utilisateur authentifié mais privilèges insuffisants.
 *
 * `details` embarque les rôles requis (ne pas exposer en prod —
 * l'`ExceptionFilter` global devra les strip avant envoi).
 */
export class ForbiddenRoleException extends BusinessException {
  constructor(requiredRoles: readonly Role[], userRoles: readonly Role[] = []) {
    super(
      ErrorCode.AUTH.FORBIDDEN_ROLE,
      HttpStatus.FORBIDDEN,
      `Access denied: one of [${requiredRoles.join(', ')}] is required`,
      { requiredRoles: [...requiredRoles], userRoles: [...userRoles] },
    );
  }
}

/**
 * 404 — entité référencée introuvable. Plus précis qu'un `NotFoundException`
 * Nest car porte le code i18n `BUSINESS.NOT_FOUND` consommable par le front.
 */
export class EntityNotFoundException extends BusinessException {
  constructor(entity: string, key: Record<string, unknown>) {
    super(
      ErrorCode.BUSINESS.NOT_FOUND,
      HttpStatus.NOT_FOUND,
      `${entity} not found`,
      { entity, key },
    );
  }
}

/**
 * 409 — conflit d'unicité sur le code métier (UNIQUE constraint violée).
 * Plus parlant qu'un `ConflictException` brut pour le front qui peut
 * afficher un message dédié "ce code est déjà utilisé".
 */
export class DuplicateCodeException extends BusinessException {
  constructor(entity: string, code: string) {
    super(
      ErrorCode.BUSINESS.DUPLICATE_CODE,
      HttpStatus.CONFLICT,
      `${entity} with code "${code}" already exists`,
      { entity, code },
    );
  }
}

/** 409 — tentative de soft-delete d'une entité déjà inactive. */
export class AlreadyInactiveException extends BusinessException {
  constructor(entity: string, id: string) {
    super(
      ErrorCode.BUSINESS.ALREADY_INACTIVE,
      HttpStatus.CONFLICT,
      `${entity} is already inactive`,
      { entity, id },
    );
  }
}

/** 409 — tentative de restore d'une entité déjà active. */
export class AlreadyActiveException extends BusinessException {
  constructor(entity: string, id: string) {
    super(
      ErrorCode.BUSINESS.ALREADY_ACTIVE,
      HttpStatus.CONFLICT,
      `${entity} is already active`,
      { entity, id },
    );
  }
}

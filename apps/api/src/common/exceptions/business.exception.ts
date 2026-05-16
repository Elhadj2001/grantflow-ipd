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

/**
 * 409 — tentative de fermer (soft-delete) un projet portant au moins
 * un grant non clos. Garantit l'intégrité référentielle métier : un
 * grant doit appartenir à un projet ouvert.
 */
export class ProjectHasActiveGrantsException extends BusinessException {
  constructor(projectId: string, activeGrantCount: number) {
    super(
      ErrorCode.BUSINESS.PROJECT_HAS_ACTIVE_GRANTS,
      HttpStatus.CONFLICT,
      `Project has ${activeGrantCount} active grant(s) — close them first`,
      { projectId, activeGrantCount },
    );
  }
}

/**
 * 409 — fermeture d'un grant déjà consommé (écritures comptables
 * existantes). La règle métier interdit de "perdre" la traçabilité
 * comptable en clôturant un grant qui a déjà servi.
 */
export class GrantHasTransactionsException extends BusinessException {
  constructor(grantId: string, journalLineCount: number) {
    super(
      ErrorCode.BUSINESS.GRANT_HAS_TRANSACTIONS,
      HttpStatus.CONFLICT,
      `Grant has ${journalLineCount} accounting transaction(s) — cannot be closed`,
      { grantId, journalLineCount },
    );
  }
}

/**
 * 409 — suppression d'une ligne budgétaire référencée par au moins
 * une DA, BC ou écriture. Protection forte : sinon les engagements
 * ouverts perdraient leur imputation analytique.
 */
export class BudgetLineHasUsageException extends BusinessException {
  constructor(budgetLineId: string, details: Record<string, number>) {
    super(
      ErrorCode.BUSINESS.BUDGET_LINE_HAS_USAGE,
      HttpStatus.CONFLICT,
      `Budget line is referenced by procurement or accounting lines`,
      { budgetLineId, ...details },
    );
  }
}

/**
 * 409 — la somme des lignes budgétaires dépasserait le montant total
 * de la convention. Empêche la sur-allocation à la source.
 */
export class BudgetLinesExceedGrantException extends BusinessException {
  constructor(grantId: string, grantAmount: number, totalAllocated: number) {
    super(
      ErrorCode.BUSINESS.BUDGET_LINES_EXCEED_GRANT,
      HttpStatus.CONFLICT,
      `Sum of budget lines (${totalAllocated}) exceeds grant amount (${grantAmount})`,
      { grantId, grantAmount, totalAllocated },
    );
  }
}

/**
 * 409 — référence à un Donor inactif lors de la création d'un grant.
 * On préfère un 409 (conflit d'état) à un 400 (validation) car le code
 * client est techniquement valide ; c'est l'état BD qui interdit.
 */
export class InactiveDonorException extends BusinessException {
  constructor(donorId: string) {
    super(
      ErrorCode.BUSINESS.INACTIVE_DONOR,
      HttpStatus.CONFLICT,
      `Donor is inactive — cannot attach a new grant`,
      { donorId },
    );
  }
}

/** 409 — référence à un Project clos/suspendu lors de la création d'un grant. */
export class InactiveProjectException extends BusinessException {
  constructor(projectId: string, status: string) {
    super(
      ErrorCode.BUSINESS.INACTIVE_PROJECT,
      HttpStatus.CONFLICT,
      `Project status is "${status}" — cannot attach a new grant`,
      { projectId, status },
    );
  }
}

/** 400 — endDate antérieure ou égale à startDate. */
export class InvalidDateRangeException extends BusinessException {
  constructor(startDate: string, endDate: string) {
    super(
      ErrorCode.BUSINESS.INVALID_DATE_RANGE,
      HttpStatus.BAD_REQUEST,
      `endDate must be strictly after startDate`,
      { startDate, endDate },
    );
  }
}

/** 400 — référence à un compte général (gl_account) inexistant. */
export class InvalidGlAccountException extends BusinessException {
  constructor(accountCode: string) {
    super(
      ErrorCode.REF.INVALID_GL_ACCOUNT,
      HttpStatus.BAD_REQUEST,
      `GL account "${accountCode}" does not exist`,
      { accountCode },
    );
  }
}

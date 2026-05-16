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

/**
 * 409 — désactivation d'un fournisseur encore engagé sur un BC ouvert.
 * Le contrat avec le fournisseur doit être soldé avant déactivation
 * (status PO ∈ {closed, cancelled}).
 */
export class SupplierHasActivePosException extends BusinessException {
  constructor(supplierId: string, openPoCount: number) {
    super(
      ErrorCode.BUSINESS.SUPPLIER_HAS_ACTIVE_POS,
      HttpStatus.CONFLICT,
      `Supplier has ${openPoCount} active purchase order(s) — close them first`,
      { supplierId, openPoCount },
    );
  }
}

/**
 * 409 — suppression d'un axe analytique référencé par DA/BC/écriture.
 * Sinon les imputations existantes perdraient leur axe (le moteur SYSCEBNL
 * exige une imputation complète sur chaque pièce comptable).
 */
export class AxisHasUsageException extends BusinessException {
  constructor(axisId: string, details: Record<string, number>) {
    super(
      ErrorCode.BUSINESS.AXIS_HAS_USAGE,
      HttpStatus.CONFLICT,
      `Analytical axis is referenced by procurement or accounting lines`,
      { axisId, ...details },
    );
  }
}

/** 409 — suppression d'un axe parent qui a encore des enfants actifs. */
export class AxisHasChildrenException extends BusinessException {
  constructor(axisId: string, childCount: number) {
    super(
      ErrorCode.BUSINESS.AXIS_HAS_CHILDREN,
      HttpStatus.CONFLICT,
      `Analytical axis has ${childCount} active child(ren) — deactivate them first`,
      { axisId, childCount },
    );
  }
}

/**
 * 409 — création/modification d'un axe qui produirait un cycle dans la
 * hiérarchie (auto-référence ou parent qui descend de l'axe lui-même).
 */
export class AxisCycleException extends BusinessException {
  constructor(axisId: string, parentId: string) {
    super(
      ErrorCode.BUSINESS.AXIS_CYCLE,
      HttpStatus.CONFLICT,
      `Setting parent would create a cycle in the analytical hierarchy`,
      { axisId, parentId },
    );
  }
}

/**
 * 409 — parent.type ≠ axis.type. La hiérarchie d'axes doit rester
 * mono-typée pour que les agrégats analytiques restent cohérents.
 */
export class AxisParentWrongTypeException extends BusinessException {
  constructor(axisType: string, parentType: string) {
    super(
      ErrorCode.BUSINESS.AXIS_PARENT_WRONG_TYPE,
      HttpStatus.CONFLICT,
      `Parent axis type "${parentType}" differs from child type "${axisType}"`,
      { axisType, parentType },
    );
  }
}

/** 400 — IBAN ne passe pas le contrôle ISO 13616 (longueur + checksum mod 97). */
export class InvalidIbanException extends BusinessException {
  constructor(iban: string) {
    super(
      ErrorCode.BUSINESS.INVALID_IBAN,
      HttpStatus.BAD_REQUEST,
      `IBAN is not valid (ISO 13616 checksum failed)`,
      { iban },
    );
  }
}

/**
 * 409 — tentative de modifier une DA dont le statut interdit l'édition
 * (≠ draft). Une fois soumise/approuvée, une DA est immutable — toute
 * correction passe par une annulation + nouvelle DA.
 */
export class PrNotEditableException extends BusinessException {
  constructor(prId: string, status: string) {
    super(
      ErrorCode.BUSINESS.PR_NOT_EDITABLE,
      HttpStatus.CONFLICT,
      `Purchase request status "${status}" forbids editing (only draft allowed)`,
      { prId, status },
    );
  }
}

/** 409 — tentative d'annulation impossible (statut ≠ draft). */
export class PrNotDeletableException extends BusinessException {
  constructor(prId: string, status: string) {
    super(
      ErrorCode.BUSINESS.PR_NOT_DELETABLE,
      HttpStatus.CONFLICT,
      `Purchase request status "${status}" forbids cancellation`,
      { prId, status },
    );
  }
}

/**
 * 404 — un DEMANDEUR tente d'accéder à une DA qui n'est pas la sienne.
 * On répond 404 plutôt que 403 pour ne pas révéler l'existence de la DA
 * (sécurité par obscurité — cf. recommandation OWASP).
 */
export class PrNotOwnedException extends BusinessException {
  constructor(prId: string) {
    super(
      ErrorCode.BUSINESS.PR_NOT_OWNED,
      HttpStatus.NOT_FOUND,
      `Purchase request not found`,
      { prId },
    );
  }
}

/** 409 — rattachement d'une DA à un grant non actif (draft / suspended / closed). */
export class GrantNotActiveException extends BusinessException {
  constructor(grantId: string, status: string) {
    super(
      ErrorCode.BUSINESS.GRANT_NOT_ACTIVE,
      HttpStatus.CONFLICT,
      `Grant status "${status}" forbids new purchase requests`,
      { grantId, status },
    );
  }
}

/**
 * 409 — budget insuffisant pour au moins une ligne au moment du submit.
 * `details.lines` contient le détail par ligne en dépassement, prêt à
 * être affiché au front.
 */
export class InsufficientBudgetException extends BusinessException {
  constructor(prId: string, lines: Array<Record<string, unknown>>) {
    super(
      ErrorCode.BUSINESS.INSUFFICIENT_BUDGET,
      HttpStatus.CONFLICT,
      `Insufficient budget on ${lines.length} budget line(s)`,
      { prId, lines },
    );
  }
}

/**
 * 400 — la budgetLineId fournie n'appartient pas au grantId. Évite des
 * écritures analytiques transverses à plusieurs conventions.
 */
export class BudgetLineNotInGrantException extends BusinessException {
  constructor(budgetLineId: string, grantId: string) {
    super(
      ErrorCode.BUSINESS.BUDGET_LINE_NOT_IN_GRANT,
      HttpStatus.BAD_REQUEST,
      `Budget line does not belong to the specified grant`,
      { budgetLineId, grantId },
    );
  }
}

/** 400 — grant.projectId ≠ projectId du payload (cohérence DA). */
export class ProjectGrantMismatchException extends BusinessException {
  constructor(grantId: string, expectedProjectId: string, actualProjectId: string) {
    super(
      ErrorCode.BUSINESS.PROJECT_GRANT_MISMATCH,
      HttpStatus.BAD_REQUEST,
      `Grant is attached to a different project`,
      { grantId, expectedProjectId, actualProjectId },
    );
  }
}

/**
 * 403 — l'acteur a un rôle reconnu, mais l'étape pending exige un autre rôle.
 * Exemple : DAF qui tente d'approuver une DA en `pending_pi`.
 */
export class PrNotAwaitingYouException extends BusinessException {
  constructor(prId: string, expectedRole: string, actorRoles: readonly string[]) {
    super(
      ErrorCode.BUSINESS.PR_NOT_AWAITING_YOU,
      HttpStatus.FORBIDDEN,
      `Purchase request requires "${expectedRole}" approval`,
      { prId, expectedRole, actorRoles: [...actorRoles] },
    );
  }
}

/**
 * 409 — l'étape d'approbation est déjà décidée (approved/rejected/returned).
 * Cas typique : double-click ou race sur le bouton "Approuver".
 */
export class PrAlreadyDecidedException extends BusinessException {
  constructor(prId: string, status: string) {
    super(
      ErrorCode.BUSINESS.PR_ALREADY_DECIDED,
      HttpStatus.CONFLICT,
      `Purchase request decision already recorded (status="${status}")`,
      { prId, status },
    );
  }
}

/** 400 — un rejet doit être motivé (reason ≥ 5 caractères). */
export class RejectionReasonRequiredException extends BusinessException {
  constructor() {
    super(
      ErrorCode.BUSINESS.REJECTION_REASON_REQUIRED,
      HttpStatus.BAD_REQUEST,
      `A non-empty rejection reason is required (min 5 chars)`,
    );
  }
}

/** 409 — opération de workflow sur une DA qui n'est pas dans un statut d'approbation. */
export class PrNotInApprovalException extends BusinessException {
  constructor(prId: string, status: string) {
    super(
      ErrorCode.BUSINESS.PR_NOT_IN_APPROVAL,
      HttpStatus.CONFLICT,
      `Purchase request status "${status}" is not in an approval state`,
      { prId, status },
    );
  }
}

/**
 * 403 — un PI tente d'approuver une DA dont le projet ne le déclare pas
 * `piUserId`. Les PI ne valident que leurs propres projets.
 */
export class PiNotOwnerOfProjectException extends BusinessException {
  constructor(piId: string, projectId: string) {
    super(
      ErrorCode.BUSINESS.PI_NOT_OWNER_OF_PROJECT,
      HttpStatus.FORBIDDEN,
      `PI is not the owner of the project this PR belongs to`,
      { piId, projectId },
    );
  }
}

/**
 * 501 — workflow d'approbation cash (petty_cash, cash_advance) pas encore
 * implémenté. Posé en sprint 2.2 pour le sprint 2.3 — toute tentative
 * d'approuver une DA non-standard renvoie 501 explicite plutôt qu'un comportement
 * dégradé silencieux.
 */
export class CashWorkflowNotYetImplementedException extends BusinessException {
  constructor(prId: string, requestType: string) {
    super(
      ErrorCode.BUSINESS.CASH_WORKFLOW_NOT_YET_IMPLEMENTED,
      HttpStatus.NOT_IMPLEMENTED,
      `Approval workflow for request_type "${requestType}" will be available in Sprint 2.3`,
      { prId, requestType },
    );
  }
}

/** 400 — BIC ne respecte pas la regex ISO 9362 (8 ou 11 caractères). */
export class InvalidBicException extends BusinessException {
  constructor(bic: string) {
    super(
      ErrorCode.BUSINESS.INVALID_BIC,
      HttpStatus.BAD_REQUEST,
      `BIC must match ISO 9362 (8 or 11 uppercase alphanum)`,
      { bic },
    );
  }
}

/**
 * 409 — désactivation d'un code TVA encore référencé par une DA/BC/facture/écriture.
 * On force le contrôle de gestion à remplacer le code dans les pièces ouvertes
 * avant de l'archiver, sinon les recalculs de TVA seraient cassés.
 */
export class TaxCodeHasUsageException extends BusinessException {
  constructor(taxCodeId: string, details: Record<string, number>) {
    super(
      ErrorCode.BUSINESS.TAX_CODE_HAS_USAGE,
      HttpStatus.CONFLICT,
      `Tax code is referenced by procurement/invoice/journal lines`,
      { taxCodeId, ...details },
    );
  }
}

/**
 * 409 — désactivation d'un compte général qui porte au moins une écriture
 * validée. Garantie SYSCEBNL : un compte mouvementé reste actif jusqu'à
 * archivage de l'exercice (cf. CLAUDE.md §1 référentiel comptable).
 */
export class GlAccountHasEntriesException extends BusinessException {
  constructor(accountCode: string, journalLineCount: number) {
    super(
      ErrorCode.BUSINESS.GL_ACCOUNT_HAS_ENTRIES,
      HttpStatus.CONFLICT,
      `GL account has ${journalLineCount} journal line(s) — cannot deactivate`,
      { accountCode, journalLineCount },
    );
  }
}

/** 409 — désactivation d'un compte parent avec des sous-comptes actifs. */
export class GlAccountHasChildrenException extends BusinessException {
  constructor(accountCode: string, childCount: number) {
    super(
      ErrorCode.BUSINESS.GL_ACCOUNT_HAS_CHILDREN,
      HttpStatus.CONFLICT,
      `GL account has ${childCount} active child account(s) — deactivate them first`,
      { accountCode, childCount },
    );
  }
}

/**
 * 400 — Le premier chiffre du code de compte doit correspondre à la classe.
 * SYSCEBNL/OHADA : classe 1 = capitaux, 2 = immobilisations, 6 = charges, etc.
 * Code 6011 → class doit être '6'. Sinon la balance générale serait fausse.
 */
export class InvalidClassPrefixException extends BusinessException {
  constructor(code: string, declaredClass: string) {
    super(
      ErrorCode.BUSINESS.INVALID_CLASS_PREFIX,
      HttpStatus.BAD_REQUEST,
      `Code "${code}" must start with declared class "${declaredClass}"`,
      { code, declaredClass },
    );
  }
}

/** 404 — aucun taux de change disponible pour le couple (from,to) à la date demandée. */
export class ExchangeRateNotFoundException extends BusinessException {
  constructor(from: string, to: string, date?: string) {
    super(
      ErrorCode.BUSINESS.EXCHANGE_RATE_NOT_FOUND,
      HttpStatus.NOT_FOUND,
      `No exchange rate found for ${from}→${to}${date ? ` on or before ${date}` : ''}`,
      { from, to, date: date ?? null },
    );
  }
}

/** 400 — fromCurrency === toCurrency : pas de conversion possible. */
export class SameCurrencyException extends BusinessException {
  constructor(currency: string) {
    super(
      ErrorCode.BUSINESS.SAME_CURRENCY,
      HttpStatus.BAD_REQUEST,
      `from and to currencies must differ (received "${currency}")`,
      { currency },
    );
  }
}

/**
 * 409 — tentative d'insérer un taux variable pour un couple devise qui a
 * déjà une parité fixe BCEAO (ex: EUR/XOF). La parité fixe est sacro-sainte —
 * on refuse explicitement plutôt que de risquer un override silencieux.
 */
export class FixedRateExistsException extends BusinessException {
  constructor(from: string, to: string) {
    super(
      ErrorCode.BUSINESS.FIXED_RATE_EXISTS,
      HttpStatus.CONFLICT,
      `A fixed exchange rate already exists for ${from}→${to} — cannot add a variable rate`,
      { from, to },
    );
  }
}

/**
 * 409 — tentative de modifier/supprimer une ligne `isFixed=true` par un
 * utilisateur non SUPER_ADMIN. Cas exceptionnel : SUPER_ADMIN peut corriger
 * une erreur de saisie sur la parité (rarissime).
 */
export class ImmutableFixedRateException extends BusinessException {
  constructor(rateId: string, action: 'update' | 'delete') {
    super(
      ErrorCode.BUSINESS.IMMUTABLE_FIXED_RATE,
      HttpStatus.CONFLICT,
      `Cannot ${action} a fixed BCEAO exchange rate (requires SUPER_ADMIN override)`,
      { rateId, action },
    );
  }
}

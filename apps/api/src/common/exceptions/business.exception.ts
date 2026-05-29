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
 * implémenté. Conservée pour rétro-compatibilité, plus émise depuis sprint 2.3
 * (le workflow est désormais opérationnel).
 *
 * @deprecated since sprint 2.3
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

/**
 * 409 — DA cash_* sur un grant dont la convention interdit le paiement
 * en espèces (`grant.allows_cash_payment = false`). Cas typique : un
 * bailleur public qui exige une trace bancaire pour chaque dépense.
 */
export class CashPaymentNotAllowedException extends BusinessException {
  constructor(grantId: string) {
    super(
      ErrorCode.BUSINESS.CASH_PAYMENT_NOT_ALLOWED,
      HttpStatus.CONFLICT,
      `Grant convention forbids cash payments`,
      { grantId },
    );
  }
}

/** 400 — DA petty_cash/cash_advance créée sans `cashBoxId`. */
export class CashBoxRequiredException extends BusinessException {
  constructor(requestType: string) {
    super(
      ErrorCode.BUSINESS.CASH_BOX_REQUIRED,
      HttpStatus.BAD_REQUEST,
      `cashBoxId is required for request_type "${requestType}"`,
      { requestType },
    );
  }
}

/** 409 — DA rattachée à une caisse désactivée. */
export class CashBoxInactiveException extends BusinessException {
  constructor(cashBoxId: string) {
    super(
      ErrorCode.BUSINESS.CASH_BOX_INACTIVE,
      HttpStatus.CONFLICT,
      `Cash box is inactive`,
      { cashBoxId },
    );
  }
}

/** 409 — total DA > plafond par requête de la caisse. */
export class CashLimitPerRequestExceededException extends BusinessException {
  constructor(cashBoxId: string, requested: number, max: number) {
    super(
      ErrorCode.BUSINESS.CASH_LIMIT_PER_REQUEST_EXCEEDED,
      HttpStatus.CONFLICT,
      `Requested amount (${requested}) exceeds per-request limit (${max})`,
      { cashBoxId, requested, max },
    );
  }
}

/** 409 — somme des DA petty_cash du jour pour ce demandeur > plafond. */
export class CashLimitPerDayExceededException extends BusinessException {
  constructor(cashBoxId: string, todaySpent: number, requested: number, max: number) {
    super(
      ErrorCode.BUSINESS.CASH_LIMIT_PER_DAY_EXCEEDED,
      HttpStatus.CONFLICT,
      `Daily limit per user exceeded (${todaySpent} + ${requested} > ${max})`,
      { cashBoxId, todaySpent, requested, max },
    );
  }
}

/** 409 — l'approbation finale décrémenterait la caisse en dessous de zéro. */
export class CashBoxInsufficientFundsException extends BusinessException {
  constructor(cashBoxId: string, balance: number, requested: number) {
    super(
      ErrorCode.BUSINESS.CASH_BOX_INSUFFICIENT_FUNDS,
      HttpStatus.CONFLICT,
      `Cash box balance (${balance}) is insufficient for requested amount (${requested})`,
      { cashBoxId, balance, requested },
    );
  }
}

/** 409 — settle déjà enregistré pour cette DA. */
export class PrAlreadySettledException extends BusinessException {
  constructor(prId: string) {
    super(
      ErrorCode.BUSINESS.PR_ALREADY_SETTLED,
      HttpStatus.CONFLICT,
      `Purchase request has already been settled`,
      { prId },
    );
  }
}

/**
 * 409 — opération réservée à un `request_type` particulier. Cas typique :
 * tentative de settle sur une DA standard ou petty_cash.
 */
export class PrTypeMismatchException extends BusinessException {
  constructor(prId: string, expected: string, actual: string) {
    super(
      ErrorCode.BUSINESS.PR_TYPE_MISMATCH,
      HttpStatus.CONFLICT,
      `Operation requires request_type "${expected}" (current "${actual}")`,
      { prId, expected, actual },
    );
  }
}

/** 409 — settle ne peut s'appliquer qu'à une DA cash_advance approved. */
export class PrNotApprovedForSettleException extends BusinessException {
  constructor(prId: string, status: string) {
    super(
      ErrorCode.BUSINESS.PR_NOT_APPROVED_FOR_SETTLE,
      HttpStatus.CONFLICT,
      `Purchase request must be "approved" before settle (current "${status}")`,
      { prId, status },
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

// ===== Sprint 3 — Bons de Commande =====

/** 409 — édition du PO interdite (≠ draft). */
export class PoNotEditableException extends BusinessException {
  constructor(poId: string, status: string) {
    super(
      ErrorCode.BUSINESS.PO_NOT_EDITABLE,
      HttpStatus.CONFLICT,
      `Purchase order status "${status}" forbids editing (only draft allowed)`,
      { poId, status },
    );
  }
}

/** 409 — envoi du PO interdit (≠ draft). */
export class PoNotSendableException extends BusinessException {
  constructor(poId: string, status: string) {
    super(
      ErrorCode.BUSINESS.PO_NOT_SENDABLE,
      HttpStatus.CONFLICT,
      `Purchase order status "${status}" forbids sending (only draft allowed)`,
      { poId, status },
    );
  }
}

/** 409 — annulation du PO impossible (déjà reçu/facturé/clos). */
export class PoNotCancellableException extends BusinessException {
  constructor(poId: string, status: string) {
    super(
      ErrorCode.BUSINESS.PO_NOT_CANCELLABLE,
      HttpStatus.CONFLICT,
      `Purchase order status "${status}" forbids cancellation`,
      { poId, status },
    );
  }
}

/** 409 — acknowledge sur un PO qui n'est pas en statut `sent`. */
export class PoNotAcknowledgeableException extends BusinessException {
  constructor(poId: string, status: string) {
    super(
      ErrorCode.BUSINESS.PO_NOT_ACKNOWLEDGEABLE,
      HttpStatus.CONFLICT,
      `Purchase order status "${status}" cannot be acknowledged (must be "sent")`,
      { poId, status },
    );
  }
}

/** 404 — tentative de télécharger le PDF d'un PO non encore généré. */
export class PoNoPdfException extends BusinessException {
  constructor(poId: string) {
    super(
      ErrorCode.BUSINESS.PO_NO_PDF,
      HttpStatus.NOT_FOUND,
      `Purchase order has no PDF (not yet sent)`,
      { poId },
    );
  }
}

/**
 * Sprint F-INVOICE-SIM — 404 quand le simulateur de facture (mode démo)
 * est désactivé (ENABLE_DEMO_INVOICE_SIMULATOR ≠ 'true'). On renvoie 404
 * (et pas 403) pour que l'endpoint n'existe PAS du point de vue d'un
 * client en production.
 */
export class DemoFeatureDisabledException extends BusinessException {
  constructor(feature: string) {
    super(
      ErrorCode.BUSINESS.DEMO_FEATURE_DISABLED,
      HttpStatus.NOT_FOUND,
      `Demo feature "${feature}" is disabled (set ENABLE_DEMO_INVOICE_SIMULATOR=true in a demo env)`,
      { feature },
    );
  }
}

/** Sprint F-INVOICE-SIM — 409 : on ne simule une facture que depuis un BC `sent`. */
export class PoNotSentForSimulationException extends BusinessException {
  constructor(poId: string, status: string) {
    super(
      ErrorCode.BUSINESS.PO_NOT_SENT_FOR_SIMULATION,
      HttpStatus.CONFLICT,
      `Purchase order status "${status}" forbids invoice simulation (only sent allowed)`,
      { poId, status },
    );
  }
}

/** 409 — création de PO sur DA non approuvée. */
export class PrNotApprovedException extends BusinessException {
  constructor(prId: string, status: string) {
    super(
      ErrorCode.BUSINESS.PR_NOT_APPROVED,
      HttpStatus.CONFLICT,
      `Purchase request status "${status}" forbids PO creation (must be "approved")`,
      { prId, status },
    );
  }
}

/** 409 — DA déjà rattachée à un PO actif. */
export class PrAlreadyHasPoException extends BusinessException {
  constructor(prId: string, poId: string) {
    super(
      ErrorCode.BUSINESS.PR_ALREADY_HAS_PO,
      HttpStatus.CONFLICT,
      `Purchase request already linked to an active purchase order`,
      { prId, poId },
    );
  }
}

/** 409 — un PO ne peut pas être créé à partir d'une DA petty_cash (paiement caisse). */
export class PrTypePettyCashNoPoException extends BusinessException {
  constructor(prId: string) {
    super(
      ErrorCode.BUSINESS.PR_TYPE_PETTY_CASH_NO_PO,
      HttpStatus.CONFLICT,
      `Petty cash purchase requests are paid in cash, no PO is issued`,
      { prId },
    );
  }
}

/** 409 — fournisseur inactif. */
export class SupplierInactiveException extends BusinessException {
  constructor(supplierId: string) {
    super(
      ErrorCode.BUSINESS.SUPPLIER_INACTIVE,
      HttpStatus.CONFLICT,
      `Supplier is inactive`,
      { supplierId },
    );
  }
}

/** 400 — liste de DAs vide pour la consolidation. */
export class PrListEmptyException extends BusinessException {
  constructor() {
    super(
      ErrorCode.BUSINESS.PR_LIST_EMPTY,
      HttpStatus.BAD_REQUEST,
      `At least one purchase request is required`,
    );
  }
}

/** 409 — devises hétérogènes entre les DAs consolidées. */
export class PoCurrencyMismatchException extends BusinessException {
  constructor(currencies: string[]) {
    super(
      ErrorCode.BUSINESS.PO_CURRENCY_MISMATCH,
      HttpStatus.CONFLICT,
      `Purchase requests have heterogeneous currencies — consolidation requires the same currency`,
      { currencies },
    );
  }
}

/**
 * 409 — aucune période fiscale ouverte ne couvre la date d'écriture
 * (typiquement la date du jour). Empêche de poster un engagement.
 */
export class NoOpenFiscalPeriodException extends BusinessException {
  constructor(date: string) {
    super(
      ErrorCode.BUSINESS.NO_OPEN_FISCAL_PERIOD,
      HttpStatus.CONFLICT,
      `No open fiscal period covers ${date}`,
      { date },
    );
  }
}

// ===== Sprint 4.1 — Réception de biens (Goods Receipt) =====

/**
 * 409 — réception impossible sur un PO qui n'est pas dans un statut
 * "receivable" (sent / acknowledged / partially_received).
 */
export class PoNotReceivableException extends BusinessException {
  constructor(poId: string, status: string) {
    super(
      ErrorCode.BUSINESS.PO_NOT_RECEIVABLE,
      HttpStatus.CONFLICT,
      `Purchase order status "${status}" forbids creating a goods receipt`,
      { poId, status },
    );
  }
}

/** 409 — édition d'un GR interdite (≠ draft). */
export class GrNotEditableException extends BusinessException {
  constructor(grId: string, status: string) {
    super(
      ErrorCode.BUSINESS.GR_NOT_EDITABLE,
      HttpStatus.CONFLICT,
      `Goods receipt status "${status}" forbids editing (only draft allowed)`,
      { grId, status },
    );
  }
}

/** 409 — complete refusé : aucune ligne avec quantity > 0. */
export class GrEmptyLinesException extends BusinessException {
  constructor(grId: string) {
    super(
      ErrorCode.BUSINESS.GR_EMPTY_LINES,
      HttpStatus.CONFLICT,
      `Goods receipt has no line with quantity > 0 — nothing to complete`,
      { grId },
    );
  }
}

/**
 * 409 — quantity reçue cumulée > quantity commandée pour au moins une ligne.
 * `details.lines` détaille pour chaque ligne en débordement les valeurs vues.
 */
export class GrQtyExceedsOrderException extends BusinessException {
  constructor(grId: string, lines: Array<Record<string, unknown>>) {
    super(
      ErrorCode.BUSINESS.GR_QTY_EXCEEDS_ORDER,
      HttpStatus.CONFLICT,
      `Received quantity exceeds ordered quantity on ${lines.length} line(s)`,
      { grId, lines },
    );
  }
}

/**
 * 409 — chaîne du froid rompue (cold_chain_required = true mais
 * cold_chain_ok ≠ true sur au moins une ligne reçue). Alerte forte :
 * réactifs biomédicaux potentiellement compromis.
 */
export class ColdChainBrokenException extends BusinessException {
  constructor(grId: string, brokenLines: Array<Record<string, unknown>>) {
    super(
      ErrorCode.BUSINESS.COLD_CHAIN_BROKEN,
      HttpStatus.CONFLICT,
      `Cold chain broken on ${brokenLines.length} line(s) — biomedical alert`,
      { grId, brokenLines },
    );
  }
}

/**
 * 409 — lot / péremption manquant alors que cold_chain_required = true.
 * Conformité réglementaire (traçabilité produit biomédical).
 */
export class BatchInfoRequiredException extends BusinessException {
  constructor(grId: string, missing: Array<Record<string, unknown>>) {
    super(
      ErrorCode.BUSINESS.BATCH_INFO_REQUIRED,
      HttpStatus.CONFLICT,
      `Batch number and expiry date are required for cold-chain lines`,
      { grId, missing },
    );
  }
}

/** 409 — second complete sur un GR déjà 'complete'. */
export class GrAlreadyCompleteException extends BusinessException {
  constructor(grId: string) {
    super(
      ErrorCode.BUSINESS.GR_ALREADY_COMPLETE,
      HttpStatus.CONFLICT,
      `Goods receipt is already complete`,
      { grId },
    );
  }
}

/** 409 — annulation d'un GR ≠ draft. */
export class GrNotCancellableException extends BusinessException {
  constructor(grId: string, status: string) {
    super(
      ErrorCode.BUSINESS.GR_NOT_CANCELLABLE,
      HttpStatus.CONFLICT,
      `Goods receipt status "${status}" forbids cancellation (only draft)`,
      { grId, status },
    );
  }
}

/** 409 — reject sur un GR ≠ draft. */
export class GrNotRejectableException extends BusinessException {
  constructor(grId: string, status: string) {
    super(
      ErrorCode.BUSINESS.GR_NOT_REJECTABLE,
      HttpStatus.CONFLICT,
      `Goods receipt status "${status}" forbids rejection (only draft)`,
      { grId, status },
    );
  }
}

/** 404 — ligne de GR introuvable lors d'un patch. */
export class GrLineNotFoundException extends BusinessException {
  constructor(grId: string, lineId: string) {
    super(
      ErrorCode.BUSINESS.GR_LINE_NOT_FOUND,
      HttpStatus.NOT_FOUND,
      `Goods receipt line not found`,
      { grId, lineId },
    );
  }
}

/** 400 — rejet sans motif. */
export class RejectionReasonMissingException extends BusinessException {
  constructor() {
    super(
      ErrorCode.BUSINESS.REJECTION_REASON_MISSING,
      HttpStatus.BAD_REQUEST,
      `A non-empty rejection reason is required`,
    );
  }
}

// ===== Sprint 4.2a — Factures + OCR + Matching 3-way =====

/**
 * 409 — submit du matching impossible : la facture n'est pas en statut
 * 'captured' (déjà matchée, rejetée, payée, etc.).
 */
export class InvoiceNotCapturableException extends BusinessException {
  constructor(invoiceId: string, status: string) {
    super(
      ErrorCode.BUSINESS.INVOICE_NOT_CAPTURABLE,
      HttpStatus.CONFLICT,
      `Invoice status "${status}" cannot be submitted to matching (only captured allowed)`,
      { invoiceId, status },
    );
  }
}

/**
 * 409 — édition impossible : la facture est figée (matched, posted,
 * paid, archived). Pour corriger, il faut passer par reject + nouvelle
 * facture, ou demander à un DAF d'utiliser force-match.
 */
export class InvoiceNotEditableException extends BusinessException {
  constructor(invoiceId: string, status: string) {
    super(
      ErrorCode.BUSINESS.INVOICE_NOT_EDITABLE,
      HttpStatus.CONFLICT,
      `Invoice status "${status}" forbids editing`,
      { invoiceId, status },
    );
  }
}

/** 409 — submit sans po_id renseigné (matching impossible sans BC). */
export class InvoiceNoPoLinkedException extends BusinessException {
  constructor(invoiceId: string) {
    super(
      ErrorCode.BUSINESS.INVOICE_NO_PO_LINKED,
      HttpStatus.CONFLICT,
      `Invoice is not linked to a purchase order — link a PO before submitting to matching`,
      { invoiceId },
    );
  }
}

/**
 * 409 — couple (supplier_id, invoice_number) déjà présent. Garantie
 * d'unicité métier : un fournisseur ne peut pas émettre deux factures
 * avec le même numéro.
 */
export class InvoiceDuplicateNumberException extends BusinessException {
  constructor(supplierId: string, invoiceNumber: string) {
    super(
      ErrorCode.BUSINESS.INVOICE_DUPLICATE_NUMBER,
      HttpStatus.CONFLICT,
      `Invoice number "${invoiceNumber}" already exists for this supplier`,
      { supplierId, invoiceNumber },
    );
  }
}

/**
 * 500 — l'extraction OCR (pdf-parse) a échoué : PDF corrompu, fichier
 * non-PDF, ou erreur interne. Détails techniques masqués en prod.
 */
export class OcrExtractionFailedException extends BusinessException {
  constructor(reason: string) {
    super(
      ErrorCode.BUSINESS.OCR_EXTRACTION_FAILED,
      HttpStatus.INTERNAL_SERVER_ERROR,
      `OCR extraction failed`,
      { reason },
    );
  }
}

/**
 * 409 — submit du matching alors qu'aucun GR n'est en statut 'complete'
 * pour le PO référencé. Sans réception validée, le 3-way est impossible.
 */
export class MatchingNoReceiptException extends BusinessException {
  constructor(invoiceId: string, poId: string) {
    super(
      ErrorCode.BUSINESS.MATCHING_NO_RECEIPT,
      HttpStatus.CONFLICT,
      `No complete goods receipt found for the linked purchase order`,
      { invoiceId, poId },
    );
  }
}

/**
 * 400 — force-match sans motif. Le DAF/SUPER_ADMIN doit toujours
 * justifier un override d'exception (traçabilité audit).
 */
export class MatchingForceReasonRequiredException extends BusinessException {
  constructor() {
    super(
      ErrorCode.BUSINESS.MATCHING_FORCE_REASON_REQUIRED,
      HttpStatus.BAD_REQUEST,
      `A non-empty reason is required to force-match an invoice with exceptions`,
    );
  }
}

/** 409 — reject sur facture déjà payée ou archivée. */
export class InvoiceNotRejectableException extends BusinessException {
  constructor(invoiceId: string, status: string) {
    super(
      ErrorCode.BUSINESS.INVOICE_NOT_REJECTABLE,
      HttpStatus.CONFLICT,
      `Invoice status "${status}" forbids rejection (paid or archived invoices are immutable)`,
      { invoiceId, status },
    );
  }
}

// ===== Sprint 4.2b — Comptabilisation facture + extournement classe 8 =====

/**
 * 409 — post impossible : la facture n'est pas en statut `matched`.
 * Seuls `matched` (matching naturel ou force-match DAF) sont éligibles
 * à la comptabilisation.
 */
export class InvoiceNotPostableException extends BusinessException {
  constructor(invoiceId: string, status: string) {
    super(
      ErrorCode.BUSINESS.INVOICE_NOT_POSTABLE,
      HttpStatus.CONFLICT,
      `Invoice status "${status}" forbids posting (must be matched)`,
      { invoiceId, status },
    );
  }
}

/** 409 — double-post sur la même facture. */
export class InvoiceAlreadyPostedException extends BusinessException {
  constructor(invoiceId: string) {
    super(
      ErrorCode.BUSINESS.INVOICE_ALREADY_POSTED,
      HttpStatus.CONFLICT,
      `Invoice has already been posted`,
      { invoiceId },
    );
  }
}

/**
 * 409 — tentative de comptabilisation dans une période fiscale close.
 * Plus précis que NO_OPEN_FISCAL_PERIOD : la période EXISTE mais a été
 * fermée par le DAF (compta mensuelle/trimestrielle/annuelle clôturée).
 */
export class PeriodClosedException extends BusinessException {
  constructor(date: string, periodCode?: string) {
    super(
      ErrorCode.BUSINESS.PERIOD_CLOSED,
      HttpStatus.CONFLICT,
      `Fiscal period covering ${date} is closed${periodCode ? ` (${periodCode})` : ''}`,
      { date, periodCode: periodCode ?? null },
    );
  }
}

/**
 * 409 — facture multidevises sans taux de change disponible à
 * `invoice_date`. Le contrôleur de gestion doit charger un taux BCEAO
 * ou un fixed rate via /exchange-rates avant de relancer.
 */
export class ExchangeRateMissingException extends BusinessException {
  constructor(from: string, to: string, date: string) {
    super(
      ErrorCode.BUSINESS.EXCHANGE_RATE_MISSING,
      HttpStatus.CONFLICT,
      `No exchange rate found for ${from}→${to} on or before ${date}`,
      { from, to, date },
    );
  }
}

/**
 * 409 — au moins une ligne de facture ne résout pas de compte de
 * charge (6xx). Le service tente, dans l'ordre : invoice_line.gl_account,
 * budget_line.default_account, fallback "605". Si même ce fallback n'est
 * pas présent dans ref.gl_account, on lève cette erreur.
 *
 * `details.lines` détaille les lignes en défaut.
 */
export class GlAccountNotFoundException extends BusinessException {
  constructor(missing: Array<Record<string, unknown>>) {
    super(
      ErrorCode.BUSINESS.GL_ACCOUNT_NOT_FOUND,
      HttpStatus.CONFLICT,
      `Could not resolve a valid GL account for ${missing.length} invoice line(s)`,
      { lines: missing },
    );
  }
}

/**
 * 409 — annulation de la comptabilisation impossible : la facture porte
 * déjà un paiement (status ∈ partially_paid / paid / archived). Pour
 * extourner après paiement il faut d'abord annuler le paiement (sprint 5).
 */
export class PostingHasPaymentException extends BusinessException {
  constructor(invoiceId: string, status: string) {
    super(
      ErrorCode.BUSINESS.POSTING_HAS_PAYMENT,
      HttpStatus.CONFLICT,
      `Invoice has a payment — cancel the payment first before reverting the posting`,
      { invoiceId, status },
    );
  }
}

/** 400 — cancel-posting sans motif. */
export class PostingCancelReasonRequiredException extends BusinessException {
  constructor() {
    super(
      ErrorCode.BUSINESS.POSTING_CANCEL_REASON_REQUIRED,
      HttpStatus.BAD_REQUEST,
      `A non-empty reason is required to cancel an invoice posting`,
    );
  }
}

// ===== Sprint 5.1 — PaymentRun + paiements classe 5 =====

/** 409 — la facture n'est pas dans un statut payable (`posted` ou `partially_paid`). */
export class InvoiceNotPayableException extends BusinessException {
  constructor(invoiceId: string, status: string) {
    super(
      ErrorCode.BUSINESS.INVOICE_NOT_PAYABLE,
      HttpStatus.CONFLICT,
      `Invoice status "${status}" forbids payment (must be posted or partially_paid)`,
      { invoiceId, status },
    );
  }
}

/** 409 — la facture est déjà rattachée à un PaymentRun actif (draft/prepared/executed). */
export class InvoiceAlreadyInRunException extends BusinessException {
  constructor(invoiceId: string, runId: string, runNumber: string) {
    super(
      ErrorCode.BUSINESS.INVOICE_ALREADY_IN_RUN,
      HttpStatus.CONFLICT,
      `Invoice is already linked to active PaymentRun ${runNumber}`,
      { invoiceId, runId, runNumber },
    );
  }
}

/**
 * 409 — la devise de la facture ne correspond pas à celle du compte bancaire
 * du run. Le multidevises est repoussé au sprint 5.2.
 */
export class PaymentCurrencyMismatchException extends BusinessException {
  constructor(invoiceId: string, invoiceCurrency: string, runCurrency: string) {
    super(
      ErrorCode.BUSINESS.PAYMENT_CURRENCY_MISMATCH,
      HttpStatus.CONFLICT,
      `Invoice currency ${invoiceCurrency} does not match run currency ${runCurrency}`,
      { invoiceId, invoiceCurrency, runCurrency },
    );
  }
}

/** 409 — opération impossible : le PaymentRun n'est pas en `draft`. */
export class PaymentRunNotEditableException extends BusinessException {
  constructor(runId: string, status: string) {
    super(
      ErrorCode.BUSINESS.PAYMENT_RUN_NOT_EDITABLE,
      HttpStatus.CONFLICT,
      `PaymentRun status "${status}" forbids editing (must be draft)`,
      { runId, status },
    );
  }
}

/** 409 — `prepare` impossible : run pas en `draft`. */
export class PaymentRunNotPreparableException extends BusinessException {
  constructor(runId: string, status: string) {
    super(
      ErrorCode.BUSINESS.PAYMENT_RUN_NOT_PREPARABLE,
      HttpStatus.CONFLICT,
      `PaymentRun status "${status}" forbids prepare (must be draft)`,
      { runId, status },
    );
  }
}

/** 409 — `approve` impossible : run pas en `prepared`. */
export class PaymentRunNotApprovableException extends BusinessException {
  constructor(runId: string, status: string) {
    super(
      ErrorCode.BUSINESS.PAYMENT_RUN_NOT_APPROVABLE,
      HttpStatus.CONFLICT,
      `PaymentRun status "${status}" forbids approve (must be prepared)`,
      { runId, status },
    );
  }
}

/** 409 — `reject` impossible : run pas en `prepared`. */
export class PaymentRunNotRejectableException extends BusinessException {
  constructor(runId: string, status: string) {
    super(
      ErrorCode.BUSINESS.PAYMENT_RUN_NOT_REJECTABLE,
      HttpStatus.CONFLICT,
      `PaymentRun status "${status}" forbids reject (must be prepared)`,
      { runId, status },
    );
  }
}

/** 409 — `cancel` impossible : run pas en `draft`. */
export class PaymentRunNotCancellableException extends BusinessException {
  constructor(runId: string, status: string) {
    super(
      ErrorCode.BUSINESS.PAYMENT_RUN_NOT_CANCELLABLE,
      HttpStatus.CONFLICT,
      `PaymentRun status "${status}" forbids cancel (must be draft)`,
      { runId, status },
    );
  }
}

/** 409 — `prepare` impossible : aucun paiement actif dans le run. */
export class PaymentRunEmptyException extends BusinessException {
  constructor(runId: string) {
    super(
      ErrorCode.BUSINESS.PAYMENT_RUN_EMPTY,
      HttpStatus.CONFLICT,
      `PaymentRun has no payments — add invoices before preparing`,
      { runId },
    );
  }
}

/** 400 — `reject` sans motif. */
export class PaymentRunRejectReasonRequiredException extends BusinessException {
  constructor() {
    super(
      ErrorCode.BUSINESS.PAYMENT_RUN_REJECT_REASON_REQUIRED,
      HttpStatus.BAD_REQUEST,
      `A non-empty reason is required to reject a PaymentRun`,
    );
  }
}

/** 400 — `cancel` sans motif. */
export class PaymentRunCancelReasonRequiredException extends BusinessException {
  constructor() {
    super(
      ErrorCode.BUSINESS.PAYMENT_RUN_CANCEL_REASON_REQUIRED,
      HttpStatus.BAD_REQUEST,
      `A non-empty reason is required to cancel a PaymentRun`,
    );
  }
}

/**
 * 409 — au moins un fournisseur n'a pas d'IBAN renseigné. Le run reste en
 * `draft`, l'utilisateur doit corriger la fiche fournisseur ou retirer la
 * facture du run.
 */
export class MissingIbanException extends BusinessException {
  constructor(missing: Array<Record<string, unknown>>) {
    super(
      ErrorCode.BUSINESS.MISSING_IBAN,
      HttpStatus.CONFLICT,
      `${missing.length} supplier(s) have no IBAN — cannot prepare the run`,
      { suppliers: missing },
    );
  }
}

/** 404 — bank account inconnu. */
export class BankAccountNotFoundException extends BusinessException {
  constructor(bankAccountId: string) {
    super(
      ErrorCode.BUSINESS.BANK_ACCOUNT_NOT_FOUND,
      HttpStatus.NOT_FOUND,
      `BankAccount not found`,
      { bankAccountId },
    );
  }
}

/**
 * 409 — le compte GL associé au compte bancaire n'est pas en classe 5
 * (compte financier). Les paiements doivent passer par 521/522/57.
 */
export class BankAccountWrongClassException extends BusinessException {
  constructor(bankAccountId: string, glAccount: string, actualClass: string) {
    super(
      ErrorCode.BUSINESS.BANK_ACCOUNT_WRONG_CLASS,
      HttpStatus.CONFLICT,
      `GL account ${glAccount} is in class ${actualClass}, expected class 5`,
      { bankAccountId, glAccount, actualClass },
    );
  }
}

/** 409 — compte bancaire désactivé (soft delete). */
export class BankAccountInactiveException extends BusinessException {
  constructor(bankAccountId: string) {
    super(
      ErrorCode.BUSINESS.BANK_ACCOUNT_INACTIVE,
      HttpStatus.CONFLICT,
      `BankAccount is inactive`,
      { bankAccountId },
    );
  }
}

// ===== Sprint F4a — SEPA pain.001 + anti-fraude IBAN + multidevises FX =====

/**
 * 500 — la génération du fichier SEPA pain.001.001.03 a échoué côté
 * service (xmlbuilder2, données manquantes, etc.). Le message technique
 * reste dans les logs serveur ; le code reste stable pour i18n.
 */
export class SepaGenerationFailedException extends BusinessException {
  constructor(runId: string, reason: string) {
    super(
      ErrorCode.BUSINESS.SEPA_GENERATION_FAILED,
      HttpStatus.INTERNAL_SERVER_ERROR,
      `SEPA generation failed: ${reason}`,
      { runId, reason },
    );
  }
}

/** 409 — tentative de téléchargement d'un SEPA non encore généré. */
export class SepaNotGeneratedException extends BusinessException {
  constructor(runId: string) {
    super(
      ErrorCode.BUSINESS.SEPA_NOT_GENERATED,
      HttpStatus.CONFLICT,
      `SEPA file not generated yet for this PaymentRun`,
      { runId },
    );
  }
}

/**
 * 409 — pré-condition non remplie pour générer le SEPA : run pas dans
 * un statut compatible (draft / prepared) ou aucun paiement attaché.
 */
export class SepaRunNotReadyException extends BusinessException {
  constructor(runId: string, status: string) {
    super(
      ErrorCode.BUSINESS.SEPA_RUN_NOT_READY,
      HttpStatus.CONFLICT,
      `PaymentRun not ready for SEPA generation (status=${status})`,
      { runId, status },
    );
  }
}

/**
 * 409 — approbation d'un PaymentRun bloquée par des alertes IBAN actives.
 * Le DAF doit acknowledger via `POST /payment-runs/:id/acknowledge-iban-alerts`
 * avant l'approbation. Le motif est obligatoire et tracé dans l'audit.
 */
export class IbanAlertsNotAcknowledgedException extends BusinessException {
  constructor(runId: string, alertCount: number) {
    super(
      ErrorCode.BUSINESS.IBAN_ALERTS_NOT_ACKNOWLEDGED,
      HttpStatus.CONFLICT,
      `PaymentRun has ${alertCount} unacknowledged IBAN alert(s)`,
      { runId, alertCount },
    );
  }
}

/**
 * 409 — multidevise : aucun taux ref.exchange_rate pour la paire
 * (invoice.currency → bankAccount.currency) à la date de paiement.
 */
export class ExchangeRateForPaymentMissingException extends BusinessException {
  constructor(fromCurrency: string, toCurrency: string, paymentDate: string) {
    super(
      ErrorCode.BUSINESS.EXCHANGE_RATE_FOR_PAYMENT_MISSING,
      HttpStatus.CONFLICT,
      `No exchange rate ${fromCurrency}→${toCurrency} at ${paymentDate}`,
      { fromCurrency, toCurrency, paymentDate },
    );
  }
}

/**
 * 409 — sanity check : l'écart FX entre le montant facture (en devise
 * étrangère convertie au taux de la facture) et le montant payé
 * effectif (en devise du compte) dépasse 10%. Bloque pour forcer
 * une intervention humaine (saisie manuelle de taux, vérification).
 */
export class FxDiffTooLargeException extends BusinessException {
  constructor(invoiceId: string, fxDiffPct: number) {
    super(
      ErrorCode.BUSINESS.FX_DIFF_TOO_LARGE,
      HttpStatus.CONFLICT,
      `FX difference ${fxDiffPct.toFixed(2)}% exceeds 10% threshold`,
      { invoiceId, fxDiffPct },
    );
  }
}

// ===== Sprint 6.1 — Reporting bailleur =====

/** 404 — template de rapport bailleur inconnu. */
export class DonorTemplateNotFoundException extends BusinessException {
  constructor(templateId: string) {
    super(
      ErrorCode.BUSINESS.DONOR_TEMPLATE_NOT_FOUND,
      HttpStatus.NOT_FOUND,
      `Donor report template not found`,
      { templateId },
    );
  }
}

/** 404 — rapport bailleur inconnu. */
export class DonorReportNotFoundException extends BusinessException {
  constructor(reportId: string) {
    super(
      ErrorCode.BUSINESS.DONOR_REPORT_NOT_FOUND,
      HttpStatus.NOT_FOUND,
      `Donor report not found`,
      { reportId },
    );
  }
}

/** 409 — lock impossible : rapport pas en draft. */
export class DonorReportNotDraftException extends BusinessException {
  constructor(reportId: string, status: string) {
    super(
      ErrorCode.BUSINESS.DONOR_REPORT_NOT_DRAFT,
      HttpStatus.CONFLICT,
      `Donor report status "${status}" forbids editing or lock (must be draft)`,
      { reportId, status },
    );
  }
}

/** 409 — send impossible : rapport pas en locked. */
export class DonorReportNotLockedException extends BusinessException {
  constructor(reportId: string, status: string) {
    super(
      ErrorCode.BUSINESS.DONOR_REPORT_NOT_LOCKED,
      HttpStatus.CONFLICT,
      `Donor report status "${status}" forbids send (must be locked)`,
      { reportId, status },
    );
  }
}

/** 409 — toute modification est interdite sur un rapport déjà envoyé. */
export class DonorReportAlreadySentException extends BusinessException {
  constructor(reportId: string) {
    super(
      ErrorCode.BUSINESS.DONOR_REPORT_ALREADY_SENT,
      HttpStatus.CONFLICT,
      `Donor report has already been sent to the donor — immutable`,
      { reportId },
    );
  }
}

/** 404 — tentative de download avant lock (PDF/Excel pas encore générés). */
export class DonorReportFileNotGeneratedException extends BusinessException {
  constructor(reportId: string, kind: 'pdf' | 'excel') {
    super(
      ErrorCode.BUSINESS.DONOR_REPORT_FILE_NOT_GENERATED,
      HttpStatus.NOT_FOUND,
      `${kind.toUpperCase()} not yet generated — lock the report first`,
      { reportId, kind },
    );
  }
}

/**
 * 409 — un template n'a aucun mapping compte → catégorie. Impossible
 * d'agréger quoi que ce soit.
 */
export class DonorTemplateHasNoMappingsException extends BusinessException {
  constructor(templateId: string) {
    super(
      ErrorCode.BUSINESS.DONOR_TEMPLATE_HAS_NO_MAPPINGS,
      HttpStatus.CONFLICT,
      `Donor template has no account mappings — add mappings before generating a report`,
      { templateId },
    );
  }
}

/** 400 — periodEnd < periodStart ou en dehors de la grant. */
export class ReportingPeriodInvalidException extends BusinessException {
  constructor(periodStart: string, periodEnd: string, reason?: string) {
    super(
      ErrorCode.BUSINESS.REPORTING_PERIOD_INVALID,
      HttpStatus.BAD_REQUEST,
      `Invalid reporting period: ${reason ?? 'periodEnd must be >= periodStart and within the grant'}`,
      { periodStart, periodEnd, reason: reason ?? null },
    );
  }
}

/** 409 — pas de taux de change disponible pour la conversion du rapport. */
export class ReportingFxRateMissingException extends BusinessException {
  constructor(from: string, to: string, date: string) {
    super(
      ErrorCode.BUSINESS.REPORTING_FX_RATE_MISSING,
      HttpStatus.CONFLICT,
      `Missing exchange rate ${from}→${to} on or before ${date} for report conversion`,
      { from, to, date },
    );
  }
}

// ===== Sprint 6.2 — Clôture mensuelle + États financiers SYSCEBNL =====

/** 404 — période fiscale inconnue. */
export class PeriodNotFoundException extends BusinessException {
  constructor(periodId: string) {
    super(
      ErrorCode.BUSINESS.PERIOD_NOT_FOUND,
      HttpStatus.NOT_FOUND,
      `Fiscal period not found`,
      { periodId },
    );
  }
}

/** 409 — close impossible : la période est déjà clôturée. */
export class PeriodAlreadyClosedException extends BusinessException {
  constructor(periodId: string, code: string) {
    super(
      ErrorCode.BUSINESS.PERIOD_ALREADY_CLOSED,
      HttpStatus.CONFLICT,
      `Fiscal period "${code}" is already closed`,
      { periodId, code },
    );
  }
}

/** 409 — reopen impossible : la période n'est pas clôturée. */
export class PeriodAlreadyOpenException extends BusinessException {
  constructor(periodId: string, code: string) {
    super(
      ErrorCode.BUSINESS.PERIOD_ALREADY_OPEN,
      HttpStatus.CONFLICT,
      `Fiscal period "${code}" is not closed`,
      { periodId, code },
    );
  }
}

/**
 * 409 — close refusée : au moins un check BLOCKING. `details.checks` détaille
 * les codes (C001, C002, …) et leur payload pour affichage côté front.
 * Override possible uniquement par DAF avec `acknowledgeWarnings=true` et
 * reason explicite (audit trail).
 */
export class PeriodCloseBlockedException extends BusinessException {
  constructor(periodId: string, checks: Array<Record<string, unknown>>) {
    super(
      ErrorCode.BUSINESS.PERIOD_CLOSE_BLOCKED,
      HttpStatus.CONFLICT,
      `Period close blocked by ${checks.length} BLOCKING check(s)`,
      { periodId, checks },
    );
  }
}

/** 400 — reopen sans motif (audit obligatoire). */
export class PeriodReopenReasonRequiredException extends BusinessException {
  constructor() {
    super(
      ErrorCode.BUSINESS.PERIOD_REOPEN_REASON_REQUIRED,
      HttpStatus.BAD_REQUEST,
      `A non-empty reason is required to reopen a closed period`,
    );
  }
}

/**
 * 400 — close avec override (`acknowledgeWarnings=true`) sans motif.
 * L'override DAF est une exception forte (on ferme une période avec
 * findings BLOCKING) — la traçabilité audit exige un motif explicite.
 */
export class PeriodCloseReasonRequiredException extends BusinessException {
  constructor() {
    super(
      ErrorCode.BUSINESS.PERIOD_CLOSE_REASON_REQUIRED,
      HttpStatus.BAD_REQUEST,
      `A non-empty reason is required to close a period with BLOCKING findings (DAF override)`,
    );
  }
}

/** 404 — état financier inconnu. */
export class FinancialStatementNotFoundException extends BusinessException {
  constructor(statementId: string) {
    super(
      ErrorCode.BUSINESS.FINANCIAL_STATEMENT_NOT_FOUND,
      HttpStatus.NOT_FOUND,
      `Financial statement not found`,
      { statementId },
    );
  }
}

/** 409 — tentative de régénération/suppression d'un statement verrouillé. */
export class FinancialStatementLockedException extends BusinessException {
  constructor(statementId: string, type: string) {
    super(
      ErrorCode.BUSINESS.FINANCIAL_STATEMENT_LOCKED,
      HttpStatus.CONFLICT,
      `Financial statement "${type}" is locked — immutable`,
      { statementId, type },
    );
  }
}

/**
 * 409 — l'équilibre comptable n'est pas respecté (emplois ≠ ressources sur
 * un TER, actif ≠ passif sur un bilan). Indique une corruption ou une
 * période sans écriture équilibrée. À investiguer manuellement avant
 * lock — le service refuse de produire un état faux.
 */
export class FinancialStatementNotBalancedException extends BusinessException {
  constructor(type: string, leftTotal: number, rightTotal: number) {
    super(
      ErrorCode.BUSINESS.FINANCIAL_STATEMENT_NOT_BALANCED,
      HttpStatus.CONFLICT,
      `Statement "${type}" is not balanced (left=${leftTotal}, right=${rightTotal})`,
      { type, leftTotal, rightTotal, difference: leftTotal - rightTotal },
    );
  }
}

/** 404 — download impossible : PDF/Excel pas encore généré (statement freshly created). */
export class FinancialStatementFileNotGeneratedException extends BusinessException {
  constructor(statementId: string, kind: 'pdf' | 'xlsx') {
    super(
      ErrorCode.BUSINESS.FINANCIAL_STATEMENT_FILE_NOT_GENERATED,
      HttpStatus.NOT_FOUND,
      `${kind.toUpperCase()} not yet generated — regenerate the statement first`,
      { statementId, kind },
    );
  }
}

// ===== Sprint F-ADMIN-USERS — Gestion des utilisateurs =====

/** 409 — e-mail déjà utilisé (côté Keycloak ou côté AppUser). */
export class UserEmailAlreadyExistsException extends BusinessException {
  constructor(email: string) {
    super(
      ErrorCode.BUSINESS.USER_EMAIL_ALREADY_EXISTS,
      HttpStatus.CONFLICT,
      `User with this email already exists`,
      // Pas de retour de l'e-mail dans details (PII) — on garde uniquement
      // un hash court non-réversible pour distinguer les cas en debug.
      { emailFingerprint: email.length },
    );
  }
}

/** 404 — utilisateur inconnu (Keycloak OU AppUser). */
export class UserNotFoundException extends BusinessException {
  constructor(idOrEmail: string) {
    super(
      ErrorCode.BUSINESS.USER_NOT_FOUND,
      HttpStatus.NOT_FOUND,
      `User not found`,
      { id: idOrEmail },
    );
  }
}

/**
 * 400 — au moins un rôle demandé n'existe pas dans la table `auth.role`.
 * Évite de pousser un rôle inconnu vers Keycloak (qui le refuserait silencieusement
 * ou créerait un rôle orphelin).
 */
export class UserRoleUnknownException extends BusinessException {
  constructor(unknownRoles: string[]) {
    super(
      ErrorCode.BUSINESS.USER_ROLE_UNKNOWN,
      HttpStatus.BAD_REQUEST,
      `One or more roles are not registered in the system`,
      { unknownRoles },
    );
  }
}

/** 409 — activate appelé sur un compte déjà actif. */
export class UserAlreadyActiveException extends BusinessException {
  constructor(userId: string) {
    super(
      ErrorCode.BUSINESS.USER_ALREADY_ACTIVE,
      HttpStatus.CONFLICT,
      `User is already active`,
      { userId },
    );
  }
}

/** 409 — deactivate appelé sur un compte déjà inactif. */
export class UserAlreadyInactiveException extends BusinessException {
  constructor(userId: string) {
    super(
      ErrorCode.BUSINESS.USER_ALREADY_INACTIVE,
      HttpStatus.CONFLICT,
      `User is already inactive`,
      { userId },
    );
  }
}

/**
 * 409 — garde-fou anti-lock-out : refuse de retirer le rôle SUPER_ADMIN
 * du dernier compte qui le possède (sinon plus aucun humain ne peut
 * administrer le système). Le service compte les SUPER_ADMIN actifs avant
 * d'autoriser un setRoles / deactivate.
 */
export class UserCannotRemoveLastSuperAdminException extends BusinessException {
  constructor(userId: string) {
    super(
      ErrorCode.BUSINESS.USER_CANNOT_REMOVE_LAST_SUPER_ADMIN,
      HttpStatus.CONFLICT,
      `Cannot remove SUPER_ADMIN role from the last active super administrator`,
      { userId },
    );
  }
}

/** 409 — un user qui se désactive lui-même se verrouille de l'app. Refusé. */
export class UserCannotDeactivateSelfException extends BusinessException {
  constructor(userId: string) {
    super(
      ErrorCode.BUSINESS.USER_CANNOT_DEACTIVATE_SELF,
      HttpStatus.CONFLICT,
      `Cannot deactivate your own account`,
      { userId },
    );
  }
}

/**
 * 409 — AppUser présent en base, mais aucun compte Keycloak ne correspond
 * à son e-mail. Drift de données — l'admin doit recréer le compte côté
 * Keycloak ou purger l'AppUser orphelin avant de réessayer l'opération.
 *
 * On ne logge JAMAIS l'e-mail dans les details (PII) — uniquement l'AppUser.id.
 */
export class UserKeycloakAccountNotFoundException extends BusinessException {
  constructor(userId: string) {
    super(
      ErrorCode.BUSINESS.USER_KEYCLOAK_ACCOUNT_NOT_FOUND,
      HttpStatus.CONFLICT,
      `No Keycloak account matches this user's email`,
      { userId },
    );
  }
}

// ===== Sprint F-ADMIN-USERS — Provider d'identité (Keycloak Admin API) =====

/**
 * 502 — l'API Admin Keycloak ne répond pas (timeout réseau, container down).
 * On distingue des erreurs métier classiques pour pouvoir afficher un
 * message dédié côté UI ("Service d'authentification injoignable").
 */
export class IdpUnreachableException extends BusinessException {
  constructor(reason: string) {
    super(
      ErrorCode.IDP.UNREACHABLE,
      HttpStatus.BAD_GATEWAY,
      `Identity provider unreachable`,
      { reason },
    );
  }
}

/**
 * 502 — Keycloak refuse de délivrer un access token au service account
 * (client_credentials KO). Cas typique : secret rotaté, ou client mal
 * configuré (serviceAccountsEnabled=false). Ne JAMAIS logger le secret.
 */
export class IdpAdminTokenFailedException extends BusinessException {
  constructor(httpStatus: number) {
    super(
      ErrorCode.IDP.ADMIN_TOKEN_FAILED,
      HttpStatus.BAD_GATEWAY,
      `Failed to obtain admin token from identity provider`,
      { providerStatus: httpStatus },
    );
  }
}

/**
 * 502 — une opération Admin Keycloak (create/update/role-mapping/email)
 * a renvoyé une erreur non gérée. `providerStatus` permet de remonter
 * le code HTTP Keycloak côté logs serveur (jamais côté UI publique).
 */
export class IdpAdminOperationFailedException extends BusinessException {
  constructor(operation: string, providerStatus: number, providerMessage?: string) {
    super(
      ErrorCode.IDP.ADMIN_OPERATION_FAILED,
      HttpStatus.BAD_GATEWAY,
      `Identity provider operation "${operation}" failed`,
      { operation, providerStatus, providerMessage: providerMessage ?? null },
    );
  }
}

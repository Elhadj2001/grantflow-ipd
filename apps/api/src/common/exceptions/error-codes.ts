/**
 * Catalogue centralisé des codes d'erreur métier.
 *
 * Format : `MODULE.SUB_CODE` (UPPER_SNAKE, séparé par `.`).
 *  - Stable dans le temps : les fronts (i18next, ngx-translate, react-intl)
 *    et clients externes (intégrations bailleurs) résolvent leurs traductions
 *    sur ces clés. Ne JAMAIS renommer un code — ajouter un nouveau si besoin.
 *  - Source unique : ne laisser AUCUNE chaîne magique dans le code applicatif,
 *    toujours passer par `ErrorCode.*`.
 *
 * Convention HTTP en prod :
 *   La réponse renvoyée au client ne doit contenir que `{ code }`.
 *   Le `message` est résolu côté front via le catalogue i18n.
 *   Le message technique transporté par l'exception reste pour les logs serveur.
 */
export const ErrorCode = {
  AUTH: {
    UNAUTHENTICATED: 'AUTH.UNAUTHENTICATED',
    INVALID_TOKEN:   'AUTH.INVALID_TOKEN',
    EXPIRED_TOKEN:   'AUTH.EXPIRED_TOKEN',
    FORBIDDEN_ROLE:  'AUTH.FORBIDDEN_ROLE',
  },
  AUDIT: {
    PERSIST_FAILED:  'AUDIT.PERSIST_FAILED',
  },
  /**
   * Erreurs métier transverses. Toute entité référentielle peut les
   * lever — pas besoin d'un namespace dédié par entité tant que la
   * sémantique reste générique (doublon, déjà inactif, etc.).
   */
  BUSINESS: {
    NOT_FOUND:                  'BUSINESS.NOT_FOUND',
    DUPLICATE_CODE:             'BUSINESS.DUPLICATE_CODE',
    ALREADY_INACTIVE:           'BUSINESS.ALREADY_INACTIVE',
    ALREADY_ACTIVE:             'BUSINESS.ALREADY_ACTIVE',
    PROJECT_HAS_ACTIVE_GRANTS:  'BUSINESS.PROJECT_HAS_ACTIVE_GRANTS',
    GRANT_HAS_TRANSACTIONS:     'BUSINESS.GRANT_HAS_TRANSACTIONS',
    BUDGET_LINE_HAS_USAGE:      'BUSINESS.BUDGET_LINE_HAS_USAGE',
    BUDGET_LINES_EXCEED_GRANT:  'BUSINESS.BUDGET_LINES_EXCEED_GRANT',
    INACTIVE_DONOR:             'BUSINESS.INACTIVE_DONOR',
    INACTIVE_PROJECT:           'BUSINESS.INACTIVE_PROJECT',
    INVALID_DATE_RANGE:         'BUSINESS.INVALID_DATE_RANGE',
    SUPPLIER_HAS_ACTIVE_POS:    'BUSINESS.SUPPLIER_HAS_ACTIVE_POS',
    AXIS_HAS_USAGE:             'BUSINESS.AXIS_HAS_USAGE',
    AXIS_HAS_CHILDREN:          'BUSINESS.AXIS_HAS_CHILDREN',
    AXIS_CYCLE:                 'BUSINESS.AXIS_CYCLE',
    AXIS_PARENT_WRONG_TYPE:     'BUSINESS.AXIS_PARENT_WRONG_TYPE',
    INVALID_IBAN:               'BUSINESS.INVALID_IBAN',
    INVALID_BIC:                'BUSINESS.INVALID_BIC',
    TAX_CODE_HAS_USAGE:         'BUSINESS.TAX_CODE_HAS_USAGE',
    GL_ACCOUNT_HAS_ENTRIES:     'BUSINESS.GL_ACCOUNT_HAS_ENTRIES',
    GL_ACCOUNT_HAS_CHILDREN:    'BUSINESS.GL_ACCOUNT_HAS_CHILDREN',
    INVALID_CLASS_PREFIX:       'BUSINESS.INVALID_CLASS_PREFIX',
    EXCHANGE_RATE_NOT_FOUND:    'BUSINESS.EXCHANGE_RATE_NOT_FOUND',
    SAME_CURRENCY:              'BUSINESS.SAME_CURRENCY',
    FIXED_RATE_EXISTS:          'BUSINESS.FIXED_RATE_EXISTS',
    IMMUTABLE_FIXED_RATE:       'BUSINESS.IMMUTABLE_FIXED_RATE',
    PR_NOT_EDITABLE:            'BUSINESS.PR_NOT_EDITABLE',
    PR_NOT_DELETABLE:           'BUSINESS.PR_NOT_DELETABLE',
    PR_NOT_OWNED:               'BUSINESS.PR_NOT_OWNED',
    GRANT_NOT_ACTIVE:           'BUSINESS.GRANT_NOT_ACTIVE',
    INSUFFICIENT_BUDGET:        'BUSINESS.INSUFFICIENT_BUDGET',
    BUDGET_LINE_NOT_IN_GRANT:   'BUSINESS.BUDGET_LINE_NOT_IN_GRANT',
    PROJECT_GRANT_MISMATCH:     'BUSINESS.PROJECT_GRANT_MISMATCH',
    PR_NOT_AWAITING_YOU:        'BUSINESS.PR_NOT_AWAITING_YOU',
    PR_ALREADY_DECIDED:         'BUSINESS.PR_ALREADY_DECIDED',
    REJECTION_REASON_REQUIRED:  'BUSINESS.REJECTION_REASON_REQUIRED',
    PR_NOT_IN_APPROVAL:         'BUSINESS.PR_NOT_IN_APPROVAL',
    PI_NOT_OWNER_OF_PROJECT:    'BUSINESS.PI_NOT_OWNER_OF_PROJECT',
    SPLITTING_DETECTED:         'BUSINESS.SPLITTING_DETECTED',
    /**
     * Conservé pour rétro-compatibilité — sprint 2.3 implémente le workflow
     * cash. Aucun chemin de code n'émet plus ce code, mais le catalogue le
     * garde pour ne pas casser les i18n côté front (renommer un code stable
     * est interdit, cf. §1 de ce fichier).
     */
    CASH_WORKFLOW_NOT_YET_IMPLEMENTED: 'BUSINESS.CASH_WORKFLOW_NOT_YET_IMPLEMENTED',
    /** Sprint 2.3 — workflow petite caisse / avance de mission. */
    CASH_PAYMENT_NOT_ALLOWED:        'BUSINESS.CASH_PAYMENT_NOT_ALLOWED',
    CASH_LIMIT_PER_REQUEST_EXCEEDED: 'BUSINESS.CASH_LIMIT_PER_REQUEST_EXCEEDED',
    CASH_LIMIT_PER_DAY_EXCEEDED:     'BUSINESS.CASH_LIMIT_PER_DAY_EXCEEDED',
    CASH_BOX_INACTIVE:               'BUSINESS.CASH_BOX_INACTIVE',
    CASH_BOX_INSUFFICIENT_FUNDS:     'BUSINESS.CASH_BOX_INSUFFICIENT_FUNDS',
    CASH_BOX_REQUIRED:               'BUSINESS.CASH_BOX_REQUIRED',
    CASH_ADVANCE_NOT_SETTLED:        'BUSINESS.CASH_ADVANCE_NOT_SETTLED',
    PR_ALREADY_SETTLED:              'BUSINESS.PR_ALREADY_SETTLED',
    PR_TYPE_MISMATCH:                'BUSINESS.PR_TYPE_MISMATCH',
    PR_NOT_APPROVED_FOR_SETTLE:      'BUSINESS.PR_NOT_APPROVED_FOR_SETTLE',
    /** Sprint 3 — Bons de Commande. */
    PO_NOT_EDITABLE:                 'BUSINESS.PO_NOT_EDITABLE',
    PO_NOT_SENDABLE:                 'BUSINESS.PO_NOT_SENDABLE',
    PO_NOT_CANCELLABLE:              'BUSINESS.PO_NOT_CANCELLABLE',
    PO_NOT_ACKNOWLEDGEABLE:          'BUSINESS.PO_NOT_ACKNOWLEDGEABLE',
    PO_NO_CONTACT_EMAIL:             'BUSINESS.PO_NO_CONTACT_EMAIL',
    PO_NO_PDF:                       'BUSINESS.PO_NO_PDF',
    PR_NOT_APPROVED:                 'BUSINESS.PR_NOT_APPROVED',
    PR_ALREADY_HAS_PO:               'BUSINESS.PR_ALREADY_HAS_PO',
    PR_TYPE_PETTY_CASH_NO_PO:        'BUSINESS.PR_TYPE_PETTY_CASH_NO_PO',
    SUPPLIER_INACTIVE:               'BUSINESS.SUPPLIER_INACTIVE',
    SUPPLIER_MISMATCH_PRS:           'BUSINESS.SUPPLIER_MISMATCH_PRS',
    PR_LIST_EMPTY:                   'BUSINESS.PR_LIST_EMPTY',
    PO_CURRENCY_MISMATCH:            'BUSINESS.PO_CURRENCY_MISMATCH',
    NO_OPEN_FISCAL_PERIOD:           'BUSINESS.NO_OPEN_FISCAL_PERIOD',
    /** Sprint 4.1 — Réceptions de biens (Goods Receipt). */
    PO_NOT_RECEIVABLE:               'BUSINESS.PO_NOT_RECEIVABLE',
    GR_NOT_EDITABLE:                 'BUSINESS.GR_NOT_EDITABLE',
    GR_EMPTY_LINES:                  'BUSINESS.GR_EMPTY_LINES',
    GR_QTY_EXCEEDS_ORDER:            'BUSINESS.GR_QTY_EXCEEDS_ORDER',
    COLD_CHAIN_BROKEN:               'BUSINESS.COLD_CHAIN_BROKEN',
    BATCH_INFO_REQUIRED:             'BUSINESS.BATCH_INFO_REQUIRED',
    GR_ALREADY_COMPLETE:             'BUSINESS.GR_ALREADY_COMPLETE',
    GR_NOT_CANCELLABLE:              'BUSINESS.GR_NOT_CANCELLABLE',
    GR_NOT_REJECTABLE:               'BUSINESS.GR_NOT_REJECTABLE',
    GR_LINE_NOT_FOUND:               'BUSINESS.GR_LINE_NOT_FOUND',
    REJECTION_REASON_MISSING:        'BUSINESS.REJECTION_REASON_MISSING',
    /** Sprint 4.2a — Factures + OCR + matching 3-way. */
    INVOICE_NOT_CAPTURABLE:          'BUSINESS.INVOICE_NOT_CAPTURABLE',
    INVOICE_NOT_EDITABLE:            'BUSINESS.INVOICE_NOT_EDITABLE',
    INVOICE_NO_PO_LINKED:            'BUSINESS.INVOICE_NO_PO_LINKED',
    INVOICE_DUPLICATE_NUMBER:        'BUSINESS.INVOICE_DUPLICATE_NUMBER',
    OCR_EXTRACTION_FAILED:           'BUSINESS.OCR_EXTRACTION_FAILED',
    OCR_LOW_CONFIDENCE:              'BUSINESS.OCR_LOW_CONFIDENCE',
    MATCHING_NO_RECEIPT:             'BUSINESS.MATCHING_NO_RECEIPT',
    MATCHING_FORCE_REASON_REQUIRED:  'BUSINESS.MATCHING_FORCE_REASON_REQUIRED',
    INVOICE_NOT_REJECTABLE:          'BUSINESS.INVOICE_NOT_REJECTABLE',
    /** Sprint 4.2b — Comptabilisation facture + extournement classe 8. */
    INVOICE_NOT_POSTABLE:            'BUSINESS.INVOICE_NOT_POSTABLE',
    INVOICE_ALREADY_POSTED:          'BUSINESS.INVOICE_ALREADY_POSTED',
    PERIOD_CLOSED:                   'BUSINESS.PERIOD_CLOSED',
    EXCHANGE_RATE_MISSING:           'BUSINESS.EXCHANGE_RATE_MISSING',
    GL_ACCOUNT_NOT_FOUND:            'BUSINESS.GL_ACCOUNT_NOT_FOUND',
    POSTING_HAS_PAYMENT:             'BUSINESS.POSTING_HAS_PAYMENT',
    POSTING_CANCEL_REASON_REQUIRED:  'BUSINESS.POSTING_CANCEL_REASON_REQUIRED',
  },
  REF: {
    INVALID_GL_ACCOUNT: 'REF.INVALID_GL_ACCOUNT',
  },
} as const;

/**
 * Union de tous les codes possibles — sert de contrainte de type
 * dans `BusinessException` pour interdire les codes inventés à la volée.
 */
type LeafValues<T> = T extends string
  ? T
  : T extends Record<string, unknown>
    ? { [K in keyof T]: LeafValues<T[K]> }[keyof T]
    : never;

export type ErrorCodeValue = LeafValues<typeof ErrorCode>;

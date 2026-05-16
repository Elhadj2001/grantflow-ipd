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

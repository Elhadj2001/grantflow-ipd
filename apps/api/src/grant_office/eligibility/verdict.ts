/**
 * Résultat de l'évaluation d'une règle d'éligibilité (ADR-007).
 *
 * - ok       : la règle passe.
 * - blocked  : la règle refuse l'opération, motif explicite. L'opération
 *              ne peut pas être soumise.
 * - warning  : la règle alerte sur un point d'attention (ex: anti-splitting)
 *              mais n'empêche pas l'opération. À surfacer côté UI.
 *
 * Aucune dépendance Prisma : type pur, réutilisable côté shared si besoin.
 */
export type Verdict =
  | { kind: 'ok' }
  | { kind: 'blocked'; code: string; message: string; details?: Record<string, unknown> }
  | { kind: 'warning'; code: string; message: string; details?: Record<string, unknown> };

export type BlockedVerdict = Extract<Verdict, { kind: 'blocked' }>;
export type WarningVerdict = Extract<Verdict, { kind: 'warning' }>;

/** Verdict positif partagé (immuable). */
export const OK: Verdict = { kind: 'ok' };

export function blocked(code: string, message: string, details?: Record<string, unknown>): Verdict {
  return { kind: 'blocked', code, message, details };
}

export function warning(code: string, message: string, details?: Record<string, unknown>): Verdict {
  return { kind: 'warning', code, message, details };
}

export function isBlocking(verdict: Verdict): verdict is BlockedVerdict {
  return verdict.kind === 'blocked';
}

export function isWarning(verdict: Verdict): verdict is WarningVerdict {
  return verdict.kind === 'warning';
}

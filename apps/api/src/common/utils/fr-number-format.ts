/**
 * Formatage numérique français pour les PDF (fix/pdf-thousands-separator).
 *
 * Les ICU récents de Node font produire à `toLocaleString('fr-FR')` une
 * ESPACE FINE insécable U+202F comme séparateur de milliers. Les polices
 * standard pdfkit (Helvetica, encodage WinAnsi) ne savent PAS encoder
 * U+202F → glyphe cassé dans les montants des PDF (BC, factures simulées).
 *
 * On normalise vers U+00A0 (espace insécable classique) : encodable WinAnsi
 * (0xA0) et conforme à la règle CLAUDE.md « séparateur de milliers = espace
 * insécable ». Source unique — les services PDF délèguent ici.
 *
 * NB : constantes construites via String.fromCharCode — AUCUN littéral
 * invisible dans ce fichier (indiscernable à la relecture, source de bug).
 */
const NBSP = String.fromCharCode(0x00a0);
const NARROW_NBSP_RE = new RegExp(String.fromCharCode(0x202f), 'g');

/** Remplace U+202F (narrow no-break space, non-WinAnsi) par U+00A0. */
function withWinAnsiSeparators(s: string): string {
  return s.replace(NARROW_NBSP_RE, NBSP);
}

/** Montant FR (0 à 2 décimales) — séparateur de milliers U+00A0. */
export function formatMoneyFr(v: number): string {
  return withWinAnsiSeparators(
    v.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }),
  );
}

/** Quantité FR (0 à 4 décimales) — séparateur de milliers U+00A0. */
export function formatQuantityFr(v: number): string {
  return withWinAnsiSeparators(
    v.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 4 }),
  );
}

/**
 * US-075 (F-S8-15) — montant FR à 2 décimales FIXES (rendu des rapports
 * bailleurs et états SYSCEBNL, qui affichent toujours les centimes).
 * Même normalisation WinAnsi que formatMoneyFr.
 */
export function formatMoneyFr2(v: number): string {
  return withWinAnsiSeparators(
    v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  );
}

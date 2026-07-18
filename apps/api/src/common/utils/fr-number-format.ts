/**
 * Formatage numérique français pour les PDF (fix/pdf-thousands-separator).
 *
 * PROBLÈME (démontré au niveau octets du content stream pdfkit) :
 * `toLocaleString('fr-FR')` avec un ICU récent produit une ESPACE FINE
 * insécable U+202F comme séparateur de milliers. La police standard pdfkit
 * (Helvetica, encodage WinAnsi) N'A PAS de glyphe pour ce caractère :
 *   - U+202F → pdfkit émet 2 octets `20 2F` → le second, 0x2F, est le
 *     caractère « / » : un SLASH parasite apparaît dans les montants.
 *   - U+00A0 (espace insécable classique) → octet 0xA0 = code 160, ABSENT
 *     du fichier `Helvetica.afm` bundlé (seul le code 32 « space » existe,
 *     pas de « nbspace ») → glyphe `.notdef` (carré cassé).
 *
 * Autrement dit, l'ancien correctif U+202F → U+00A0 remplaçait un glyphe
 * cassé (slash) par un autre (carré). Le SEUL séparateur d'espace réellement
 * rendu par la police standard est l'ESPACE ASCII U+0020 (code 32, présent
 * dans l'AFM). On normalise donc TOUT espace insécable (U+202F ET U+00A0)
 * vers U+0020. Compromis assumé : l'espace ASCII est sécable (peut passer à
 * la ligne), sans conséquence dans une cellule de montant à largeur fixe —
 * gain de lisibilité garanti > insécabilité typographique perdue. (Une vraie
 * espace insécable nécessiterait d'embarquer une police TTF, ce que les
 * services PDF évitent volontairement — « pur pdfkit sans dépendance fs ».)
 *
 * NB : constantes construites via String.fromCharCode — AUCUN littéral
 * invisible dans ce fichier (indiscernable à la relecture, source de bug).
 */
const ASCII_SPACE = String.fromCharCode(0x0020);
/** Espaces insécables non rendus par la police standard pdfkit : U+202F, U+00A0. */
const NON_WINANSI_SPACES_RE = new RegExp(
  `[${String.fromCharCode(0x202f)}${String.fromCharCode(0x00a0)}]`,
  'g',
);

/**
 * Remplace tout séparateur insécable non rendu (U+202F, U+00A0) par une
 * espace ASCII U+0020 — seul séparateur avec un glyphe dans Helvetica pdfkit.
 */
function withWinAnsiSeparators(s: string): string {
  return s.replace(NON_WINANSI_SPACES_RE, ASCII_SPACE);
}

/** Montant FR (0 à 2 décimales) — séparateur de milliers U+0020 (ASCII). */
export function formatMoneyFr(v: number): string {
  return withWinAnsiSeparators(
    v.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }),
  );
}

/** Quantité FR (0 à 4 décimales) — séparateur de milliers U+0020 (ASCII). */
export function formatQuantityFr(v: number): string {
  return withWinAnsiSeparators(
    v.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 4 }),
  );
}

/**
 * US-075 (F-S8-15) — montant FR à 2 décimales FIXES (rendu des rapports
 * bailleurs et états SYSCEBNL, qui affichent toujours les centimes).
 * Même normalisation ASCII que formatMoneyFr.
 */
export function formatMoneyFr2(v: number): string {
  return withWinAnsiSeparators(
    v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  );
}

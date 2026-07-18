/**
 * fix/pdf-thousands-separator — le séparateur de milliers des PDF doit être
 * l'ESPACE ASCII U+0020, seul caractère d'espace avec un glyphe dans la
 * police standard pdfkit (Helvetica.afm : code 32 « space » présent ; code
 * 160 U+00A0 absent ; U+202F émis en `20 2F` → slash « / » parasite).
 * Assertions par code points explicites — aucun littéral invisible.
 */
import { formatMoneyFr, formatMoneyFr2, formatQuantityFr } from '../fr-number-format';

const SPACE = String.fromCharCode(0x0020);
const NBSP = String.fromCharCode(0x00a0);
const NARROW_NBSP = String.fromCharCode(0x202f);

/** Tout caractère hors ASCII (> 0x7F) est non rendu par Helvetica pdfkit. */
function hasNonAscii(s: string): boolean {
  return [...s].some((c) => c.charCodeAt(0) > 0x7f);
}

describe('fr-number-format (fix/pdf-thousands-separator)', () => {
  it('formatMoneyFr : ni U+202F, ni U+00A0, sortie 100% ASCII', () => {
    for (const v of [0, 999, 1000, 1234567.89, 987654321.5]) {
      const s = formatMoneyFr(v);
      expect(s).not.toContain(NARROW_NBSP);
      expect(s).not.toContain(NBSP);
      expect(hasNonAscii(s)).toBe(false);
    }
  });

  it('formatQuantityFr : ni U+202F, ni U+00A0, sortie 100% ASCII', () => {
    for (const v of [1, 1500, 12345.6789]) {
      const s = formatQuantityFr(v);
      expect(s).not.toContain(NARROW_NBSP);
      expect(s).not.toContain(NBSP);
      expect(hasNonAscii(s)).toBe(false);
    }
  });

  it('cas 1234567.89 : séparateurs ESPACE ASCII, décimales à la virgule', () => {
    expect(formatMoneyFr(1234567.89)).toBe(`1${SPACE}234${SPACE}567,89`);
  });

  it('entier sans décimales inutiles (1 500 000)', () => {
    expect(formatMoneyFr(1_500_000)).toBe(`1${SPACE}500${SPACE}000`);
  });

  it('formatQuantityFr : jusqu à 4 décimales (12 345,6789)', () => {
    expect(formatQuantityFr(12345.6789)).toBe(`12${SPACE}345,6789`);
  });

  // US-075 (F-S8-15) — variante 2 décimales fixes (rapports bailleurs / SYSCEBNL)
  it('formatMoneyFr2 : 2 décimales FIXES, séparateur ASCII, 100% ASCII', () => {
    for (const v of [0, 1234567.89, 1_500_000]) {
      const s = formatMoneyFr2(v);
      expect(s).not.toContain(NARROW_NBSP);
      expect(s).not.toContain(NBSP);
      expect(hasNonAscii(s)).toBe(false);
    }
    expect(formatMoneyFr2(1_500_000)).toBe(`1${SPACE}500${SPACE}000,00`);
    expect(formatMoneyFr2(1234567.89)).toBe(`1${SPACE}234${SPACE}567,89`);
  });
});

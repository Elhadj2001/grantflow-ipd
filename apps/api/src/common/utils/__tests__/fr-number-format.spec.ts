/**
 * fix/pdf-thousands-separator — le séparateur de milliers des PDF doit être
 * U+00A0 (encodable WinAnsi 0xA0), JAMAIS U+202F (glyphe cassé en Helvetica
 * pdfkit). Assertions par code points explicites — aucun littéral invisible.
 */
import { formatMoneyFr, formatQuantityFr } from '../fr-number-format';

const NBSP = String.fromCharCode(0x00a0);
const NARROW_NBSP = String.fromCharCode(0x202f);

describe('fr-number-format (fix/pdf-thousands-separator)', () => {
  it('formatMoneyFr : aucune occurrence U+202F dans la sortie', () => {
    for (const v of [0, 999, 1000, 1234567.89, 987654321.5]) {
      expect(formatMoneyFr(v)).not.toContain(NARROW_NBSP);
    }
  });

  it('formatQuantityFr : aucune occurrence U+202F dans la sortie', () => {
    for (const v of [1, 1500, 12345.6789]) {
      expect(formatQuantityFr(v)).not.toContain(NARROW_NBSP);
    }
  });

  it('cas 1234567.89 : séparateurs U+00A0 exacts, décimales à la virgule', () => {
    expect(formatMoneyFr(1234567.89)).toBe(`1${NBSP}234${NBSP}567,89`);
  });

  it('entier sans décimales inutiles (1 500 000)', () => {
    expect(formatMoneyFr(1_500_000)).toBe(`1${NBSP}500${NBSP}000`);
  });

  it('formatQuantityFr : jusqu à 4 décimales (12 345,6789)', () => {
    expect(formatQuantityFr(12345.6789)).toBe(`12${NBSP}345,6789`);
  });
});

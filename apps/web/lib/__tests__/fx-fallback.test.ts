/**
 * Tests du fallback FX UI (fix da-multi-currency).
 *
 * On vérifie principalement le taux BCEAO immuable EUR↔XOF et le
 * comportement des devises non supportées. Les taux indicatifs
 * USD/GBP/CHF sont juste vérifiés à l'ordre de grandeur (le commit
 * d'écritures comptables utilise les vrais taux côté serveur).
 */
import { convertAmount, FX_SUPPORTED_CURRENCIES } from '../fx-fallback';

describe('convertAmount — fix da-multi-currency', () => {
  it('même devise → no-op (factor 1)', () => {
    expect(convertAmount(1234.5, 'XOF', 'XOF')).toBe(1234.5);
    expect(convertAmount(1000, 'EUR', 'EUR')).toBe(1000);
  });

  it('EUR → XOF : taux fixe BCEAO 655.957 exact', () => {
    expect(convertAmount(1, 'EUR', 'XOF')).toBe(655.957);
    expect(convertAmount(100, 'EUR', 'XOF')).toBeCloseTo(65595.7, 4);
  });

  it('XOF → EUR : inverse du taux fixe', () => {
    const out = convertAmount(655957, 'XOF', 'EUR');
    expect(out).toBeCloseTo(1000, 6);
  });

  it('USD/GBP/CHF → XOF : ordres de grandeur indicatifs', () => {
    const usd = convertAmount(100, 'USD', 'XOF');
    expect(usd).toBeGreaterThan(50_000); // ~60 000 (taux indicatif 600)
    expect(usd).toBeLessThan(80_000);
    const gbp = convertAmount(100, 'GBP', 'XOF');
    expect(gbp).toBeGreaterThan(60_000);
    const chf = convertAmount(100, 'CHF', 'XOF');
    expect(chf).toBeGreaterThan(50_000);
  });

  it('devise inconnue → null (caller laisse le serveur valider)', () => {
    expect(convertAmount(100, 'JPY', 'XOF')).toBeNull();
    expect(convertAmount(100, 'XOF', 'INR')).toBeNull();
  });

  it('FX_SUPPORTED_CURRENCIES couvre les 5 devises attendues', () => {
    expect(FX_SUPPORTED_CURRENCIES).toEqual(['XOF', 'EUR', 'USD', 'GBP', 'CHF']);
  });
});

import { maskEmail } from '../mask-email.util';

describe('maskEmail (sprint F-PO-EMAIL)', () => {
  it('masque le local-part en gardant la première lettre + le domaine', () => {
    expect(maskEmail('achats@biomed-sn.demo')).toBe('a*****@biomed-sn.demo');
  });

  it('un caractère de local-part → masqué totalement', () => {
    expect(maskEmail('x@y.com')).toBe('*@y.com');
  });

  it('local-part vide (rare) → *@domain', () => {
    expect(maskEmail('@y.com')).toBe('*@y.com');
  });

  it('valeur null → (none)', () => {
    expect(maskEmail(null)).toBe('(none)');
  });

  it('valeur undefined → (none)', () => {
    expect(maskEmail(undefined)).toBe('(none)');
  });

  it('chaîne vide → (none)', () => {
    expect(maskEmail('')).toBe('(none)');
  });

  it('pas un e-mail (pas de @) → masquage total', () => {
    expect(maskEmail('pas-un-mail')).toBe('***');
  });

  it('ne logue jamais le local-part en clair (assertion globale)', () => {
    const cases = [
      'sensible@x.com',
      'eniang68@gmail.com',
      'CONFIDENTIEL@y.org',
    ];
    for (const v of cases) {
      const masked = maskEmail(v);
      const localPart = v.split('@')[0];
      // Le 1er caractère est conservé volontairement (utile au diag),
      // mais le reste ne doit JAMAIS apparaître.
      const rest = localPart.slice(1);
      if (rest.length > 0) {
        expect(masked).not.toContain(rest);
      }
    }
  });
});

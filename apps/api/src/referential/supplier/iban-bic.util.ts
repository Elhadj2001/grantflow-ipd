/**
 * Validation IBAN ISO 13616 sans dépendance externe.
 *
 * Algorithme :
 *  1. Strip espaces ; majuscule ; longueur 15..34.
 *  2. Déplace les 4 premiers caractères à la fin.
 *  3. Remplace chaque lettre par sa position alphabet+9 (A=10..Z=35).
 *  4. Calcule mod 97 par chunks (BigInt indésirable côté perf).
 *  5. Doit valoir 1.
 *
 * Ne valide pas la longueur par pays — laissée à un middleware bancaire futur
 * (ex: librarie `iban` si on doit refuser un FR != 27 chars).
 */
export function isValidIban(raw: string): boolean {
  const s = raw.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(s)) return false;

  const rearranged = s.slice(4) + s.slice(0, 4);
  let remainder = 0;
  for (let i = 0; i < rearranged.length; i += 1) {
    const c = rearranged.charCodeAt(i);
    // 0..9 → 48..57 ; A..Z → 65..90
    const v = c >= 65 ? c - 55 : c - 48;
    // Pour les lettres on a deux chiffres (ex A=10 → "10"), on accumule
    // chaque chiffre indépendamment via base 10.
    if (v >= 10) {
      remainder = (remainder * 10 + Math.floor(v / 10)) % 97;
      remainder = (remainder * 10 + (v % 10)) % 97;
    } else {
      remainder = (remainder * 10 + v) % 97;
    }
  }
  return remainder === 1;
}

/** ISO 9362 : 4 lettres banque + 2 lettres pays + 2 alphanum locality + 3 alphanum branch optionnel. */
export const BIC_REGEX = /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/;

export function isValidBic(raw: string): boolean {
  return BIC_REGEX.test(raw.toUpperCase().replace(/\s+/g, ''));
}

/**
 * Format d'URI interne pour les QR codes GRANTFLOW.
 *
 * Pas de norme GS1 / EAN — on génère nos propres codes pour notre
 * propre étiquetage. Volontairement préfixé `GRF://` pour qu'un scan
 * d'un code-barres tiers (EAN-13 d'un emballage, code SKU fournisseur)
 * ne soit pas confondu avec un de nos identifiants.
 *
 * Formats supportés :
 *   - GRF://<grId>/<lineId>                 (ligne entière, scan réception)
 *   - GRF://<grId>/<lineId>/<carton>        (carton spécifique, audit)
 *   - GRF://<grId>/<lineId>?qty=<n>         (incrément explicite, optionnel)
 *
 * Les UUIDs sont conservés tels quels (36 chars hex+tirets) — pas
 * d'encodage Base32 / shortening pour rester lisible et debuggable.
 */

export interface GrfUri {
  grId: string;
  lineId: string;
  /** N° de carton si présent (1-N). */
  carton?: number;
  /** Quantité à incrémenter (défaut 1). */
  qty?: number;
}

const UUID_RE = /^[0-9a-f-]{36}$/i;

/**
 * Parse une chaîne scannée. Renvoie `null` si la chaîne n'est pas un
 * URI GRF reconnu (ex: EAN-13 d'un colis fournisseur — on l'ignore).
 */
export function parseGrfUri(input: string): GrfUri | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed.startsWith('GRF://')) return null;

  const rest = trimmed.slice('GRF://'.length);
  const [pathPart, queryPart] = rest.split('?', 2);
  const segments = pathPart.split('/').filter(Boolean);

  if (segments.length < 2 || segments.length > 3) return null;
  const [grId, lineId, cartonStr] = segments;
  if (!UUID_RE.test(grId) || !UUID_RE.test(lineId)) return null;

  let carton: number | undefined;
  if (cartonStr !== undefined) {
    const n = Number(cartonStr);
    if (!Number.isInteger(n) || n < 1 || n > 9999) return null;
    carton = n;
  }

  let qty: number | undefined;
  if (queryPart) {
    const params = new URLSearchParams(queryPart);
    const qStr = params.get('qty');
    if (qStr !== null) {
      const n = Number(qStr);
      if (!Number.isInteger(n) || n < 1 || n > 9999) return null;
      qty = n;
    }
  }

  return { grId, lineId, carton, qty };
}

/** Construit une URI GRF (utilisé par le service d'étiquettes côté serveur). */
export function buildGrfUri({ grId, lineId, carton, qty }: GrfUri): string {
  let base = `GRF://${grId}/${lineId}`;
  if (carton !== undefined) base += `/${carton}`;
  if (qty !== undefined) base += `?qty=${qty}`;
  return base;
}

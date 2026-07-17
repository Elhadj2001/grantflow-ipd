/**
 * Sprint F-OCR-VISION — Abstraction `OcrProvider`.
 *
 * Le résultat OcrResult est le CONTRAT consommé par `invoice.service`
 * (création Invoice 'captured' + persistance `captured_payload`).
 * Forme FIGÉE — toute implémentation (pdf-parse, Claude Vision, etc.)
 * doit produire exactement ces champs avec ces sémantiques, faute de
 * quoi l'UI de pré-remplissage côté front se trouverait cassée.
 */

export interface OcrLineCandidate {
  description: string;
  quantity?: number;
  unitPrice?: number;
  lineTotal?: number;
}

export interface OcrFields {
  supplierName?: string;
  supplierId?: string;
  invoiceNumber?: string;
  invoiceDate?: Date;
  dueDate?: Date;
  totalHt?: number;
  totalVat?: number;
  totalTtc?: number;
  currency?: string;
  poReference?: string;
  lines?: OcrLineCandidate[];
}

export interface OcrResult {
  /**
   * Texte brut extrait du PDF. Pour pdf-parse = couche texte native ;
   * pour les providers Vision/IA = peut être vide (l'extraction se fait
   * directement en JSON structuré) ou contenir un dump intermédiaire.
   */
  rawText: string;
  /**
   * `true` si le PDF est probablement une image scannée (couche texte
   * vide / trop courte). Drapeau utilisé par la façade `OcrService` en
   * mode `auto` pour décider de basculer sur un provider Vision.
   */
  isImageScan: boolean;
  /** Confiance globale 0-100 (moyenne pondérée des champs extraits). */
  confidence: number;
  fields: OcrFields;
  /** Confiance par champ 0-100. Clé = `keyof OcrFields`. */
  fieldConfidence: Record<string, number>;
  /**
   * US-077 (F-S8-04) — anomalies détectées à l'extraction (ex.
   * `totals_inconsistent` quand HT+TVA≠TTC). Optionnel : les providers
   * qui n'en produisent pas restent conformes. Persisté dans
   * `captured_payload` → visible au panneau OCR du détail facture.
   */
  warnings?: string[];
}

/**
 * Provider OCR : extrait des champs structurés d'un PDF de facture.
 *
 * Toute implémentation DOIT :
 *  - garantir la forme `OcrResult` (compatible UI pré-remplissage),
 *  - lever `OcrExtractionFailedException` (sous-classe de
 *    BusinessException) en cas d'échec définitif. La façade peut
 *    catcher et tenter un fallback provider — l'implémentation elle-même
 *    ne tente PAS de fallback.
 *  - ne JAMAIS logger de PII (contenu de facture, IBAN, e-mails…).
 */
export interface OcrProvider {
  /** Identifiant lisible du provider, pour les logs. */
  readonly name: string;
  /**
   * Extrait depuis un PDF en buffer. Le buffer doit rester en mémoire —
   * pas de write-to-disk pour ne pas exposer le contenu sur le filesystem.
   */
  extractFromPdf(buffer: Buffer): Promise<OcrResult>;
}

/** Injection token Nest pour le tableau de providers (DI multi-provider). */
export const OCR_PROVIDERS = Symbol('OCR_PROVIDERS');

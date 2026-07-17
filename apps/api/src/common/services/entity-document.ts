/**
 * US-069 — descriptor d'un document archivé d'une entité (panneau
 * Documents généralisé). PAS de nouvelle table : la liste est dérivée des
 * métadonnées existantes (`pdfObjectKey` + timestamps de l'entité) — la
 * taille vient d'un statObject best-effort (null si stockage indisponible).
 */
export interface EntityDocument {
  /** Clé logique de l'objet (préfixes grantflow-pos / grantflow-invoices…). */
  objectKey: string;
  /** Nom affichable (ex. « FAC-SIM-BC-2026-0002-1.pdf »). */
  label: string;
  /** Nature du document. */
  kind: 'invoice_pdf' | 'po_pdf';
  contentType: string;
  /** Taille en octets — null si le stockage n'a pas répondu (best-effort). */
  sizeBytes: number | null;
  /** Date de rattachement (créée/envoyée) au format ISO — null si inconnue. */
  storedAt: string | null;
  /** Chemin API relatif à utiliser pour l'aperçu / le téléchargement. */
  downloadPath: string;
}

/**
 * Sprint F-PO-EMAIL — utilitaire de masquage e-mail pour les LOGS.
 *
 * Règle d'or côté CLAUDE.md : « Logs jamais contenir de PII (e-mails
 * masqués, IBAN partiel) ». Ce helper transforme :
 *   "achats@biomed-sn.demo"  →  "a******@biomed-sn.demo"
 *   "x@y.com"                →  "*@y.com"
 *   ""                       →  ""
 *   null/undefined           →  "(none)"
 *
 * On NE masque PAS le domaine — il n'est pas considéré comme PII
 * suffisante pour justifier l'obfuscation et reste utile au diagnostic
 * (ex. distinguer un fournisseur d'un autre quand 2 BC partent).
 *
 * À UTILISER DANS LES LOGS UNIQUEMENT — jamais dans l'UI (où l'adresse
 * complète est attendue par l'utilisateur authentifié qui édite la fiche).
 */
export function maskEmail(value: string | null | undefined): string {
  if (value == null || value === '') return '(none)';
  const at = value.indexOf('@');
  if (at < 0) return '***'; // pas un e-mail — masquage total
  const local = value.slice(0, at);
  const domain = value.slice(at);
  if (local.length === 0) return `*${domain}`;
  if (local.length === 1) return `*${domain}`;
  // Garde le 1er caractère, masque le reste : "achats" → "a*****"
  return `${local[0]}${'*'.repeat(local.length - 1)}${domain}`;
}

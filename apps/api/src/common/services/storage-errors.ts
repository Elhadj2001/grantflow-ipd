import {
  DocumentNotFoundException,
  DocumentStoreUnavailableException,
} from '../exceptions/business.exception';

/**
 * US-069 — mapping des erreurs du SDK MinIO/S3 vers les exceptions métier.
 *
 * Avant ce helper, `getObject` laissait fuir l'erreur SDK brute → 500 non
 * qualifié côté front (l'« aperçu cassé » du retour user). Deux familles :
 *  - objet/bucket absent (NoSuchKey, NotFound, NoSuchBucket) → 404
 *    BUSINESS.DOCUMENT_NOT_FOUND (le front montre l'état vide charte) ;
 *  - tout le reste (ECONNREFUSED quand S3_* absents → fallback localhost,
 *    timeouts, credentials) → 503 BUSINESS.DOCUMENT_STORE_UNAVAILABLE.
 */
const NOT_FOUND_CODES = new Set(['NoSuchKey', 'NotFound', 'NoSuchBucket']);

export function mapStorageError(
  err: unknown,
  ctx: { entityType: string; entityId: string; objectKey?: string | null },
): DocumentNotFoundException | DocumentStoreUnavailableException {
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code: unknown }).code)
      : '';
  if (NOT_FOUND_CODES.has(code)) {
    return new DocumentNotFoundException(ctx.entityType, ctx.entityId, ctx.objectKey);
  }
  const cause = err instanceof Error ? `${code || err.name}: ${err.message}` : String(err);
  return new DocumentStoreUnavailableException(ctx.entityType, ctx.entityId, cause);
}

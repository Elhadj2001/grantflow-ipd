/**
 * Test isolé des credentials R2/S3 (debug S3Error "signature does not match"
 * observé sur l'upload PDF de BC en prod Render).
 *
 * Reproduit EXACTEMENT la construction du client de
 * `src/common/services/storage.service.ts` (mode cloud S3_ENDPOINT) puis
 * exécute un `bucketExists()` — requête signée minimale : si la signature
 * est rejetée ici, les credentials (ou l'endpoint) sont en cause, pas le
 * code applicatif.
 *
 * Usage (depuis apps/api, avec les MÊMES variables que Render) :
 *   S3_ENDPOINT=https://<acct>.r2.cloudflarestorage.com \
 *   S3_ACCESS_KEY=... S3_SECRET_KEY=... S3_REGION=auto S3_BUCKET=grantflow-pdf \
 *   npx ts-node scripts/test-r2-credentials.ts
 *
 * Diagnostic :
 *   - OK local + KO Render  → variables Render corrompues (espace/quote/retour
 *     chariot collé) — re-saisir dans le dashboard Render.
 *   - KO local aussi        → token R2 invalide ou périmé — recréer le token
 *     API R2 (dashboard Cloudflare) et mettre à jour partout.
 */
import * as Minio from 'minio';

async function main(): Promise<void> {
  const endpoint = process.env.S3_ENDPOINT;
  const accessKey = process.env.S3_ACCESS_KEY;
  const secretKey = process.env.S3_SECRET_KEY;
  const region = process.env.S3_REGION ?? 'auto';
  const bucket = process.env.S3_BUCKET ?? 'grantflow-pdf';

  if (!endpoint || !accessKey || !secretKey) {
    console.error(
      'Variables manquantes — requiert S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY ' +
        '(et optionnellement S3_REGION=auto, S3_BUCKET=grantflow-pdf).',
    );
    process.exit(2);
  }

  // Détection silencieuse de pollution des valeurs (cause n°1 du
  // "signature does not match" : espace/CR/LF collé en copiant dans Render).
  for (const [name, value] of Object.entries({ S3_ENDPOINT: endpoint, S3_ACCESS_KEY: accessKey, S3_SECRET_KEY: secretKey })) {
    if (value !== value.trim()) {
      console.error(`⚠ ${name} contient des espaces/retours en début ou fin — corriger la variable.`);
      process.exit(3);
    }
  }

  const url = new URL(endpoint);
  const client = new Minio.Client({
    endPoint: url.hostname,
    port: url.port ? parseInt(url.port, 10) : url.protocol === 'https:' ? 443 : 80,
    useSSL: url.protocol === 'https:',
    accessKey,
    secretKey,
    region,
  });

  console.log(`→ bucketExists("${bucket}") sur ${url.hostname} (region=${region})...`);
  const exists = await client.bucketExists(bucket);
  console.log(
    exists
      ? `✅ Signature acceptée — bucket "${bucket}" existe. Credentials valides.`
      : `✅ Signature acceptée — mais bucket "${bucket}" introuvable (vérifier S3_BUCKET).`,
  );
}

main().catch((e: unknown) => {
  const err = e as { code?: string; message?: string };
  console.error(`❌ ${err.code ?? 'Error'}: ${err.message ?? String(e)}`);
  if (err.code === 'SignatureDoesNotMatch') {
    console.error(
      'Signature rejetée → S3_SECRET_KEY (ou S3_ACCESS_KEY) ne correspond pas au token R2. ' +
        'Si ce test PASSE en local avec les mêmes valeurs, les variables Render sont corrompues.',
    );
  }
  process.exit(1);
});

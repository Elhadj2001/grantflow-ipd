/**
 * Test isolé des credentials R2/S3 (debug S3Error "signature does not match" /
 * "AccessDenied" observés sur l'upload PDF de BC en prod Render).
 *
 * Reproduit EXACTEMENT la construction du client de
 * `src/common/services/storage.service.ts` (mode cloud S3_ENDPOINT) puis
 * exécute un `putObject` + `removeObject` — c'est l'opération RÉELLE du code
 * (upload PDF de BC), qui ne requiert que la permission R2 **Object Write**.
 * NB : l'ancien test `bucketExists()` exigeait une permission Admin Read —
 * un token Object-Write-only y répond "AccessDenied" alors qu'il est
 * parfaitement valide pour l'usage applicatif. D'où ce test-ci.
 *
 * Usage (depuis apps/api, avec les MÊMES variables que Render) :
 *   S3_ENDPOINT=https://<acct>.r2.cloudflarestorage.com \
 *   S3_ACCESS_KEY=... S3_SECRET_KEY=... S3_REGION=auto S3_BUCKET=grantflow-pdf \
 *   npx ts-node scripts/test-r2-credentials.ts
 *
 * Diagnostic :
 *   - OK local + KO Render  → variables Render corrompues (espace/quote/retour
 *     chariot collé) — re-saisir dans le dashboard Render.
 *   - KO local aussi        → token R2 invalide, périmé ou sans Object Write
 *     sur ce bucket — recréer le token API R2 (dashboard Cloudflare).
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

  // Scan défensif des longueurs attendues d'un token API R2 (non bloquant —
  // d'autres fournisseurs S3 ont des formats différents) :
  //   Access Key ≈ 32 caractères hex ; Secret Key ≈ 64 caractères.
  if (!/^[0-9a-f]{32}$/i.test(accessKey)) {
    console.warn(
      `⚠ S3_ACCESS_KEY a un format inattendu pour R2 (${accessKey.length} chars, attendu ~32 hex) — vérifier le copier-coller.`,
    );
  }
  if (secretKey.length !== 64) {
    console.warn(
      `⚠ S3_SECRET_KEY fait ${secretKey.length} chars (attendu ~64 pour un token R2) — vérifier le copier-coller.`,
    );
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

  const stamp = Date.now();
  const key = `test-${stamp}.txt`;
  const payload = Buffer.from(`test grantflow r2 ${stamp}`);

  console.log(`→ putObject("${bucket}", "${key}", ${payload.length} octets) sur ${url.hostname} (region=${region})...`);
  await client.putObject(bucket, key, payload, payload.length);
  console.log('→ removeObject (nettoyage)...');
  await client.removeObject(bucket, key);
  console.log('✅ putObject + removeObject OK — credentials valides pour l’usage réel (Object Write).');
}

main().catch((e: unknown) => {
  const err = e as { code?: string; message?: string };
  console.error(`❌ ${err.code ?? 'Error'}: ${err.message ?? String(e)}`);
  if (err.code === 'SignatureDoesNotMatch') {
    console.error(
      'Signature rejetée → S3_SECRET_KEY (ou S3_ACCESS_KEY) ne correspond pas au token R2. ' +
        'Si ce test PASSE en local avec les mêmes valeurs, les variables Render sont corrompues.',
    );
  } else if (err.code === 'AccessDenied') {
    console.error(
      'Accès refusé sur putObject → le token n’a pas la permission Object Write sur ce bucket ' +
        '(ou le bucket S3_BUCKET est erroné). Vérifier le scope du token dans le dashboard Cloudflare R2.',
    );
  }
  process.exit(1);
});

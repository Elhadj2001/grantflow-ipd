/* eslint-disable no-console */
/**
 * Sprint F-OCR-VISION — Smoke test manuel du ClaudeVisionOcrProvider.
 *
 * Objectif : valider un appel RÉEL à l'API Anthropic avec un PDF de
 * facture (extraction structurée via tool_use) — ce que les tests Jest
 * (mock fetch) ne peuvent pas vérifier.
 *
 * USAGE :
 *   cd apps/api
 *   npx ts-node scripts/ocr-vision-smoke.ts
 *   # ou avec un PDF custom :
 *   npx ts-node scripts/ocr-vision-smoke.ts /chemin/vers/facture.pdf
 *
 * PRÉ-REQUIS :
 *   - apps/api/.env contient ANTHROPIC_API_KEY=sk-ant-... (clé valide,
 *     gitignored — NE JAMAIS la committer).
 *   - Optionnel : OCR_VISION_MODEL=claude-sonnet-4-6 (ou autre Sonnet
 *     courant). Sinon le défaut interne du provider est utilisé.
 *
 * CONFIDENTIALITÉ :
 *   - Ce script lit le .env local, exécute un appel réseau à api.anthropic.com
 *     en envoyant le PDF en base64. Le PDF utilisé doit être une donnée de
 *     test, PAS une vraie facture client.
 *   - Le script imprime UNIQUEMENT les champs extraits + confidences.
 *     Il N'IMPRIME PAS la clé API ni le rawText brut.
 *
 * À NE PAS COMMITTER dans des sprints futurs : ce script est un outil de
 * diagnostic, pas un artefact applicatif. Il peut être conservé sous
 * `scripts/` (no secret en dur) ou supprimé après usage.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { ConfigService } from '@nestjs/config';
import { ClaudeVisionOcrProvider } from '../src/invoicing/services/ocr/claude-vision-ocr.provider';

/**
 * Parse `.env` à la main — dotenv 16 semble sauter certaines lignes
 * légitimes (vraisemblablement un bug de regex sur des valeurs longues).
 * Notre parsing est volontairement simple : ligne `KEY=VALUE`, on ignore
 * les commentaires (#) et les lignes vides. Pas de support des quotes
 * ni de l'expansion — pas besoin pour notre cas.
 */
function loadEnvManually(envPath: string): void {
  let raw: string;
  try {
    raw = readFileSync(envPath, 'utf-8');
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    if (line.length === 0 || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    const value = line.slice(eq + 1);
    if (process.env[key] === undefined || process.env[key] === '') {
      process.env[key] = value;
    }
  }
}

// Charge apps/api/.env (gitignored).
loadEnvManually(resolve(__dirname, '..', '.env'));

/** Build a minimal ConfigService reading from process.env. */
function buildConfigFromEnv(): ConfigService {
  return {
    get: <T = string>(k: string): T | undefined =>
      process.env[k] as T | undefined,
  } as unknown as ConfigService;
}

/** Masque la clé API pour l'affichage (4 premiers + 4 derniers). */
function maskKey(k: string | undefined): string {
  if (!k) return '(absente)';
  if (k.length < 12) return '***';
  return `${k.slice(0, 8)}...${k.slice(-4)} (${k.length} chars)`;
}

async function main(): Promise<void> {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  GRANTFLOW IPD — Smoke test ClaudeVisionOcrProvider');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const model = process.env.OCR_VISION_MODEL ?? '(défaut provider)';
  if (!apiKey) {
    console.error('❌ ANTHROPIC_API_KEY absent dans apps/api/.env');
    console.error('   Ajoute la clé dans apps/api/.env (gitignored) puis relance.');
    process.exit(1);
  }
  console.log(`  ANTHROPIC_API_KEY : ${maskKey(apiKey)}`);
  console.log(`  OCR_VISION_MODEL  : ${model}`);

  // PDF par défaut = facture de démo du repo.
  const argPath = process.argv[2];
  const pdfPath =
    argPath != null && argPath.trim() !== ''
      ? resolve(argPath)
      : resolve(__dirname, '..', '..', '..', 'docs', 'demo', 'facture-demo-FOURN-BIOMED.pdf');

  console.log(`  PDF source        : ${pdfPath}`);

  let buffer: Buffer;
  try {
    buffer = await readFile(pdfPath);
  } catch (err) {
    console.error(`❌ Impossible de lire le PDF : ${(err as Error).message}`);
    process.exit(1);
  }
  console.log(`  PDF taille        : ${buffer.length} octets`);
  console.log('');

  // Instancie le provider.
  const provider = new ClaudeVisionOcrProvider(buildConfigFromEnv());
  console.log(`  Provider name     : ${provider.name}`);
  console.log('');
  console.log('→ Appel à api.anthropic.com/v1/messages …');
  const t0 = Date.now();

  try {
    const result = await provider.extractFromPdf(buffer);
    const elapsedMs = Date.now() - t0;

    console.log('');
    console.log(`✓ Réponse reçue en ${elapsedMs} ms`);
    console.log('');
    console.log('─── OcrResult (extrait) ──────────────────────────────────');
    console.log(`  isImageScan       : ${result.isImageScan}`);
    console.log(`  confidence        : ${result.confidence}`);
    console.log('  fields            :');
    for (const [k, v] of Object.entries(result.fields)) {
      if (k === 'lines') continue;
      const display = v instanceof Date ? v.toISOString().slice(0, 10) : v;
      console.log(`    ${k.padEnd(16)}= ${display ?? '(absent)'}`);
    }
    if (result.fields.lines && result.fields.lines.length > 0) {
      console.log(`    lines           = ${result.fields.lines.length} ligne(s)`);
      result.fields.lines.slice(0, 3).forEach((l, i) => {
        const desc =
          l.description && l.description.length > 40
            ? `${l.description.slice(0, 40)}…`
            : l.description;
        console.log(
          `      [${i + 1}] qty=${l.quantity ?? '?'} unit=${l.unitPrice ?? '?'} → ${desc ?? ''}`,
        );
      });
    }
    console.log('  fieldConfidence   :');
    for (const [k, v] of Object.entries(result.fieldConfidence)) {
      console.log(`    ${k.padEnd(16)}= ${v}`);
    }
    console.log('──────────────────────────────────────────────────────────');
    console.log('');
    console.log('✓ Smoke test OK — Vision provider est opérationnel.');
  } catch (err) {
    const elapsedMs = Date.now() - t0;
    console.error('');
    console.error(`✗ Échec après ${elapsedMs} ms`);
    const e = err as Error;
    console.error(`  type   : ${e.constructor.name}`);
    console.error(`  message: ${e.message}`);
    console.error('');
    // Diagnostic des cas typiques.
    if (/401|unauthorized|invalid.*api.*key/i.test(e.message)) {
      console.error('  ↪ DIAGNOSTIC : clé API rejetée par Anthropic.');
      console.error('    - Vérifier que ANTHROPIC_API_KEY est valide et active.');
      console.error('    - Vérifier qu\'aucun espace/CR/LF parasite n\'a été collé.');
    } else if (/404|model.*not.*found|does not.*support/i.test(e.message)) {
      console.error('  ↪ DIAGNOSTIC : modèle inexistant ou ne supporte pas le bloc `document`.');
      console.error('    - Vérifier OCR_VISION_MODEL dans .env.');
      console.error('    - Modèles vérifiés actifs au 2026-05-27 :');
      console.error('        claude-sonnet-4-6   (Sonnet courant, recommandé)');
      console.error('        claude-opus-4-7     (Opus courant)');
      console.error('        claude-haiku-4-5    (Haiku courant)');
    } else if (/413|too.*large/i.test(e.message)) {
      console.error('  ↪ DIAGNOSTIC : PDF trop gros pour l\'API.');
      console.error('    - Réduire la taille du PDF ou ajuster OCR_VISION_MAX_BYTES.');
    } else if (/429|rate.*limit/i.test(e.message)) {
      console.error('  ↪ DIAGNOSTIC : rate-limited. Réessayer dans quelques secondes.');
    } else {
      console.error('  ↪ Erreur inattendue — voir le log du provider (warn) pour le statut HTTP.');
    }
    process.exit(2);
  }
}

main().catch((err) => {
  console.error('Erreur non rattrapée :', err);
  process.exit(99);
});

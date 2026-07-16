/**
 * =====================================================================
 *  GRANTFLOW IPD — Apply all migrations + backfills (Neon prod / dev)
 * =====================================================================
 *
 * Runner idempotent des migrations DDL extraites (docs/migrations/) +
 * backfills XOF, avec table de suivi `ops.schema_migrations`.
 *
 * DÉCOUVERTE & ORDRE (règle explicite) :
 *   - Scan de docs/migrations/*.sql ; chaque fichier DOIT être préfixé
 *     `YYYY-MM-DD-` (date de création, cf. git log --follow). Un fichier
 *     non conforme = erreur explicite (pas de tri silencieux).
 *   - Tri lexicographique (= chronologique par préfixe, nom en tie-break).
 *   - EXCEPTION ORDONNANCEMENT : les migrations listées dans
 *     POST_BACKFILL_MIGRATIONS (CHECK/trigger dépendant des données
 *     backfillées) sont épinglées en Phase 3, APRÈS les backfills.
 *   - NB : ce runner cible des bases DÉJÀ initialisées (catch-up
 *     incrémental). Une base vierge s'initialise par le DDL complet
 *     (CLAUDE.md §9), jamais par cette chaîne.
 *
 * SUIVI (ops.schema_migrations) :
 *   - filename PRIMARY KEY + checksum sha256 + applied_at.
 *   - Déjà enregistrée + checksum identique → SKIP (rapporté).
 *   - Déjà enregistrée + checksum différent → WARN + ré-application
 *     (toutes les migrations sont idempotentes) + checksum mis à jour.
 *   - Premier run sur une base à jour : tout est rejoué une fois
 *     (idempotent, sans effet) puis enregistré — les runs suivants skippent.
 *
 * PHASES :
 *   1. Migrations (découvertes, hors POST_BACKFILL)
 *   2. Backfills XOF (scripts dédiés, self-skipping)
 *   3. Migrations POST_BACKFILL (CHECK chk_fx_consistency + trigger i5)
 *   4. Vérifications de schéma
 *
 * CONFIRMATION :
 *   - Cible Neon prod → confirmation interactive [y/N] par défaut.
 *   - Non-interactif : flag `--yes` OU env `MIGRATE_CONFIRM=yes` (CI).
 *
 * Usage :
 *   DATABASE_URL="postgresql://..." npx ts-node scripts/apply-all-migrations.ts [--yes]
 */

import { createHash } from 'crypto';
import { readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { Client } from 'pg';
import * as readline from 'readline';

// ---------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------

const REPO_ROOT = resolve(__dirname, '../../..');
const MIGRATIONS_DIR = join(REPO_ROOT, 'docs', 'migrations');

/** Convention de nommage obligatoire (tri chronologique fiable). */
const DATED_SQL = /^\d{4}-\d{2}-\d{2}-.+\.sql$/;

/**
 * Migrations dépendantes des BACKFILLS (CHECK + trigger sur fx_rate) —
 * épinglées en Phase 3. Noms de fichiers RÉELS (le trigger i5 a été renommé
 * `...-i5-currency-consistency-trigger.sql`).
 */
const POST_BACKFILL_MIGRATIONS = new Set([
  '2026-06-07-sprint-s3bis-chk-fx-consistency.sql',
  '2026-06-07-sprint-s3bis-i5-currency-consistency-trigger.sql',
]);

const BACKFILL_SCRIPTS = [
  'backfill-budget-line-xof.ts',
  'backfill-journal-line-fx-rate.ts',
];

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

function ts(): string {
  return new Date().toISOString().slice(11, 19);
}
function log(msg: string): void {
  console.log(`[${ts()}] ${msg}`);
}
function ok(msg: string): void {
  console.log(`[${ts()}] \x1b[32m✓\x1b[0m ${msg}`);
}
function warn(msg: string): void {
  console.log(`[${ts()}] \x1b[33m!\x1b[0m ${msg}`);
}
function err(msg: string): void {
  console.error(`[${ts()}] \x1b[31m✗\x1b[0m ${msg}`);
}

function maskDsn(dsn: string): string {
  return dsn.replace(/:\/\/([^:]+):[^@]+@/, '://$1:***@');
}

function nonInteractive(): boolean {
  return (
    process.argv.includes('--yes') ||
    (process.env.MIGRATE_CONFIRM ?? '').toLowerCase() === 'yes'
  );
}

async function confirm(question: string): Promise<boolean> {
  if (nonInteractive()) {
    warn('Confirmation sautée (--yes / MIGRATE_CONFIRM=yes).');
    return true;
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => {
    rl.question(question + ' [y/N] ', (answer) => {
      rl.close();
      res(answer.trim().toLowerCase() === 'y');
    });
  });
}

// ---------------------------------------------------------------------
// Découverte des migrations
// ---------------------------------------------------------------------

interface DiscoveredMigrations {
  phase1: string[];
  phase3: string[];
}

function discoverMigrations(): DiscoveredMigrations {
  const all = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
  const invalid = all.filter((f) => !DATED_SQL.test(f));
  if (invalid.length > 0) {
    throw new Error(
      `Fichier(s) migration sans préfixe date YYYY-MM-DD- : ${invalid.join(', ')}. ` +
        'Renommer (date git de création, cf. git log --follow) avant de relancer.',
    );
  }
  const sorted = [...all].sort();
  const missingPinned = Array.from(POST_BACKFILL_MIGRATIONS).filter((f) => !sorted.includes(f));
  if (missingPinned.length > 0) {
    throw new Error(`Migration(s) POST_BACKFILL introuvable(s) : ${missingPinned.join(', ')}`);
  }
  return {
    phase1: sorted.filter((f) => !POST_BACKFILL_MIGRATIONS.has(f)),
    phase3: sorted.filter((f) => POST_BACKFILL_MIGRATIONS.has(f)),
  };
}

// ---------------------------------------------------------------------
// Table de suivi ops.schema_migrations
// ---------------------------------------------------------------------

async function ensureTrackingTable(client: Client): Promise<void> {
  await client.query(`
    CREATE SCHEMA IF NOT EXISTS ops;
    CREATE TABLE IF NOT EXISTS ops.schema_migrations (
      filename   TEXT PRIMARY KEY,
      checksum   TEXT,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    COMMENT ON TABLE ops.schema_migrations IS
      'Suivi des migrations extraites (docs/migrations) appliquées par apply-all-migrations.ts. Le DDL complet reste la source de vérité (CLAUDE.md §9).';
  `);
}

type ApplyOutcome = 'applied' | 'skipped' | 'reapplied';

async function applyMigration(client: Client, filename: string): Promise<ApplyOutcome> {
  const fullPath = join(MIGRATIONS_DIR, filename);
  const content = readFileSync(fullPath, 'utf-8'); // introuvable → throw naturel
  const checksum = createHash('sha256').update(content).digest('hex');

  const prev = await client.query(
    'SELECT checksum FROM ops.schema_migrations WHERE filename = $1',
    [filename],
  );
  if (prev.rows.length > 0) {
    if (prev.rows[0].checksum === checksum) {
      ok(`SKIP ${filename} (déjà appliquée, checksum identique)`);
      return 'skipped';
    }
    warn(`${filename} : checksum modifié depuis la dernière application → ré-application (idempotente).`);
  }

  log(`→ Applying ${filename} (${(content.length / 1024).toFixed(1)} KB)`);
  const startedAt = Date.now();
  try {
    await client.query(content);
  } catch (e) {
    const pgErr = e as Error & { position?: string; where?: string };
    err(`Échec ${filename} : ${pgErr.message}`);
    if (pgErr.position) err(`Position SQL : ${pgErr.position}`);
    if (pgErr.where) err(`Contexte : ${pgErr.where}`);
    throw e;
  }
  await client.query(
    `INSERT INTO ops.schema_migrations (filename, checksum) VALUES ($1, $2)
     ON CONFLICT (filename) DO UPDATE SET checksum = EXCLUDED.checksum, applied_at = now()`,
    [filename, checksum],
  );
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  const outcome: ApplyOutcome = prev.rows.length > 0 ? 'reapplied' : 'applied';
  ok(`${filename} appliquée en ${elapsed}s`);
  return outcome;
}

// ---------------------------------------------------------------------
// Backfills (scripts dédiés, self-skipping)
// ---------------------------------------------------------------------

async function runBackfill(scriptName: string): Promise<void> {
  const { spawn } = await import('child_process');
  const scriptPath = join(__dirname, scriptName);
  log(`→ Backfill ${scriptName}`);
  return new Promise((res, reject) => {
    const proc = spawn('npx', ['ts-node', scriptPath], {
      env: process.env,
      stdio: 'inherit',
      shell: true,
    });
    proc.on('close', (code) => {
      if (code === 0) {
        ok(`Backfill ${scriptName} terminé`);
        res();
      } else {
        err(`Backfill ${scriptName} a échoué (exit code ${code})`);
        reject(new Error(`Backfill failed: ${scriptName}`));
      }
    });
  });
}

// ---------------------------------------------------------------------
// Vérifications post-migration
// ---------------------------------------------------------------------

async function verifySchema(client: Client): Promise<void> {
  log('→ Vérification du schéma...');
  const checks = [
    {
      name: 'Colonnes XOF sur purchase_request',
      query: `SELECT column_name FROM information_schema.columns
              WHERE table_schema='procurement' AND table_name='purchase_request'
              AND column_name='total_amount_xof'`,
      expectCount: 1,
    },
    {
      name: 'budget_line.budgeted_amount_xof',
      query: `SELECT column_name FROM information_schema.columns
              WHERE table_schema='ref' AND table_name='budget_line'
              AND column_name='budgeted_amount_xof'`,
      expectCount: 1,
    },
    {
      name: 'budget_line.category (US-055)',
      query: `SELECT column_name FROM information_schema.columns
              WHERE table_schema='ref' AND table_name='budget_line'
              AND column_name='category'`,
      expectCount: 1,
    },
    {
      name: 'purchase_request champs PPT-5/6 (US-054)',
      query: `SELECT column_name FROM information_schema.columns
              WHERE table_schema='procurement' AND table_name='purchase_request'
              AND column_name IN ('expense_nature_code','pasteur_paris_reimbursed','supplier_invoice_number')`,
      expectCount: 3,
    },
    {
      name: 'Schéma grant_office',
      query: `SELECT schema_name FROM information_schema.schemata
              WHERE schema_name='grant_office'`,
      expectCount: 1,
    },
    {
      name: '5 tables grant_office',
      query: `SELECT table_name FROM information_schema.tables
              WHERE table_schema='grant_office'`,
      expectCount: 5,
    },
    {
      name: 'CHECK chk_fx_consistency sur journal_line',
      query: `SELECT conname FROM pg_constraint WHERE conname='chk_fx_consistency'`,
      expectCount: 1,
    },
    {
      name: 'Index UNIQUE partiel note_technique active',
      query: `SELECT indexname FROM pg_indexes
              WHERE indexname='uq_note_technique_active_per_grant'`,
      expectCount: 1,
    },
  ];

  let allOk = true;
  for (const check of checks) {
    const res = await client.query(check.query);
    if (res.rows.length === check.expectCount) {
      ok(`${check.name} (${res.rows.length}/${check.expectCount})`);
    } else {
      err(`${check.name} : trouvé ${res.rows.length}, attendu ${check.expectCount}`);
      allOk = false;
    }
  }
  if (!allOk) {
    throw new Error('Vérifications de schéma échouées. Voir détail ci-dessus.');
  }
}

// ---------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('\n=== GRANTFLOW IPD — Apply all migrations + backfills ===\n');

  const dsn = process.env.DATABASE_URL;
  if (!dsn || dsn.trim() === '') {
    err('DATABASE_URL absente ou vide. Exporte-la avant de lancer le script :');
    err('  export DATABASE_URL="postgresql://..."');
    err('En CI : configurer le secret GitHub DATABASE_URL (Settings → Secrets).');
    process.exit(1);
  }

  log(`DSN cible : ${maskDsn(dsn)}`);

  const { phase1, phase3 } = discoverMigrations();
  log(`Migrations découvertes : ${phase1.length} (phase 1) + ${phase3.length} (phase 3, post-backfill)`);

  if (dsn.includes('neon.tech') || dsn.includes('aws.neon')) {
    warn('⚠️  Cible Neon prod détectée.');
    const confirmed = await confirm("Confirmer l'application des migrations sur Neon prod ?");
    if (!confirmed) {
      warn("Annulé par l'utilisateur.");
      process.exit(0);
    }
  }

  const summary: Record<ApplyOutcome, string[]> = { applied: [], skipped: [], reapplied: [] };
  const client = new Client({ connectionString: dsn });
  await client.connect();
  ok('Connecté à la base.');

  try {
    await ensureTrackingTable(client);

    log('');
    log('--- Phase 1 : Migrations (découverte triée) ---');
    for (const m of phase1) {
      summary[await applyMigration(client, m)].push(m);
    }

    log('');
    log('--- Phase 2 : Backfills XOF ---');
    await client.end();
    ok('Connexion fermée pour libérer les ressources.');
    for (const script of BACKFILL_SCRIPTS) {
      await runBackfill(script);
    }

    const client2 = new Client({ connectionString: dsn });
    await client2.connect();
    ok('Connexion ré-ouverte.');

    log('');
    log('--- Phase 3 : CHECK + triggers (post-backfill) ---');
    for (const m of phase3) {
      summary[await applyMigration(client2, m)].push(m);
    }

    log('');
    log('--- Phase 4 : Vérifications de schéma ---');
    await verifySchema(client2);
    await client2.end();

    log('');
    log('--- Résumé ---');
    ok(`Appliquées   (${summary.applied.length}) : ${summary.applied.join(', ') || '—'}`);
    if (summary.reapplied.length > 0) {
      warn(`Ré-appliquées (${summary.reapplied.length}) : ${summary.reapplied.join(', ')}`);
    }
    ok(`Skippées     (${summary.skipped.length}) : ${summary.skipped.join(', ') || '—'}`);
    log('');
    ok('✨ Toutes les migrations et backfills sont appliqués.');
  } catch (e) {
    const error = e as Error;
    err('');
    err(`Erreur : ${error.message}`);
    err('');
    err("Le script s'est arrêté avant la fin. État BD partiel.");
    err('Toutes les opérations sont idempotentes : rejouer est safe.');
    try {
      await client.end();
    } catch {
      // already closed
    }
    process.exit(1);
  }
}

main().catch((e: Error) => {
  err(`Erreur non capturée : ${e.message}`);
  process.exit(1);
});

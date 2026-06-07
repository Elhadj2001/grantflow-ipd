/**
 * Test d'intégration (smoke) US-140 — enforcement DB des invariants multidevise
 * sur gl.journal_line (CHECK chk_fx_consistency + trigger I5).
 *
 * Trois cas, chacun dans une transaction annulée (rollback) — rien n'est
 * persisté. Sortie non-zéro si un invariant n'est pas correctement enforced.
 *
 *  1. CHECK (I1/I3/I4) : ligne EUR sans fx_rate  → DOIT échouer.
 *  2. Trigger I5       : EUR + USD même entry    → DOIT échouer (à la
 *     validation des contraintes différées).
 *  3. Trigger I5 (OK)  : EUR + XOF même entry     → DOIT passer (XOF toléré).
 *
 * NB : hors `npm test` (base live requise ; infra jest d'intégration absente,
 * cf. audit F28).
 *
 * Lancement :
 *   npx ts-node -r dotenv/config apps/api/scripts/smoke-fx-consistency.ts
 */
import { PrismaService } from '../src/prisma/prisma.service';

const PERIOD = `(SELECT id FROM gl.fiscal_period WHERE code='2026-01')`;

async function setup(tx: PrismaService | { $executeRawUnsafe: (q: string) => Promise<unknown> }, entryNumber: string): Promise<void> {
  await tx.$executeRawUnsafe(
    `INSERT INTO ref.gl_account (code, label, class, is_movement)
     VALUES ('ZZ9', 'TEST US-140', '6', true) ON CONFLICT (code) DO NOTHING`,
  );
  await tx.$executeRawUnsafe(
    `INSERT INTO gl.journal_entry (entry_number, journal, entry_date, period_id, label, status)
     VALUES ('${entryNumber}', 'OD', '2026-01-15', ${PERIOD}, 'US-140 smoke', 'draft')`,
  );
}

function entryId(entryNumber: string): string {
  return `(SELECT id FROM gl.journal_entry WHERE entry_number='${entryNumber}')`;
}

async function expectFail(prisma: PrismaService, label: string, needle: string, body: (tx: { $executeRawUnsafe: (q: string) => Promise<unknown> }) => Promise<void>): Promise<void> {
  let failedWith = '';
  try {
    await prisma.$transaction(async (tx) => {
      await body(tx as unknown as { $executeRawUnsafe: (q: string) => Promise<unknown> });
      throw new Error('NO_ERROR'); // si on arrive ici, l'invariant n'a pas bloqué
    });
  } catch (err) {
    failedWith = err instanceof Error ? err.message : String(err);
  }
  if (!failedWith.includes(needle)) {
    throw new Error(`ASSERTION FAILED — ${label} : attendu un échec contenant "${needle}", obtenu "${failedWith}"`);
  }
  // eslint-disable-next-line no-console
  console.log(`✅ ${label} — rejeté comme attendu (${needle}).`);
}

async function main(): Promise<void> {
  const prisma = new PrismaService();
  await prisma.$connect();

  // CAS 1 — CHECK : EUR sans fx_rate doit échouer (le rollback est implicite
  // car l'INSERT lève).
  await expectFail(prisma, 'CAS 1 CHECK (EUR sans fx_rate)', 'chk_fx_consistency', async (tx) => {
    await setup(tx, 'T-US140-CHK');
    await tx.$executeRawUnsafe(
      `INSERT INTO gl.journal_line (entry_id, line_number, account_code, debit, credit, currency)
       VALUES (${entryId('T-US140-CHK')}, 1, 'ZZ9', 100, 0, 'EUR')`,
    );
  });

  // CAS 2 — I5 : EUR + USD doit échouer à la validation différée.
  await expectFail(prisma, 'CAS 2 I5 (EUR + USD)', 'mixes multiple foreign currencies', async (tx) => {
    await setup(tx, 'T-US140-I5BAD');
    await tx.$executeRawUnsafe(
      `INSERT INTO gl.journal_line (entry_id, line_number, account_code, debit, credit, currency, fx_rate, fx_rate_date)
       VALUES (${entryId('T-US140-I5BAD')}, 1, 'ZZ9', 100, 0, 'EUR', 655.957, '2026-01-15')`,
    );
    await tx.$executeRawUnsafe(
      `INSERT INTO gl.journal_line (entry_id, line_number, account_code, debit, credit, currency, fx_rate, fx_rate_date)
       VALUES (${entryId('T-US140-I5BAD')}, 2, 'ZZ9', 100, 0, 'USD', 600, '2026-01-15')`,
    );
    await tx.$executeRawUnsafe(`SET CONSTRAINTS ALL IMMEDIATE`);
  });

  // CAS 3 — I5 OK : EUR + XOF doit passer. On force la validation puis on
  // annule via un sentinel (aucune persistance).
  const ROLLBACK = new Error('intentional-rollback');
  let ok3 = false;
  try {
    await prisma.$transaction(async (tx) => {
      await setup(tx as unknown as PrismaService, 'T-US140-I5OK');
      await tx.$executeRawUnsafe(
        `INSERT INTO gl.journal_line (entry_id, line_number, account_code, debit, credit, currency, fx_rate, fx_rate_date)
         VALUES (${entryId('T-US140-I5OK')}, 1, 'ZZ9', 100, 0, 'EUR', 655.957, '2026-01-15')`,
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO gl.journal_line (entry_id, line_number, account_code, debit, credit, currency)
         VALUES (${entryId('T-US140-I5OK')}, 2, 'ZZ9', 0, 100, 'XOF')`,
      );
      await tx.$executeRawUnsafe(`SET CONSTRAINTS ALL IMMEDIATE`);
      ok3 = true;
      throw ROLLBACK;
    });
  } catch (err) {
    if (err !== ROLLBACK) {
      throw new Error(`ASSERTION FAILED — CAS 3 I5 (EUR + XOF) devait passer, mais : ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (!ok3) throw new Error('ASSERTION FAILED — CAS 3 non atteint');
  // eslint-disable-next-line no-console
  console.log('✅ CAS 3 I5 (EUR + XOF) — accepté comme attendu.');

  // eslint-disable-next-line no-console
  console.log('✅ US-140 smoke OK — CHECK chk_fx_consistency + trigger I5 enforced.');
  await prisma.$disconnect();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('❌ US-140 smoke FAILED:', err);
  process.exit(1);
});

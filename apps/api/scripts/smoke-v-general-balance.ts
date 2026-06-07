/**
 * Test d'intégration (smoke) US-021 — gl.v_general_balance expose XOF.
 *
 * Vérifie de bout en bout, contre la vraie base PostgreSQL (vue + agrégats),
 * que les colonnes XOF de gl.v_general_balance sont correctes :
 *  - total_debit_xof / balance_xof = somme des debit (déjà en XOF, US-020),
 *  - transaction_currencies = ventilation des devises ÉTRANGÈRES (XOF exclu),
 *  - line_count = nombre de lignes.
 *
 * Scénario : compte mouvement temporaire « ZZ1 » + 1 écriture (draft) avec
 * 2 lignes débit — une EUR (65 595 700 XOF / 100 000 EUR brut) et une XOF
 * (50 000). Tout est exécuté dans une transaction VOLONTAIREMENT annulée
 * (rollback) : aucune donnée n'est persistée.
 *
 * NB : test hors `npm test` (nécessite une base live ; l'infra jest
 * d'intégration — jest-int.config.js — reste à créer, cf. audit F28).
 *
 * Lancement :
 *   npx ts-node -r dotenv/config apps/api/scripts/smoke-v-general-balance.ts
 *   (depuis apps/api : npx ts-node -r dotenv/config scripts/smoke-v-general-balance.ts)
 */
import { Logger } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';

interface BalanceRow {
  code: string;
  total_debit_xof: string;
  balance_xof: string;
  transaction_currencies: string[] | null;
  line_count: number;
}

function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(`ASSERTION FAILED — ${message}`);
}

async function main(): Promise<void> {
  const logger = new Logger('smoke-v-general-balance');
  const prisma = new PrismaService();
  await prisma.$connect();

  const ROLLBACK = new Error('intentional-rollback');
  let rows: BalanceRow[] = [];

  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO ref.gl_account (code, label, class, is_movement)
         VALUES ('ZZ1', 'TEST US-021 v_general_balance', '6', true)`,
      );
      await tx.$executeRawUnsafe(
        `WITH e AS (
           INSERT INTO gl.journal_entry (entry_number, journal, entry_date, period_id, label, status)
           SELECT 'TEST-US021-VGB', 'OD', '2026-01-15', fp.id, 'US-021 view smoke', 'draft'
           FROM gl.fiscal_period fp WHERE fp.code = '2026-01'
           RETURNING id
         )
         INSERT INTO gl.journal_line (entry_id, line_number, account_code, debit, credit, currency, debit_currency)
         SELECT e.id, 1, 'ZZ1', 65595700, 0, 'EUR', 100000 FROM e
         UNION ALL
         SELECT e.id, 2, 'ZZ1', 50000, 0, 'XOF', NULL FROM e`,
      );
      rows = await tx.$queryRawUnsafe<BalanceRow[]>(
        `SELECT code,
                total_debit_xof::text AS total_debit_xof,
                balance_xof::text     AS balance_xof,
                transaction_currencies,
                line_count::int        AS line_count
         FROM gl.v_general_balance WHERE code = 'ZZ1'`,
      );
      // Annulation systématique : le smoke ne persiste rien.
      throw ROLLBACK;
    });
  } catch (err) {
    if (err !== ROLLBACK) throw err;
  }

  assert(rows.length === 1, `attendu 1 ligne pour ZZ1, reçu ${rows.length}`);
  const r = rows[0];
  assert(Number(r.total_debit_xof) === 65_645_700, `total_debit_xof = ${r.total_debit_xof} (attendu 65645700)`);
  assert(Number(r.balance_xof) === 65_645_700, `balance_xof = ${r.balance_xof} (attendu 65645700)`);
  assert(Number(r.line_count) === 2, `line_count = ${r.line_count} (attendu 2)`);
  const currencies = r.transaction_currencies ?? [];
  assert(currencies.includes('EUR'), `transaction_currencies doit contenir EUR (reçu ${JSON.stringify(currencies)})`);
  assert(!currencies.includes('XOF'), `transaction_currencies ne doit PAS contenir XOF (base) (reçu ${JSON.stringify(currencies)})`);

  logger.log({ event: 'smoke_ok', ...r });
  // eslint-disable-next-line no-console
  console.log('✅ US-021 smoke OK — gl.v_general_balance expose correctement XOF + devises.');
  await prisma.$disconnect();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('❌ US-021 smoke FAILED:', err);
  process.exit(1);
});

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
  total_credit_xof: string;
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
      // Comptes mouvement temporaires (ZZ1 = compte testé, ZZ2 = contrepartie
      // pour équilibrer l'écriture posted).
      await tx.$executeRawUnsafe(
        `INSERT INTO ref.gl_account (code, label, class, is_movement) VALUES
           ('ZZ1', 'TEST v_general_balance', '6', true),
           ('ZZ2', 'TEST contrepartie', '6', true)`,
      );

      // Écriture E1 POSTED et équilibrée (insérée en draft, lignes posées,
      // puis promue posted — le trigger d'équilibre porte sur journal_line,
      // pas sur l'update de l'entry ; les lignes s'équilibrent : débit
      // 65 645 700 = crédit 20 000 + 65 625 700).
      await tx.$executeRawUnsafe(
        `INSERT INTO gl.journal_entry (entry_number, journal, entry_date, period_id, label, status)
         SELECT 'TEST-US139-E1', 'OD', '2026-01-15', fp.id, 'US-139 posted', 'draft'
         FROM gl.fiscal_period fp WHERE fp.code = '2026-01'`,
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO gl.journal_line (entry_id, line_number, account_code, debit, credit, currency, debit_tx_amount)
         SELECT id, 1, 'ZZ1', 65595700, 0, 'EUR', 100000 FROM gl.journal_entry WHERE entry_number='TEST-US139-E1'
         UNION ALL SELECT id, 2, 'ZZ1', 50000, 0, 'XOF', NULL FROM gl.journal_entry WHERE entry_number='TEST-US139-E1'
         UNION ALL SELECT id, 3, 'ZZ1', 0, 20000, 'XOF', NULL FROM gl.journal_entry WHERE entry_number='TEST-US139-E1'
         UNION ALL SELECT id, 4, 'ZZ2', 0, 65625700, 'XOF', NULL FROM gl.journal_entry WHERE entry_number='TEST-US139-E1'`,
      );
      await tx.$executeRawUnsafe(
        `UPDATE gl.journal_entry SET status='posted', posted_at=now() WHERE entry_number='TEST-US139-E1'`,
      );

      // Écriture E2 DRAFT sur ZZ1 — NE DOIT PAS remonter dans la balance (US-139).
      await tx.$executeRawUnsafe(
        `INSERT INTO gl.journal_entry (entry_number, journal, entry_date, period_id, label, status)
         SELECT 'TEST-US139-E2', 'OD', '2026-01-15', fp.id, 'US-139 draft (à exclure)', 'draft'
         FROM gl.fiscal_period fp WHERE fp.code = '2026-01'`,
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO gl.journal_line (entry_id, line_number, account_code, debit, credit, currency, debit_tx_amount)
         SELECT id, 1, 'ZZ1', 999999, 0, 'XOF', NULL FROM gl.journal_entry WHERE entry_number='TEST-US139-E2'`,
      );
      rows = await tx.$queryRawUnsafe<BalanceRow[]>(
        `SELECT code,
                total_debit_xof::text  AS total_debit_xof,
                total_credit_xof::text AS total_credit_xof,
                balance_xof::text      AS balance_xof,
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
  // US-139 : seules les 3 lignes POSTED comptent ; la ligne draft de 999 999
  // est EXCLUE. Sans le correctif, total_debit_xof vaudrait 66 645 699 et
  // line_count vaudrait 4.
  assert(Number(r.total_debit_xof) === 65_645_700, `total_debit_xof = ${r.total_debit_xof} (attendu 65645700, draft exclu)`);
  assert(Number(r.total_credit_xof) === 20_000, `total_credit_xof = ${r.total_credit_xof} (attendu 20000)`);
  // US-022 Phase 5 : cohérence arithmétique de la vue.
  assert(
    Number(r.balance_xof) === Number(r.total_debit_xof) - Number(r.total_credit_xof),
    `balance_xof (${r.balance_xof}) != total_debit_xof - total_credit_xof`,
  );
  assert(Number(r.balance_xof) === 65_625_700, `balance_xof = ${r.balance_xof} (attendu 65625700)`);
  assert(Number(r.line_count) === 3, `line_count = ${r.line_count} (attendu 3 posted, pas 4)`);
  const currencies = r.transaction_currencies ?? [];
  assert(currencies.includes('EUR'), `transaction_currencies doit contenir EUR (reçu ${JSON.stringify(currencies)})`);
  assert(!currencies.includes('XOF'), `transaction_currencies ne doit PAS contenir XOF (base) (reçu ${JSON.stringify(currencies)})`);

  logger.log({ event: 'smoke_ok', ...r });
  // eslint-disable-next-line no-console
  console.log('✅ US-139 smoke OK — v_general_balance : draft exclu, soldes XOF posted-only.');
  await prisma.$disconnect();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('❌ US-021 smoke FAILED:', err);
  process.exit(1);
});

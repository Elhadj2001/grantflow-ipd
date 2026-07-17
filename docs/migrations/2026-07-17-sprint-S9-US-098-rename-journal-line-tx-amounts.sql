-- =========================================================================
-- Migration Sprint S9 / US-098 — renommage gl.journal_line
--   debit_currency  → debit_tx_amount
--   credit_currency → credit_tx_amount
-- =========================================================================
-- Traçabilité : extrait STRICT de la section additive « Sprint S9 / US-098 »
-- de docs/grantflow_ddl_postgresql.sql (source de vérité). À appliquer sur
-- les bases EXISTANTES (Neon prod, dev local) sans rejouer tout le DDL.
--
-- Motif (F-S8-25, ADR-005) : ces colonnes sont des MONTANTS bruts en devise
-- transactionnelle (NUMERIC 18,2), pas des codes devise — le nom a causé le
-- bug d'affichage « montant XOF étiqueté USD » corrigé au hotfix 7943844.
--
-- Sécurité : RENAME COLUMN est un changement de catalogue pur — aucune
-- réécriture de données, triggers gl.check_entry_balance /
-- gl.check_period_open / audit.compute_hash_chain intacts, CHECK et index
-- intacts, aucune vue ne référence ces colonnes. Idempotent (no-op si déjà
-- renommé). Revue contrôle de gestion requise avant application (CLAUDE.md
-- §9 — table du schéma gl).
--
-- Post-migration côté code : npx prisma db pull && npm run prisma:generate
-- (le client expose debitTxAmount/creditTxAmount — code adapté au même
-- commit).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'gl' AND table_name = 'journal_line'
      AND column_name = 'debit_currency'
  ) THEN
    ALTER TABLE gl.journal_line RENAME COLUMN debit_currency TO debit_tx_amount;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'gl' AND table_name = 'journal_line'
      AND column_name = 'credit_currency'
  ) THEN
    ALTER TABLE gl.journal_line RENAME COLUMN credit_currency TO credit_tx_amount;
  END IF;
END $$;

COMMENT ON COLUMN gl.journal_line.debit_tx_amount IS
  'ADR-005 — MONTANT brut au débit dans la devise transactionnelle (currency). NULL/0 si currency=XOF (debit porte déjà le XOF). Ex debit_currency (renommée US-098 : le nom laissait croire à un code devise — cause du bug F-S8-25).';
COMMENT ON COLUMN gl.journal_line.credit_tx_amount IS
  'ADR-005 — MONTANT brut au crédit dans la devise transactionnelle (currency). NULL/0 si currency=XOF. Ex credit_currency (renommée US-098).';

-- -------------------------------------------------------------------------
-- Vérification post-migration
-- -------------------------------------------------------------------------
-- Attendu : 2 lignes (debit_tx_amount, credit_tx_amount), 0 ancienne colonne.
SELECT column_name, data_type, numeric_precision, numeric_scale
FROM information_schema.columns
WHERE table_schema = 'gl' AND table_name = 'journal_line'
  AND column_name IN ('debit_tx_amount', 'credit_tx_amount',
                      'debit_currency', 'credit_currency')
ORDER BY column_name;

-- Triggers toujours présents (attendu : check_entry_balance + period_open) :
SELECT tgname FROM pg_trigger
WHERE tgrelid = 'gl.journal_line'::regclass AND NOT tgisinternal;

-- =====================================================================
--  Migration GRANTFLOW IPD — Sprint S3bis / US-140 (2/2)
--  Date : 2026-06-07
--  Auteur : El Hadj Amadou NIANG
--  Description : Trigger contrainte I5 — un journal_entry ne peut pas mixer
--                PLUSIEURS devises étrangères (XOF toléré en ventilation).
--                Cas B (XOF-tolérant). CONSTRAINT TRIGGER DEFERRABLE INITIALLY
--                DEFERRED → validation en fin de transaction.
--  Source : docs/grantflow_ddl_postgresql.sql section
--           « Sprint S3bis / US-140 — I5 ».
--  Idempotent : oui (CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS).
--  Application :
--    psql ... -f docs/migrations/2026-06-07-sprint-s3bis-i5-currency-consistency-trigger.sql
-- =====================================================================

CREATE OR REPLACE FUNCTION gl.check_journal_entry_currency_consistency()
RETURNS TRIGGER AS $$
DECLARE
  foreign_currency_count INT;
BEGIN
  SELECT COUNT(DISTINCT currency) INTO foreign_currency_count
  FROM gl.journal_line
  WHERE entry_id = NEW.entry_id
    AND currency <> 'XOF';
  IF foreign_currency_count > 1 THEN
    RAISE EXCEPTION 'Journal entry % mixes multiple foreign currencies (I5 violation)', NEW.entry_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_je_currency_consistency ON gl.journal_line;
CREATE CONSTRAINT TRIGGER trg_check_je_currency_consistency
  AFTER INSERT OR UPDATE OF currency, entry_id
  ON gl.journal_line
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION gl.check_journal_entry_currency_consistency();

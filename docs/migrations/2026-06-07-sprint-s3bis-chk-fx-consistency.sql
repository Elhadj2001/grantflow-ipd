-- =====================================================================
--  Migration GRANTFLOW IPD — Sprint S3bis / US-140 (1/2)
--  Date : 2026-06-07
--  Auteur : El Hadj Amadou NIANG
--  Description : CHECK chk_fx_consistency sur gl.journal_line — toute ligne
--                en devise étrangère doit porter fx_rate (> 0) + fx_rate_date
--                (invariants I1/I3/I4). XOF natif exempté.
--  Source : docs/grantflow_ddl_postgresql.sql section
--           « Sprint S3bis / US-140 — chk_fx_consistency ».
--  Idempotent : oui (DO block — ADD CONSTRAINT n'a pas d'IF NOT EXISTS).
--  PRÉ-REQUIS IMPÉRATIF : exécuter d'ABORD le backfill, sinon l'ADD échoue
--    sur les lignes étrangères legacy au fx_rate NULL :
--      npx ts-node -r dotenv/config apps/api/scripts/backfill-journal-line-fx-rate.ts
--  Application :
--    psql ... -f docs/migrations/2026-06-07-sprint-s3bis-chk-fx-consistency.sql
-- =====================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_fx_consistency'
      AND conrelid = 'gl.journal_line'::regclass
  ) THEN
    ALTER TABLE gl.journal_line
      ADD CONSTRAINT chk_fx_consistency
      CHECK (
        currency = 'XOF'
        OR (fx_rate IS NOT NULL AND fx_rate > 0 AND fx_rate_date IS NOT NULL)
      );
  END IF;
END $$;

-- Vérification : la contrainte doit exister.
-- SELECT conname FROM pg_constraint
--   WHERE conname = 'chk_fx_consistency' AND conrelid = 'gl.journal_line'::regclass;

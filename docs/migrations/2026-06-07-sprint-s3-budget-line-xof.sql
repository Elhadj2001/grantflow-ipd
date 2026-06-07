-- =====================================================================
--  Migration GRANTFLOW IPD — Sprint S3 / US-024
--  Date : 2026-06-07
--  Auteur : El Hadj Amadou NIANG
--  Description : Matérialisation multidevise de ref.budget_line —
--                colonnes budgeted_amount_xof / fx_rate / fx_rate_date /
--                currency. Fige le taux de change au paramétrage de la
--                ligne budgétaire (référence comptable stable, ADR-005,
--                pattern SAP PSM / Oracle Grants).
--  Source : extrait de docs/grantflow_ddl_postgresql.sql section
--           « Sprint S3 / US-024 — budget_line multicurrency materialization ».
--  Idempotent : oui (ALTER TABLE ... ADD COLUMN IF NOT EXISTS).
--  Application :
--    psql -h <host> -U <user> -d <db> -f docs/migrations/2026-06-07-sprint-s3-budget-line-xof.sql
--  (dev local conteneurisé :
--    docker exec -i grantflow-postgres psql -U grantflow -d grantflow_dev \
--      -f docs/migrations/2026-06-07-sprint-s3-budget-line-xof.sql)
-- =====================================================================

ALTER TABLE ref.budget_line ADD COLUMN IF NOT EXISTS budgeted_amount_xof BIGINT;
ALTER TABLE ref.budget_line ADD COLUMN IF NOT EXISTS fx_rate NUMERIC(14,6);
ALTER TABLE ref.budget_line ADD COLUMN IF NOT EXISTS fx_rate_date DATE;
ALTER TABLE ref.budget_line ADD COLUMN IF NOT EXISTS currency VARCHAR(3);

COMMENT ON COLUMN ref.budget_line.budgeted_amount_xof IS
  'Équivalent XOF du montant budgété au taux figé au paramétrage. Source
   de vérité pour les contrôles internes XOF (cf. ADR-005, US-024).';
COMMENT ON COLUMN ref.budget_line.fx_rate IS
  'Taux appliqué au paramétrage. 655.957 pour EUR (parité BCEAO).';
COMMENT ON COLUMN ref.budget_line.fx_rate_date IS
  'Date du taux appliqué (pour audit).';
COMMENT ON COLUMN ref.budget_line.currency IS
  'Devise du budget. NULL = devise du grant parent (rétrocompat).
   Source de vérité dès Sprint S4 (Note Technique).';

-- =====================================================================
--  Vérification post-migration (doit retourner 4 lignes)
-- =====================================================================
-- SELECT column_name FROM information_schema.columns
--   WHERE table_schema='ref' AND table_name='budget_line'
--     AND column_name IN ('budgeted_amount_xof', 'fx_rate', 'fx_rate_date', 'currency');

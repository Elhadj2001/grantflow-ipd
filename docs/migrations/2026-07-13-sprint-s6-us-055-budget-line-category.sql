-- =====================================================================
--  Migration GRANTFLOW IPD — Sprint S6 / US-055
--  Date : 2026-07-13
--  Auteur : El Hadj Amadou NIANG
--  Description : ref.budget_line.category — catégorie comptable de la
--                ligne budgétaire (même domaine que
--                grant_office.expense_nature.category). Support de
--                LineNatureCoherentRule / PPT-4 (ADR-007) : lève la dette
--                US-049 (proxy nature) une fois peuplée (US-056 branchera
--                l'EligibilityContextBuilder dessus). Rétrocompatible :
--                NULLABLE + CHECK autorisant NULL. Aucune FK.
--  Réf : ADR-007 (Eligibility Engine), PPT IPD slide 7 (PPT-4), US-055.
--  Source : docs/grantflow_ddl_postgresql.sql section
--           « Sprint S6 / US-055 — budget_line.category ».
--  Idempotent : oui (ADD COLUMN IF NOT EXISTS ; CHECK guardée par
--               pg_constraint ; COMMENT rejouable).
--  Application :
--    psql ... -f docs/migrations/2026-07-13-sprint-s6-us-055-budget-line-category.sql
-- =====================================================================

ALTER TABLE ref.budget_line
  ADD COLUMN IF NOT EXISTS category VARCHAR(32);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_budget_line_category'
  ) THEN
    ALTER TABLE ref.budget_line
      ADD CONSTRAINT chk_budget_line_category
      CHECK (category IS NULL OR category IN
        ('functioning', 'equipment', 'personnel', 'missions',
         'subcontracting', 'overhead', 'other'));
  END IF;
END $$;

COMMENT ON COLUMN ref.budget_line.category IS
  'Catégorie comptable de la ligne budgétaire (même domaine que grant_office.expense_nature.category). Support de LineNatureCoherentRule / PPT-4 (ADR-007). NULL = non catégorisée (règle permissive).';

-- =====================================================================
--  Vérification post-migration
-- =====================================================================
-- SELECT column_name, data_type, is_nullable FROM information_schema.columns
-- WHERE table_schema='ref' AND table_name='budget_line' AND column_name='category';
-- Attendu : 1 ligne, character varying, YES.
--
-- SELECT conname FROM pg_constraint WHERE conname='chk_budget_line_category';
-- Attendu : 1 ligne.

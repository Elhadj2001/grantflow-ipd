-- =====================================================================
--  Migration GRANTFLOW IPD — Sprint S6 / US-054
--  Date : 2026-06-10
--  Auteur : El Hadj Amadou NIANG
--  Description : purchase_request — matérialisation des champs des
--                invariants PPT IPD slide 7 restés dormants après
--                US-049/US-050 :
--                  expense_nature_code      (active la gate submit US-049)
--                  pasteur_paris_reimbursed (PPT-5, US-045)
--                  supplier_invoice_number  (PPT-6, US-046)
--                + 2 index partiels. Rétrocompatible (NULLABLE/DEFAULT),
--                PAS de FK stricte sur expense_nature_code : lien logique
--                validé applicativement par l'EligibilityEngine.
--  Réf : ADR-007 (Eligibility Engine), PPT IPD slide 7, US-054.
--  Source : docs/grantflow_ddl_postgresql.sql section
--           « Sprint S6 / US-054 — purchase_request champs matérialisés ».
--  Idempotent : oui (ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS,
--               COMMENT ON rejouable).
--  Application :
--    psql ... -f docs/migrations/2026-06-10-sprint-s6-us-054-pr-materialize-fields.sql
-- =====================================================================

ALTER TABLE procurement.purchase_request
  ADD COLUMN IF NOT EXISTS expense_nature_code VARCHAR(64);
ALTER TABLE procurement.purchase_request
  ADD COLUMN IF NOT EXISTS pasteur_paris_reimbursed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE procurement.purchase_request
  ADD COLUMN IF NOT EXISTS supplier_invoice_number VARCHAR(128);

COMMENT ON COLUMN procurement.purchase_request.expense_nature_code IS
  'Code de la nature de dépense (référence logique grant_office.expense_nature.code). NULL = nature non spécifiée (compat héritage).';
COMMENT ON COLUMN procurement.purchase_request.pasteur_paris_reimbursed IS
  'TRUE si la dépense est déjà remboursée par Institut Pasteur Paris (PPT slide 7 — exclusion). EligibilityRule NotPasteurParisReimbursedRule (US-045).';
COMMENT ON COLUMN procurement.purchase_request.supplier_invoice_number IS
  'Numéro de facture fournisseur associé (pour détection PPT-6 cross-project duplicate, US-046).';

CREATE INDEX IF NOT EXISTS idx_pr_supplier_invoice_number
  ON procurement.purchase_request(supplier_invoice_number)
  WHERE supplier_invoice_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pr_pasteur_paris_reimbursed
  ON procurement.purchase_request(pasteur_paris_reimbursed)
  WHERE pasteur_paris_reimbursed = TRUE;

-- =====================================================================
--  Vérification post-migration
-- =====================================================================
-- SELECT column_name FROM information_schema.columns
-- WHERE table_schema='procurement' AND table_name='purchase_request'
--   AND column_name IN ('expense_nature_code','pasteur_paris_reimbursed','supplier_invoice_number');
-- Attendu : 3 lignes.
--
-- SELECT indexname FROM pg_indexes
-- WHERE schemaname='procurement' AND tablename='purchase_request'
--   AND indexname IN ('idx_pr_supplier_invoice_number','idx_pr_pasteur_paris_reimbursed');
-- Attendu : 2 lignes.

-- =====================================================================
--  Migration GRANTFLOW IPD — G1 / F3 (audit) — Séparation des tâches
--  Date : 2026-06-22
--  Auteur : El Hadj Amadou NIANG
--  Description : ajoute ref.grant_agreement.single_actor_authorized
--                (dérogation SoD conventionnelle, ADR-009). Quand TRUE, le
--                même acteur peut saisir ET valider les opérations de la
--                convention (DA, paiement, écriture), avec trace audit.
--                Rétrocompatible : NOT NULL DEFAULT FALSE (SoD stricte par
--                défaut). Aucune FK / contrainte nouvelle.
--  Réf : ADR-009 (SoD), audit finding F3, docs/grantflow_ddl_postgresql.sql
--        section « G1 / F3 — Séparation des tâches : dérogation conventionnelle ».
--  Idempotent : oui (ADD COLUMN IF NOT EXISTS ; COMMENT ON rejouable).
--  Application :
--    psql ... -f docs/migrations/2026-06-22-sprint-g1-single-actor-authorized.sql
-- =====================================================================

ALTER TABLE ref.grant_agreement
  ADD COLUMN IF NOT EXISTS single_actor_authorized BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN ref.grant_agreement.single_actor_authorized IS
  'Dérogation SoD conventionnelle (ADR-009) : si TRUE, le même acteur peut saisir ET valider les opérations de cette convention (DA, paiement, écriture), avec trace audit. DEFAULT FALSE = séparation des tâches stricte.';

-- =====================================================================
--  Vérification post-migration
-- =====================================================================
-- SELECT column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_schema='ref' AND table_name='grant_agreement'
--   AND column_name='single_actor_authorized';
-- Attendu : 1 ligne, boolean, NO, false.

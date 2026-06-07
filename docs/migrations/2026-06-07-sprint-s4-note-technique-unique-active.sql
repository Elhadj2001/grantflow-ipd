-- =====================================================================
--  Migration GRANTFLOW IPD — Sprint S4 / US-031
--  Date : 2026-06-07
--  Auteur : El Hadj Amadou NIANG
--  Description : UNIQUE PARTIEL garantissant au plus UNE Note Technique
--                active par convention (ADR-006). Colonne réelle grant_id.
--  Source : docs/grantflow_ddl_postgresql.sql section
--           « Sprint S4 / US-031 — note_technique active unicity ».
--  Idempotent : oui (CREATE UNIQUE INDEX IF NOT EXISTS).
--  Application :
--    psql ... -f docs/migrations/2026-06-07-sprint-s4-note-technique-unique-active.sql
-- =====================================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_note_technique_active_per_grant
  ON grant_office.note_technique(grant_id)
  WHERE status = 'active';

COMMENT ON INDEX grant_office.uq_note_technique_active_per_grant IS
  'Garantit qu''au plus une Note Technique est en status = ''active'' par
   convention à un instant donné. Les autres status (draft, pending_daf,
   validated_daf, superseded) ne sont pas concernés (cf. ADR-006).';

-- =====================================================================
--  Vérification post-migration
-- =====================================================================
-- SELECT indexname FROM pg_indexes
--   WHERE schemaname='grant_office' AND indexname='uq_note_technique_active_per_grant';

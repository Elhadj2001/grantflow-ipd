-- =====================================================================
--  Migration GRANTFLOW IPD — Sprint S4 / US-030
--  Date : 2026-06-07
--  Auteur : El Hadj Amadou NIANG
--  Description : Schéma grant_office (Phase 5A) — 5 tables fondatrices :
--                expense_nature, overhead_rule, note_technique,
--                note_technique_budget_line, eligibility_rule.
--                Tables entièrement nouvelles → aucun impact sur les
--                triggers/CHECK existants.
--  Réf : ADR-006 (Note Technique), ADR-007 (Eligibility Engine), ADR-009
--        (SoD : note_technique.single_actor_authorized).
--  Source : docs/grantflow_ddl_postgresql.sql section
--           « Sprint S4 / US-030 — Grant Office schema ».
--  Idempotent : oui (CREATE SCHEMA/TABLE/INDEX ... IF NOT EXISTS).
--  Note : FK vers ref.grant_agreement (nom réel de la table « grant »).
--  Application :
--    psql ... -f docs/migrations/2026-06-07-sprint-s4-grant-office-schema.sql
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS grant_office;
COMMENT ON SCHEMA grant_office IS
  'Bounded context Grant Office IPD : Note Technique, eligibility rules,
   overhead rules, expense natures. Pose les fondations de l''eligibility
   engine (cf. ADR-006 et ADR-007).';

CREATE TABLE IF NOT EXISTS grant_office.expense_nature (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  code          VARCHAR(64)  NOT NULL UNIQUE,
  label         VARCHAR(255) NOT NULL,
  category      VARCHAR(32)  NOT NULL CHECK (category IN
                  ('functioning', 'equipment', 'personnel', 'missions',
                   'subcontracting', 'overhead', 'other')),
  default_account_class CHAR(1) CHECK (default_account_class IN ('1','2','3','4','5','6','7','8','9')),
  description   TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);
COMMENT ON TABLE grant_office.expense_nature IS
  'Catalogue typologique des natures de dépenses. Référentiel global
   partagé par toutes les conventions (cf. ADR-007).';

CREATE TABLE IF NOT EXISTS grant_office.overhead_rule (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(128) NOT NULL UNIQUE,
  default_rate  NUMERIC(5,4) NOT NULL CHECK (default_rate >= 0 AND default_rate <= 1),
  applies_to_subcontracting BOOLEAN NOT NULL DEFAULT TRUE,
  applies_to_equipment     BOOLEAN NOT NULL DEFAULT TRUE,
  applies_to_personnel     BOOLEAN NOT NULL DEFAULT TRUE,
  applies_to_missions      BOOLEAN NOT NULL DEFAULT TRUE,
  applies_to_consumables   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);
COMMENT ON TABLE grant_office.overhead_rule IS
  'Règles d''overhead différenciées par catégorie de dépense.
   Référencée par note_technique.overhead_rule_id (cf. ADR-006).
   Exemple : USAID-standard 15% sans subcontracting, Wellcome-zero 0%.';

CREATE TABLE IF NOT EXISTS grant_office.note_technique (
  id                            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id                      UUID         NOT NULL REFERENCES ref.grant_agreement(id) ON DELETE RESTRICT,
  version                       INT          NOT NULL DEFAULT 1,
  status                        VARCHAR(32)  NOT NULL DEFAULT 'draft'
                                CHECK (status IN ('draft', 'pending_daf', 'validated_daf', 'active', 'superseded')),
  drafted_by_user_id            UUID         REFERENCES auth.app_user(id),
  drafted_at                    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  submitted_to_daf_at           TIMESTAMPTZ,
  validated_by_daf_user_id      UUID         REFERENCES auth.app_user(id),
  validated_at                  TIMESTAMPTZ,
  activated_at                  TIMESTAMPTZ,
  budget_code                   VARCHAR(64)  NOT NULL,
  reporting_intermediate_dates  DATE[]       NOT NULL DEFAULT '{}',
  reporting_final_date          DATE         NOT NULL,
  own_funds_contribution_xof    BIGINT       NOT NULL DEFAULT 0,
  own_funds_contribution_currency VARCHAR(3),
  overhead_rule_id              UUID         REFERENCES grant_office.overhead_rule(id),
  single_actor_authorized       BOOLEAN      NOT NULL DEFAULT FALSE,
  single_actor_justification    TEXT,
  supersedes_id                 UUID         REFERENCES grant_office.note_technique(id),
  notes                         TEXT,
  created_at                    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at                    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  deleted_at                    TIMESTAMPTZ,
  UNIQUE (grant_id, version),
  CHECK (
    (status = 'draft')
    OR (status = 'pending_daf' AND submitted_to_daf_at IS NOT NULL)
    OR (status IN ('validated_daf', 'active', 'superseded')
        AND validated_by_daf_user_id IS NOT NULL
        AND validated_at IS NOT NULL)
  )
);
COMMENT ON TABLE grant_office.note_technique IS
  'Note Technique : document GO traduisant une convention bailleur en
   infrastructure budgétaire activée. Workflow draft → pending_daf →
   validated_daf → active → superseded (cf. ADR-006).';
COMMENT ON COLUMN grant_office.note_technique.single_actor_authorized IS
  'Dérogation explicite à la séparation des tâches par identité (cf. ADR-009).
   Si TRUE, autorise un seul utilisateur à porter plusieurs rôles sur les
   opérations de cette convention. Nécessite single_actor_justification.';

CREATE TABLE IF NOT EXISTS grant_office.note_technique_budget_line (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_technique_id   UUID NOT NULL REFERENCES grant_office.note_technique(id) ON DELETE CASCADE,
  budget_line_id      UUID NOT NULL REFERENCES ref.budget_line(id) ON DELETE RESTRICT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (note_technique_id, budget_line_id)
);
COMMENT ON TABLE grant_office.note_technique_budget_line IS
  'Association M:N entre Note Technique et budget_line. Une budget_line
   est associée à la Note Technique active de sa convention au moment
   du paramétrage.';

CREATE TABLE IF NOT EXISTS grant_office.eligibility_rule (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id           UUID NOT NULL REFERENCES ref.grant_agreement(id) ON DELETE CASCADE,
  expense_nature_id  UUID NOT NULL REFERENCES grant_office.expense_nature(id) ON DELETE RESTRICT,
  max_per_request_xof BIGINT,
  max_per_year_xof    BIGINT,
  excluded           BOOLEAN NOT NULL DEFAULT FALSE,
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (grant_id, expense_nature_id),
  CHECK (max_per_request_xof IS NULL OR max_per_request_xof > 0),
  CHECK (max_per_year_xof IS NULL OR max_per_year_xof > 0)
);
COMMENT ON TABLE grant_office.eligibility_rule IS
  'Règle d''éligibilité par (grant, nature de dépense). Source de vérité
   pour l''EligibilityEngine (cf. ADR-007). max_per_request_xof et
   max_per_year_xof en XOF (devise comptable SYSCEBNL).';

CREATE INDEX IF NOT EXISTS idx_note_technique_grant
  ON grant_office.note_technique(grant_id);
CREATE INDEX IF NOT EXISTS idx_note_technique_status
  ON grant_office.note_technique(status) WHERE status IN ('pending_daf', 'active');
CREATE INDEX IF NOT EXISTS idx_eligibility_rule_grant
  ON grant_office.eligibility_rule(grant_id);
CREATE INDEX IF NOT EXISTS idx_expense_nature_category
  ON grant_office.expense_nature(category) WHERE deleted_at IS NULL;

-- =====================================================================
--  Vérification post-migration (cible : 5 lignes)
-- =====================================================================
-- SELECT table_name FROM information_schema.tables WHERE table_schema='grant_office' ORDER BY table_name;
--   → eligibility_rule, expense_nature, note_technique,
--     note_technique_budget_line, overhead_rule

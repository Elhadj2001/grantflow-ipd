-- =====================================================================
--  Migration GRANTFLOW IPD — Sprint S3bis / US-139
--  Date : 2026-06-07
--  Auteur : El Hadj Amadou NIANG
--  Description : Corrige le filtre `posted` de gl.v_general_balance.
--                Le `LEFT JOIN ... AND je.status='posted'` (US-021) était
--                inopérant (LEFT JOIN conserve les lignes même si la droite
--                ne matche pas) → les écritures `draft` polluaient les
--                agrégats. Option B : FILTER (WHERE je.status='posted') sur
--                chaque agrégat + COALESCE → tous les comptes restent
--                affichés, seuls les `posted` sont sommés (principe SYSCEBNL).
--  Source : extrait de docs/grantflow_ddl_postgresql.sql section
--           « Sprint S3bis / US-139 — v_general_balance filtre posted correct ».
--  Idempotent : oui (CREATE OR REPLACE VIEW). Colonnes inchangées.
--  Application :
--    psql -h <host> -U <user> -d <db> -f docs/migrations/2026-06-07-sprint-s3bis-v-general-balance-posted-filter.sql
--  (dev local : docker exec -i grantflow-postgres psql -U grantflow \
--    -d grantflow_dev -f docs/migrations/2026-06-07-sprint-s3bis-v-general-balance-posted-filter.sql)
-- =====================================================================

CREATE OR REPLACE VIEW gl.v_general_balance AS
SELECT
    a.code,
    a.label,
    a.class,
    COALESCE(SUM(jl.debit)             FILTER (WHERE je.status = 'posted'), 0) AS total_debit,
    COALESCE(SUM(jl.credit)            FILTER (WHERE je.status = 'posted'), 0) AS total_credit,
    COALESCE(SUM(jl.debit - jl.credit) FILTER (WHERE je.status = 'posted'), 0) AS balance,
    COALESCE(SUM(jl.debit)             FILTER (WHERE je.status = 'posted'), 0) AS total_debit_xof,
    COALESCE(SUM(jl.credit)            FILTER (WHERE je.status = 'posted'), 0) AS total_credit_xof,
    COALESCE(SUM(jl.debit - jl.credit) FILTER (WHERE je.status = 'posted'), 0) AS balance_xof,
    array_agg(DISTINCT jl.currency)
      FILTER (WHERE je.status = 'posted' AND jl.currency IS NOT NULL AND jl.currency <> 'XOF')
                               AS transaction_currencies,
    COUNT(jl.id) FILTER (WHERE je.status = 'posted') AS line_count
FROM ref.gl_account a
LEFT JOIN gl.journal_line jl  ON jl.account_code = a.code
LEFT JOIN gl.journal_entry je ON je.id = jl.entry_id
WHERE a.is_movement
GROUP BY a.code, a.label, a.class
ORDER BY a.code;

-- =====================================================================
--  Vérification post-migration : une écriture draft ne doit PAS remonter.
--  (cf. apps/api/scripts/smoke-v-general-balance.ts pour le test automatisé)
-- =====================================================================

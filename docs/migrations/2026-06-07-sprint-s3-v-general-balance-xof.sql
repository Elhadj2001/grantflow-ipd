-- =====================================================================
--  Migration GRANTFLOW IPD — Sprint S3 / US-021
--  Date : 2026-06-07
--  Auteur : El Hadj Amadou NIANG
--  Description : Étend gl.v_general_balance pour exposer explicitement les
--                soldes en XOF (devise de tenue SYSCEBNL) + une ventilation
--                informative des devises transactionnelles étrangères.
--                Suite de US-020/F18 (debit/credit désormais stockés en XOF).
--  Source : extrait de docs/grantflow_ddl_postgresql.sql section
--           « Sprint S3 / US-021 — v_general_balance SYSCEBNL clarté XOF ».
--  Idempotent : oui (CREATE OR REPLACE VIEW — idiome PostgreSQL).
--               Les 6 colonnes historiques sont conservées (rétrocompat) ;
--               5 colonnes ajoutées en fin (contrainte CREATE OR REPLACE).
--  Application :
--    psql -h <host> -U <user> -d <db> -f docs/migrations/2026-06-07-sprint-s3-v-general-balance-xof.sql
--  (dev local : docker exec -i grantflow-postgres psql -U grantflow \
--    -d grantflow_dev -f docs/migrations/2026-06-07-sprint-s3-v-general-balance-xof.sql)
-- =====================================================================

CREATE OR REPLACE VIEW gl.v_general_balance AS
SELECT
    a.code,
    a.label,
    a.class,
    SUM(jl.debit)              AS total_debit,
    SUM(jl.credit)             AS total_credit,
    SUM(jl.debit - jl.credit)  AS balance,
    -- Alias explicites XOF (mêmes valeurs ; debit/credit SONT en XOF).
    SUM(jl.debit)              AS total_debit_xof,
    SUM(jl.credit)             AS total_credit_xof,
    SUM(jl.debit - jl.credit)  AS balance_xof,
    -- Ventilation devises transactionnelles étrangères (informatif).
    array_agg(DISTINCT jl.currency)
      FILTER (WHERE jl.currency IS NOT NULL AND jl.currency <> 'XOF')
                               AS transaction_currencies,
    COUNT(jl.id)               AS line_count
FROM ref.gl_account a
LEFT JOIN gl.journal_line jl  ON jl.account_code = a.code
LEFT JOIN gl.journal_entry je ON je.id = jl.entry_id AND je.status = 'posted'
WHERE a.is_movement
GROUP BY a.code, a.label, a.class
ORDER BY a.code;

-- =====================================================================
--  Vérification post-migration
-- =====================================================================
-- SELECT column_name FROM information_schema.columns
--   WHERE table_schema='gl' AND table_name='v_general_balance'
--     AND column_name IN ('total_debit_xof','total_credit_xof','balance_xof',
--                         'transaction_currencies','line_count');

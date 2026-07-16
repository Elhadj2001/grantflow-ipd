-- =====================================================================
--  GRANTFLOW IPD — Sprint F5b-a Lot 4 (idempotent migration)
--  Extension du CHECK CONSTRAINT financial_statement.type pour
--  accommoder le nouveau type 'FONDS_DEDIES' (suivi des fonds dédiés
--  par convention).
--
--  CONFORME CLAUDE.md §9 : extension explicite et nommée du CHECK,
--  via DROP + ADD. Aucun TRIGGER ni GENERATED column n'est touché.
--  Idempotent : peut être appliquée plusieurs fois sans erreur.
-- =====================================================================

-- 1) Le CHECK initial est anonyme (créé par "CHECK (type IN (...))").
--    On le récupère via INFORMATION_SCHEMA puis on le supprime. Si la
--    table a été créée par une migration plus récente avec un CHECK
--    nommé `financial_statement_type_check`, on le drop aussi.

DO $$
DECLARE
    constraint_name TEXT;
BEGIN
    -- Drop le CHECK actuel (nommé ou anonyme — on cherche par definition).
    FOR constraint_name IN
        SELECT con.conname
        FROM pg_constraint con
        JOIN pg_class cls ON cls.oid = con.conrelid
        JOIN pg_namespace ns ON ns.oid = cls.relnamespace
        WHERE ns.nspname = 'reporting'
          AND cls.relname = 'financial_statement'
          AND con.contype = 'c'
          AND pg_get_constraintdef(con.oid) LIKE '%type%'
    LOOP
        EXECUTE format('ALTER TABLE reporting.financial_statement DROP CONSTRAINT IF EXISTS %I', constraint_name);
    END LOOP;
END;
$$;

-- 2) On ré-ajoute un CHECK nommé incluant les 4 types.
ALTER TABLE reporting.financial_statement
    ADD CONSTRAINT financial_statement_type_check
    CHECK (type IN ('TER', 'BILAN', 'RESULTAT', 'FONDS_DEDIES'));

-- 3) Mise à jour du commentaire de table.
COMMENT ON TABLE reporting.financial_statement IS
  'État financier SYSCEBNL (TER, Bilan, Compte de résultat, Fonds dédiés) par période.';

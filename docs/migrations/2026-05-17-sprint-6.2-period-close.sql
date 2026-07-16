-- =====================================================================
--  GRANTFLOW IPD — Sprint 6.2 (idempotent migration)
--  Clôture mensuelle + États financiers SYSCEBNL
--
--  Ce script peut être appliqué seul sur une base déjà existante. Il est
--  inclus dans docs/grantflow_ddl_postgresql.sql (source de vérité).
-- =====================================================================

-- Extension de gl.fiscal_period
ALTER TABLE gl.fiscal_period
    ADD COLUMN IF NOT EXISTS reopened_at    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS reopened_by    UUID REFERENCES auth.app_user(id),
    ADD COLUMN IF NOT EXISTS reopen_reason  TEXT;

-- Findings precheck
CREATE TABLE IF NOT EXISTS gl.period_close_check (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    period_id       UUID NOT NULL REFERENCES gl.fiscal_period(id) ON DELETE CASCADE,
    check_code      TEXT NOT NULL,
    severity        TEXT NOT NULL CHECK (severity IN ('BLOCKING','WARNING')),
    message         TEXT NOT NULL,
    payload         JSONB NOT NULL DEFAULT '{}',
    detected_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_period_close_check_period
    ON gl.period_close_check(period_id);

-- Audit trail close/reopen
CREATE TABLE IF NOT EXISTS gl.period_close_event (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    period_id       UUID NOT NULL REFERENCES gl.fiscal_period(id),
    action          TEXT NOT NULL CHECK (action IN ('precheck','close','reopen','dedicated_funds')),
    user_id         UUID NOT NULL REFERENCES auth.app_user(id),
    reason          TEXT,
    payload         JSONB NOT NULL DEFAULT '{}',
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_period_close_event_period
    ON gl.period_close_event(period_id);
CREATE INDEX IF NOT EXISTS idx_period_close_event_user
    ON gl.period_close_event(user_id);

-- États financiers
CREATE TABLE IF NOT EXISTS reporting.financial_statement (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    period_id           UUID NOT NULL REFERENCES gl.fiscal_period(id) ON DELETE CASCADE,
    type                TEXT NOT NULL CHECK (type IN ('TER','BILAN','RESULTAT')),
    generated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    generated_by        UUID NOT NULL REFERENCES auth.app_user(id),
    locked              BOOLEAN NOT NULL DEFAULT false,
    locked_at           TIMESTAMPTZ,
    locked_by           UUID REFERENCES auth.app_user(id),
    pdf_object_key      TEXT,
    xlsx_object_key     TEXT,
    totals              JSONB NOT NULL DEFAULT '{}',
    UNIQUE (period_id, type)
);
CREATE INDEX IF NOT EXISTS idx_financial_statement_period
    ON reporting.financial_statement(period_id);

CREATE TABLE IF NOT EXISTS reporting.financial_statement_line (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    statement_id    UUID NOT NULL REFERENCES reporting.financial_statement(id) ON DELETE CASCADE,
    section         TEXT NOT NULL,
    label           TEXT NOT NULL,
    account_code    TEXT,
    debit           NUMERIC(18,2) NOT NULL DEFAULT 0,
    credit          NUMERIC(18,2) NOT NULL DEFAULT 0,
    balance         NUMERIC(18,2) NOT NULL DEFAULT 0,
    sort_order      INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_financial_statement_line_statement
    ON reporting.financial_statement_line(statement_id);

-- Trigger protect locked statements
CREATE OR REPLACE FUNCTION reporting.protect_locked_statement() RETURNS trigger AS $$
DECLARE
    v_period_closed BOOLEAN;
BEGIN
    IF (TG_OP = 'DELETE') THEN
        IF OLD.locked THEN
            SELECT is_closed INTO v_period_closed
            FROM gl.fiscal_period WHERE id = OLD.period_id;
            IF v_period_closed THEN
                RAISE EXCEPTION 'FINANCIAL_STATEMENT_LOCKED: cannot delete a locked statement of a closed period'
                    USING ERRCODE = 'P0001';
            END IF;
        END IF;
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_protect_locked_statement ON reporting.financial_statement;
CREATE TRIGGER trg_protect_locked_statement
BEFORE DELETE ON reporting.financial_statement
FOR EACH ROW EXECUTE FUNCTION reporting.protect_locked_statement();

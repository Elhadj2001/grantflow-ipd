-- =====================================================================
--   GRANTFLOW IPD — Modèle Physique de Données
--   PostgreSQL 16+
--   Auteur : El Hadj Amadou NIANG — Mémoire MIAGE
--   Référentiel : SYSCEBNL / OHADA
--   Encodage : UTF-8 | Locale conseillée : fr_FR.UTF-8
-- =====================================================================
--
--   Ce script est idempotent (DROP IF EXISTS + CREATE).
--   Exécution recommandée :
--     createdb -E UTF8 -O grantflow grantflow_dev
--     psql -d grantflow_dev -f grantflow_ddl_postgresql.sql
--
-- =====================================================================

SET client_encoding = 'UTF8';
SET TIME ZONE 'Africa/Dakar';

-- Extensions utiles
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ---------------------------------------------------------------------
--  Schémas par bounded context
-- ---------------------------------------------------------------------
DROP SCHEMA IF EXISTS auth        CASCADE;
DROP SCHEMA IF EXISTS ref         CASCADE;
DROP SCHEMA IF EXISTS procurement CASCADE;
DROP SCHEMA IF EXISTS ap          CASCADE;
DROP SCHEMA IF EXISTS gl          CASCADE;
DROP SCHEMA IF EXISTS co          CASCADE;
DROP SCHEMA IF EXISTS reporting   CASCADE;
DROP SCHEMA IF EXISTS audit       CASCADE;

CREATE SCHEMA auth;
CREATE SCHEMA ref;
CREATE SCHEMA procurement;
CREATE SCHEMA ap;
CREATE SCHEMA gl;
CREATE SCHEMA co;
CREATE SCHEMA reporting;
CREATE SCHEMA audit;

COMMENT ON SCHEMA auth        IS 'Authentification, utilisateurs, rôles, permissions (RBAC)';
COMMENT ON SCHEMA ref         IS 'Référentiels : projets, bailleurs, conventions, fournisseurs, axes analytiques, plan SYSCEBNL';
COMMENT ON SCHEMA procurement IS 'Module Achats : demandes d achat, bons de commande, réceptions';
COMMENT ON SCHEMA ap          IS 'Accounts Payable : factures fournisseurs, paiements';
COMMENT ON SCHEMA gl          IS 'General Ledger : écritures comptables SYSCEBNL';
COMMENT ON SCHEMA co          IS 'Controlling : imputations analytiques, fonds dédiés, overheads';
COMMENT ON SCHEMA reporting   IS 'Rapports, tableaux de bord, snapshots de clôture';
COMMENT ON SCHEMA audit       IS 'Journalisation immuable des actions (piste d audit)';

-- =====================================================================
--  ENUMS
-- =====================================================================
CREATE TYPE auth.user_status     AS ENUM ('active','suspended','locked');
CREATE TYPE ref.axis_type        AS ENUM ('project','donor','grant','program','cost_center','activity','geo');
CREATE TYPE ref.donor_type       AS ENUM ('public_intl','private_foundation','bilateral','multilateral','government','own_funds');
CREATE TYPE ref.grant_status     AS ENUM ('draft','active','suspended','closed');
CREATE TYPE procurement.pr_status AS ENUM ('draft','submitted','pending_pi','pending_cg','pending_daf','pending_caissier','approved','rejected','cancelled','closed','settled');
CREATE TYPE procurement.pr_type AS ENUM ('standard','petty_cash','cash_advance');
CREATE TYPE procurement.po_status AS ENUM ('draft','sent','acknowledged','partially_received','received','invoiced','closed','cancelled');
CREATE TYPE procurement.gr_status AS ENUM ('draft','partial','complete','rejected');
CREATE TYPE ap.invoice_status     AS ENUM ('captured','matching','exception_price','exception_qty','matched','pending_validation','posted','partially_paid','paid','rejected','archived');
CREATE TYPE ap.payment_status     AS ENUM ('queued','prepared','executed','failed','reconciled','cancelled');
CREATE TYPE ap.payment_method     AS ENUM ('sepa','swift','check','cash','direct_debit');
CREATE TYPE gl.entry_status       AS ENUM ('draft','posted','reversed');
CREATE TYPE gl.journal_type       AS ENUM ('AC','VE','BQ','CA','OD','PA');  -- Achats, Ventes, Banque, Caisse, Opérations Diverses, Paie
CREATE TYPE co.fund_movement      AS ENUM ('allocation','reprise','adjustment');

-- =====================================================================
--  TABLE DE BASE : audit (immuable)
-- =====================================================================
CREATE TABLE audit.event_log (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor_id        UUID,
    actor_email     CITEXT,
    action          TEXT NOT NULL,
    entity_type     TEXT NOT NULL,
    entity_id       UUID,
    payload_before  JSONB,
    payload_after   JSONB,
    ip_address      INET,
    user_agent      TEXT,
    -- Résultat de la tentative (cf. AuditLogInterceptor) :
    --   success            → mutation 2xx
    --   denied             → 401/403 (auth/role refusé)
    --   failed_validation  → 4xx applicatif (400/404/409/422)
    --   failed_internal    → 5xx (réservé, non écrit par l'interceptor — laissé pour le logger)
    result          TEXT NOT NULL DEFAULT 'success',
    -- Code d'erreur i18n stable (cf. common/exceptions/error-codes.ts) si result != 'success'.
    error_code      TEXT,
    -- Correlation ID (UUID généré par pino-http) — permet le tracing E2E entre
    -- les logs serveur et la piste d'audit. Colonne dédiée + index pour les
    -- recherches "qu'a fait cette requête X ?" (audit bailleur).
    request_id      UUID,
    hash_chain      TEXT,  -- chaînage pour inviolabilité (hash du précédent + payload)
    CHECK (result IN ('success','denied','failed_validation','failed_internal'))
);
CREATE INDEX idx_audit_event_log_entity     ON audit.event_log(entity_type, entity_id);
CREATE INDEX idx_audit_event_log_actor      ON audit.event_log(actor_id, occurred_at DESC);
CREATE INDEX idx_audit_event_log_request_id ON audit.event_log(request_id);

-- Fonction utilitaire de hash-chaining (Tamper-evident log)
CREATE OR REPLACE FUNCTION audit.compute_hash_chain() RETURNS trigger AS $$
DECLARE
    prev_hash TEXT;
BEGIN
    SELECT hash_chain INTO prev_hash
    FROM audit.event_log
    WHERE occurred_at < NEW.occurred_at
    ORDER BY occurred_at DESC, id DESC
    LIMIT 1;
    NEW.hash_chain := encode(digest(
        coalesce(prev_hash,'GENESIS') ||
        coalesce(NEW.actor_id::text,'') ||
        NEW.action ||
        NEW.entity_type ||
        coalesce(NEW.entity_id::text,'') ||
        NEW.result ||
        coalesce(NEW.error_code,'') ||
        coalesce(NEW.payload_after::text,'') ||
        coalesce(NEW.request_id::text,''),
    'sha256'), 'hex');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_compute_hash_chain
BEFORE INSERT ON audit.event_log
FOR EACH ROW EXECUTE FUNCTION audit.compute_hash_chain();

-- =====================================================================
--  AUTHENTIFICATION
-- =====================================================================
CREATE TABLE auth.role (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code            TEXT UNIQUE NOT NULL,
    label           TEXT NOT NULL,
    description     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE auth.role IS 'Rôles RBAC du système';

CREATE TABLE auth.permission (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code        TEXT UNIQUE NOT NULL,
    label       TEXT NOT NULL,
    module      TEXT NOT NULL
);

CREATE TABLE auth.role_permission (
    role_id        UUID NOT NULL REFERENCES auth.role(id) ON DELETE CASCADE,
    permission_id  UUID NOT NULL REFERENCES auth.permission(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE auth.app_user (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email           CITEXT UNIQUE NOT NULL,
    full_name       TEXT NOT NULL,
    employee_code   TEXT,
    department      TEXT,
    status          auth.user_status NOT NULL DEFAULT 'active',
    mfa_enabled     BOOLEAN NOT NULL DEFAULT false,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_user_status ON auth.app_user(status);

CREATE TABLE auth.user_role (
    user_id     UUID NOT NULL REFERENCES auth.app_user(id) ON DELETE CASCADE,
    role_id     UUID NOT NULL REFERENCES auth.role(id) ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, role_id)
);

CREATE TABLE auth.delegation (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    delegator_id UUID NOT NULL REFERENCES auth.app_user(id),
    delegate_id  UUID NOT NULL REFERENCES auth.app_user(id),
    scope        JSONB NOT NULL,
    valid_from   DATE NOT NULL,
    valid_to     DATE NOT NULL,
    CHECK (valid_to >= valid_from)
);

-- =====================================================================
--  RÉFÉRENTIELS
-- =====================================================================

-- Plan comptable SYSCEBNL
CREATE TABLE ref.gl_account (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code          TEXT UNIQUE NOT NULL,
    label         TEXT NOT NULL,
    class         CHAR(1) NOT NULL,
    parent_code   TEXT,
    is_movement   BOOLEAN NOT NULL DEFAULT true,
    is_active     BOOLEAN NOT NULL DEFAULT true,
    syscebnl_specific BOOLEAN NOT NULL DEFAULT false,
    description   TEXT,
    CHECK (class IN ('1','2','3','4','5','6','7','8','9'))
);
CREATE INDEX idx_gl_account_class ON ref.gl_account(class);
COMMENT ON TABLE ref.gl_account IS 'Plan de comptes SYSCEBNL (classes 1 à 9)';

-- Axes analytiques (projet, bailleur, programme, centre, activité)
CREATE TABLE ref.analytical_axis (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type        ref.axis_type NOT NULL,
    code        TEXT NOT NULL,
    label       TEXT NOT NULL,
    parent_id   UUID REFERENCES ref.analytical_axis(id),
    is_active   BOOLEAN NOT NULL DEFAULT true,
    metadata    JSONB DEFAULT '{}',
    UNIQUE (type, code)
);
CREATE INDEX idx_axis_type ON ref.analytical_axis(type);

CREATE TABLE ref.program (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code        TEXT UNIQUE NOT NULL,
    label       TEXT NOT NULL,
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ref.project (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code           TEXT UNIQUE NOT NULL,
    title          TEXT NOT NULL,
    program_id     UUID REFERENCES ref.program(id),
    pi_user_id     UUID REFERENCES auth.app_user(id),
    start_date     DATE NOT NULL,
    end_date       DATE,
    status         TEXT NOT NULL DEFAULT 'active',
    description    TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_project_pi ON ref.project(pi_user_id);

CREATE TABLE ref.donor (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code          TEXT UNIQUE NOT NULL,
    label         TEXT NOT NULL,
    type          ref.donor_type NOT NULL,
    country       TEXT,
    contact_email CITEXT,
    reporting_template_id UUID,
    is_active     BOOLEAN NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ref.grant_agreement (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reference       TEXT UNIQUE NOT NULL,
    donor_id        UUID NOT NULL REFERENCES ref.donor(id),
    project_id      UUID NOT NULL REFERENCES ref.project(id),
    amount          NUMERIC(18,2) NOT NULL CHECK (amount > 0),
    currency        CHAR(3) NOT NULL,
    overhead_rate   NUMERIC(6,4) NOT NULL DEFAULT 0,
    start_date      DATE NOT NULL,
    end_date        DATE NOT NULL,
    status          ref.grant_status NOT NULL DEFAULT 'draft',
    signed_at       DATE,
    notes           TEXT,
    allows_cash_payment BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (end_date >= start_date)
);
CREATE INDEX idx_grant_project ON ref.grant_agreement(project_id);
CREATE INDEX idx_grant_donor   ON ref.grant_agreement(donor_id);

CREATE TABLE ref.budget_line (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    grant_id          UUID NOT NULL REFERENCES ref.grant_agreement(id) ON DELETE CASCADE,
    code              TEXT NOT NULL,
    label             TEXT NOT NULL,
    budgeted_amount   NUMERIC(18,2) NOT NULL CHECK (budgeted_amount >= 0),
    default_account   TEXT REFERENCES ref.gl_account(code),
    is_overhead_eligible BOOLEAN NOT NULL DEFAULT true,
    is_active         BOOLEAN NOT NULL DEFAULT true,
    UNIQUE (grant_id, code)
);

CREATE TABLE ref.supplier (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code              TEXT UNIQUE NOT NULL,
    name              TEXT NOT NULL,
    vat_number        TEXT,
    address           TEXT,
    country           TEXT,
    iban              TEXT,
    bic               TEXT,
    bank_name         TEXT,
    payment_terms_days INT NOT NULL DEFAULT 30,
    currency_default  CHAR(3) NOT NULL DEFAULT 'XOF',
    risk_score        INT DEFAULT 0,
    is_active         BOOLEAN NOT NULL DEFAULT true,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_supplier_name_trgm ON ref.supplier USING gin (name gin_trgm_ops);

CREATE TABLE ref.exchange_rate (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    from_currency CHAR(3) NOT NULL,
    to_currency   CHAR(3) NOT NULL,
    rate          NUMERIC(18,8) NOT NULL CHECK (rate > 0),
    rate_date     DATE NOT NULL,
    source        TEXT,
    is_fixed     BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (from_currency, to_currency, rate_date)
);
CREATE INDEX idx_exchange_rate_date ON ref.exchange_rate(rate_date);
-- Index partiel : un seul taux fixe possible par paire devise (BCEAO EUR/XOF).
CREATE INDEX idx_exchange_rate_fixed
    ON ref.exchange_rate(from_currency, to_currency)
    WHERE is_fixed = true;

CREATE TABLE ref.tax_code (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code         TEXT UNIQUE NOT NULL,
    label        TEXT NOT NULL,
    rate         NUMERIC(6,4) NOT NULL,
    account_code TEXT REFERENCES ref.gl_account(code),
    is_active    BOOLEAN NOT NULL DEFAULT true
);

-- =====================================================================
--  PROCUREMENT : Demandes d'achat
-- =====================================================================
CREATE TABLE procurement.purchase_request (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pr_number       TEXT UNIQUE NOT NULL,
    requested_by    UUID NOT NULL REFERENCES auth.app_user(id),
    requested_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    needed_by       DATE,
    status          procurement.pr_status NOT NULL DEFAULT 'draft',
    project_id      UUID NOT NULL REFERENCES ref.project(id),
    grant_id        UUID NOT NULL REFERENCES ref.grant_agreement(id),
    cost_center_id  UUID REFERENCES ref.analytical_axis(id),
    activity_id     UUID REFERENCES ref.analytical_axis(id),
    total_amount    NUMERIC(18,2) NOT NULL DEFAULT 0,
    currency        CHAR(3) NOT NULL DEFAULT 'XOF',
    description     TEXT,
    request_type    procurement.pr_type NOT NULL DEFAULT 'standard',
    rejection_reason TEXT,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_pr_status     ON procurement.purchase_request(status);
CREATE INDEX idx_pr_requested_by ON procurement.purchase_request(requested_by);
CREATE INDEX idx_pr_project    ON procurement.purchase_request(project_id);
CREATE INDEX idx_pr_request_type ON procurement.purchase_request(request_type);

CREATE TABLE procurement.purchase_request_line (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pr_id           UUID NOT NULL REFERENCES procurement.purchase_request(id) ON DELETE CASCADE,
    line_number     INT NOT NULL,
    description     TEXT NOT NULL,
    quantity        NUMERIC(18,4) NOT NULL CHECK (quantity > 0),
    unit            TEXT NOT NULL DEFAULT 'unit',
    unit_price      NUMERIC(18,4) NOT NULL CHECK (unit_price >= 0),
    line_total      NUMERIC(18,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
    budget_line_id  UUID NOT NULL REFERENCES ref.budget_line(id),
    default_account TEXT REFERENCES ref.gl_account(code),
    UNIQUE (pr_id, line_number)
);

CREATE TABLE procurement.approval_step (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entity_type     TEXT NOT NULL,
    entity_id       UUID NOT NULL,
    step_order      INT NOT NULL,
    approver_id     UUID REFERENCES auth.app_user(id),
    approver_role   TEXT,
    status          TEXT NOT NULL DEFAULT 'pending',
    decided_at      TIMESTAMPTZ,
    decision_notes  TEXT
);
CREATE INDEX idx_approval_entity ON procurement.approval_step(entity_type, entity_id);

-- Bons de commande
--
-- Sprint 3 — colonnes additionnelles :
--   acknowledged_at/acknowledged_by  : retour explicite du fournisseur
--   cancelled_at/cancellation_reason : annulation après émission (extourne classe 8)
--   pdf_object_key                   : clé MinIO du PDF généré
--   email_sent_at/email_sent_to      : trace de l'envoi (retry possible via /resend)
CREATE TABLE procurement.purchase_order (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    po_number           TEXT UNIQUE NOT NULL,
    pr_id               UUID REFERENCES procurement.purchase_request(id),
    supplier_id         UUID NOT NULL REFERENCES ref.supplier(id),
    order_date          DATE NOT NULL DEFAULT CURRENT_DATE,
    expected_date       DATE,
    status              procurement.po_status NOT NULL DEFAULT 'draft',
    total_ht            NUMERIC(18,2) NOT NULL DEFAULT 0,
    total_vat           NUMERIC(18,2) NOT NULL DEFAULT 0,
    total_ttc           NUMERIC(18,2) NOT NULL DEFAULT 0,
    currency            CHAR(3) NOT NULL DEFAULT 'XOF',
    incoterm            TEXT,
    delivery_address    TEXT,
    buyer_id            UUID REFERENCES auth.app_user(id),
    sent_at             TIMESTAMPTZ,
    acknowledged_at     TIMESTAMPTZ,
    acknowledged_by     TEXT,
    cancelled_at        TIMESTAMPTZ,
    cancellation_reason TEXT,
    pdf_object_key      TEXT,
    email_sent_at       TIMESTAMPTZ,
    email_sent_to       TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_po_supplier ON procurement.purchase_order(supplier_id);
CREATE INDEX idx_po_status   ON procurement.purchase_order(status);

-- Liaison N-N PR ↔ PO : un BC peut consolider plusieurs DAs ; une DA peut
-- théoriquement aussi être éclatée entre plusieurs BCs (split partiel,
-- gestion ultérieure). La colonne `pr_id` historique (1-1) reste, pointant
-- vers la "première" PR, mais l'autorité est cette table de liaison.
CREATE TABLE procurement.purchase_order_pr (
    po_id UUID NOT NULL REFERENCES procurement.purchase_order(id) ON DELETE CASCADE,
    pr_id UUID NOT NULL REFERENCES procurement.purchase_request(id),
    PRIMARY KEY (po_id, pr_id)
);
CREATE INDEX idx_po_pr_pr ON procurement.purchase_order_pr(pr_id);

CREATE TABLE procurement.purchase_order_line (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    po_id           UUID NOT NULL REFERENCES procurement.purchase_order(id) ON DELETE CASCADE,
    pr_line_id      UUID REFERENCES procurement.purchase_request_line(id),
    line_number     INT NOT NULL,
    description     TEXT NOT NULL,
    quantity        NUMERIC(18,4) NOT NULL,
    quantity_received NUMERIC(18,4) NOT NULL DEFAULT 0,
    quantity_invoiced NUMERIC(18,4) NOT NULL DEFAULT 0,
    unit            TEXT NOT NULL,
    unit_price      NUMERIC(18,4) NOT NULL,
    tax_code_id     UUID REFERENCES ref.tax_code(id),
    line_total      NUMERIC(18,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
    budget_line_id  UUID NOT NULL REFERENCES ref.budget_line(id),
    UNIQUE (po_id, line_number)
);

-- Réceptions
CREATE TABLE procurement.goods_receipt (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    gr_number       TEXT UNIQUE NOT NULL,
    po_id           UUID NOT NULL REFERENCES procurement.purchase_order(id),
    receipt_date    DATE NOT NULL DEFAULT CURRENT_DATE,
    received_by     UUID NOT NULL REFERENCES auth.app_user(id),
    status          procurement.gr_status NOT NULL DEFAULT 'draft',
    delivery_note_ref TEXT,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE procurement.goods_receipt_line (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    gr_id           UUID NOT NULL REFERENCES procurement.goods_receipt(id) ON DELETE CASCADE,
    po_line_id      UUID NOT NULL REFERENCES procurement.purchase_order_line(id),
    quantity        NUMERIC(18,4) NOT NULL CHECK (quantity > 0),
    batch_number    TEXT,
    expiry_date     DATE,
    serial_numbers  TEXT[],
    quality_check   TEXT,
    cold_chain_ok   BOOLEAN
);
CREATE INDEX idx_gr_line_po ON procurement.goods_receipt_line(po_line_id);

-- =====================================================================
--  ACCOUNTS PAYABLE : Factures et paiements
-- =====================================================================
CREATE TABLE ap.invoice (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_number  TEXT NOT NULL,
    supplier_id     UUID NOT NULL REFERENCES ref.supplier(id),
    invoice_date    DATE NOT NULL,
    due_date        DATE NOT NULL,
    received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    status          ap.invoice_status NOT NULL DEFAULT 'captured',
    total_ht        NUMERIC(18,2) NOT NULL,
    total_vat       NUMERIC(18,2) NOT NULL DEFAULT 0,
    total_ttc       NUMERIC(18,2) NOT NULL,
    currency        CHAR(3) NOT NULL DEFAULT 'XOF',
    exchange_rate   NUMERIC(18,8),
    po_id           UUID REFERENCES procurement.purchase_order(id),
    ocr_confidence  NUMERIC(5,2),
    pdf_object_key  TEXT,
    captured_payload JSONB,
    rejection_reason TEXT,
    posted_at       TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (supplier_id, invoice_number)
);
CREATE INDEX idx_invoice_status ON ap.invoice(status);
CREATE INDEX idx_invoice_due    ON ap.invoice(due_date);
CREATE INDEX idx_invoice_po     ON ap.invoice(po_id);

CREATE TABLE ap.invoice_line (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_id      UUID NOT NULL REFERENCES ap.invoice(id) ON DELETE CASCADE,
    line_number     INT NOT NULL,
    description     TEXT NOT NULL,
    quantity        NUMERIC(18,4),
    unit_price      NUMERIC(18,4),
    line_total      NUMERIC(18,2) NOT NULL,
    tax_code_id     UUID REFERENCES ref.tax_code(id),
    po_line_id      UUID REFERENCES procurement.purchase_order_line(id),
    gl_account      TEXT REFERENCES ref.gl_account(code),
    UNIQUE (invoice_id, line_number)
);

CREATE TABLE ap.invoice_match (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_line_id UUID NOT NULL REFERENCES ap.invoice_line(id),
    po_line_id      UUID NOT NULL REFERENCES procurement.purchase_order_line(id),
    gr_line_id      UUID REFERENCES procurement.goods_receipt_line(id),
    qty_matched     NUMERIC(18,4) NOT NULL,
    price_variance  NUMERIC(18,2) DEFAULT 0,
    qty_variance    NUMERIC(18,4) DEFAULT 0,
    match_result    TEXT NOT NULL,
    matched_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ap.payment_run (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    run_number      TEXT UNIQUE NOT NULL,
    run_date        DATE NOT NULL DEFAULT CURRENT_DATE,
    currency        CHAR(3) NOT NULL DEFAULT 'XOF',
    bank_account    TEXT,
    prepared_by     UUID REFERENCES auth.app_user(id),
    approved_by     UUID REFERENCES auth.app_user(id),
    total_amount    NUMERIC(18,2) NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'draft',
    sepa_file_key   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ap.payment (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    payment_run_id  UUID REFERENCES ap.payment_run(id),
    invoice_id      UUID NOT NULL REFERENCES ap.invoice(id),
    amount          NUMERIC(18,2) NOT NULL CHECK (amount > 0),
    currency        CHAR(3) NOT NULL,
    method          ap.payment_method NOT NULL,
    payment_date    DATE NOT NULL,
    status          ap.payment_status NOT NULL DEFAULT 'queued',
    bank_reference  TEXT,
    fx_gain_loss    NUMERIC(18,2) DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_payment_invoice ON ap.payment(invoice_id);

-- =====================================================================
--  GENERAL LEDGER : Écritures SYSCEBNL
-- =====================================================================
CREATE TABLE gl.fiscal_period (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code        TEXT UNIQUE NOT NULL,   -- '2026-01', '2026-Q1', '2026'
    period_type TEXT NOT NULL,          -- 'month', 'quarter', 'year'
    start_date  DATE NOT NULL,
    end_date    DATE NOT NULL,
    is_closed   BOOLEAN NOT NULL DEFAULT false,
    closed_at   TIMESTAMPTZ,
    closed_by   UUID REFERENCES auth.app_user(id)
);

CREATE TABLE gl.journal_entry (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entry_number    TEXT UNIQUE NOT NULL,
    journal         gl.journal_type NOT NULL,
    entry_date      DATE NOT NULL,
    period_id       UUID NOT NULL REFERENCES gl.fiscal_period(id),
    label           TEXT NOT NULL,
    source_type     TEXT,
    source_id       UUID,
    status          gl.entry_status NOT NULL DEFAULT 'draft',
    posted_at       TIMESTAMPTZ,
    posted_by       UUID REFERENCES auth.app_user(id),
    reversed_by_id  UUID REFERENCES gl.journal_entry(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_je_period ON gl.journal_entry(period_id);
CREATE INDEX idx_je_status ON gl.journal_entry(status);
CREATE INDEX idx_je_source ON gl.journal_entry(source_type, source_id);

CREATE TABLE gl.journal_line (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entry_id        UUID NOT NULL REFERENCES gl.journal_entry(id) ON DELETE CASCADE,
    line_number     INT NOT NULL,
    account_code    TEXT NOT NULL REFERENCES ref.gl_account(code),
    auxiliary_code  TEXT,
    label           TEXT,
    debit           NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
    credit          NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
    currency        CHAR(3) NOT NULL DEFAULT 'XOF',
    debit_currency  NUMERIC(18,2) DEFAULT 0,
    credit_currency NUMERIC(18,2) DEFAULT 0,
    -- Imputation analytique
    project_id      UUID REFERENCES ref.project(id),
    grant_id        UUID REFERENCES ref.grant_agreement(id),
    budget_line_id  UUID REFERENCES ref.budget_line(id),
    cost_center_id  UUID REFERENCES ref.analytical_axis(id),
    activity_id     UUID REFERENCES ref.analytical_axis(id),
    UNIQUE (entry_id, line_number),
    CHECK ( (debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0) )
);
CREATE INDEX idx_jl_account ON gl.journal_line(account_code);
CREATE INDEX idx_jl_project ON gl.journal_line(project_id);
CREATE INDEX idx_jl_grant   ON gl.journal_line(grant_id);

-- Contrainte d'équilibre par écriture (somme débit = somme crédit)
CREATE OR REPLACE FUNCTION gl.check_entry_balance() RETURNS trigger AS $$
DECLARE
    total_debit  NUMERIC(18,2);
    total_credit NUMERIC(18,2);
    v_status     gl.entry_status;
BEGIN
    SELECT status INTO v_status FROM gl.journal_entry WHERE id = NEW.entry_id;
    IF v_status = 'posted' THEN
        SELECT COALESCE(SUM(debit),0), COALESCE(SUM(credit),0)
        INTO total_debit, total_credit
        FROM gl.journal_line WHERE entry_id = NEW.entry_id;
        IF total_debit <> total_credit THEN
            RAISE EXCEPTION 'Écriture % déséquilibrée : Débit % / Crédit %',
                NEW.entry_id, total_debit, total_credit;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_journal_balance
AFTER INSERT OR UPDATE ON gl.journal_line
FOR EACH ROW EXECUTE FUNCTION gl.check_entry_balance();

-- Blocage des écritures sur période close
CREATE OR REPLACE FUNCTION gl.check_period_open() RETURNS trigger AS $$
DECLARE
    v_closed BOOLEAN;
BEGIN
    SELECT is_closed INTO v_closed
    FROM gl.fiscal_period
    WHERE id = NEW.period_id;
    IF v_closed AND (TG_OP = 'INSERT' OR OLD.status <> 'posted') THEN
        RAISE EXCEPTION 'La période % est clôturée — écriture refusée', NEW.period_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_journal_entry_period
BEFORE INSERT OR UPDATE ON gl.journal_entry
FOR EACH ROW EXECUTE FUNCTION gl.check_period_open();

-- =====================================================================
--  CONTROLLING : Analytique, fonds dédiés, overheads
-- =====================================================================
CREATE TABLE co.dedicated_fund_movement (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    grant_id        UUID NOT NULL REFERENCES ref.grant_agreement(id),
    period_id       UUID NOT NULL REFERENCES gl.fiscal_period(id),
    movement_type   co.fund_movement NOT NULL,
    amount          NUMERIC(18,2) NOT NULL,
    currency        CHAR(3) NOT NULL DEFAULT 'XOF',
    journal_entry_id UUID REFERENCES gl.journal_entry(id),
    rationale       TEXT,
    computed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_dfm_grant ON co.dedicated_fund_movement(grant_id);

CREATE TABLE co.overhead_calculation (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    grant_id        UUID NOT NULL REFERENCES ref.grant_agreement(id),
    period_id       UUID NOT NULL REFERENCES gl.fiscal_period(id),
    eligible_base   NUMERIC(18,2) NOT NULL,
    overhead_rate   NUMERIC(6,4) NOT NULL,
    overhead_amount NUMERIC(18,2) GENERATED ALWAYS AS (eligible_base * overhead_rate) STORED,
    journal_entry_id UUID REFERENCES gl.journal_entry(id),
    computed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE co.allocation_rule (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code            TEXT UNIQUE NOT NULL,
    label           TEXT NOT NULL,
    source_account  TEXT REFERENCES ref.gl_account(code),
    method          TEXT NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    parameters      JSONB DEFAULT '{}'
);

CREATE TABLE co.allocation_target (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    rule_id         UUID NOT NULL REFERENCES co.allocation_rule(id) ON DELETE CASCADE,
    project_id      UUID REFERENCES ref.project(id),
    grant_id        UUID REFERENCES ref.grant_agreement(id),
    cost_center_id  UUID REFERENCES ref.analytical_axis(id),
    weight          NUMERIC(8,4) NOT NULL CHECK (weight > 0)
);

-- =====================================================================
--  REPORTING
-- =====================================================================
CREATE TABLE reporting.report_template (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code            TEXT UNIQUE NOT NULL,
    label           TEXT NOT NULL,
    donor_id        UUID REFERENCES ref.donor(id),
    output_format   TEXT NOT NULL DEFAULT 'pdf',
    template_payload JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE reporting.report_run (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    template_id     UUID NOT NULL REFERENCES reporting.report_template(id),
    period_id       UUID NOT NULL REFERENCES gl.fiscal_period(id),
    grant_id        UUID REFERENCES ref.grant_agreement(id),
    generated_by    UUID NOT NULL REFERENCES auth.app_user(id),
    generated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    file_object_key TEXT,
    payload_snapshot JSONB
);

-- =====================================================================
--  VUES MÉTIER
-- =====================================================================

-- Suivi budgétaire par ligne (vue temps réel)
CREATE OR REPLACE VIEW co.v_budget_tracking AS
SELECT
    bl.id                       AS budget_line_id,
    bl.code                     AS budget_line_code,
    bl.label                    AS budget_line_label,
    g.reference                 AS grant_ref,
    p.code                      AS project_code,
    p.title                     AS project_title,
    bl.budgeted_amount,
    COALESCE(SUM(po_lines.line_total) FILTER (
        WHERE po.status NOT IN ('cancelled','draft')
    ), 0)                       AS engaged_amount,
    COALESCE(SUM(jl.debit) - SUM(jl.credit), 0) AS consumed_amount,
    bl.budgeted_amount
      - COALESCE(SUM(po_lines.line_total) FILTER (
            WHERE po.status NOT IN ('cancelled','draft')
        ), 0)                   AS available_amount
FROM ref.budget_line bl
JOIN ref.grant_agreement g ON g.id = bl.grant_id
JOIN ref.project p ON p.id = g.project_id
LEFT JOIN procurement.purchase_order_line po_lines ON po_lines.budget_line_id = bl.id
LEFT JOIN procurement.purchase_order po ON po.id = po_lines.po_id
LEFT JOIN gl.journal_line jl ON jl.budget_line_id = bl.id
GROUP BY bl.id, bl.code, bl.label, bl.budgeted_amount, g.reference, p.code, p.title;

COMMENT ON VIEW co.v_budget_tracking IS 'Suivi temps réel des engagements / consommations par ligne budgétaire';

-- Balance générale par compte
CREATE OR REPLACE VIEW gl.v_general_balance AS
SELECT
    a.code,
    a.label,
    a.class,
    SUM(jl.debit)  AS total_debit,
    SUM(jl.credit) AS total_credit,
    SUM(jl.debit - jl.credit) AS balance
FROM ref.gl_account a
LEFT JOIN gl.journal_line jl  ON jl.account_code = a.code
LEFT JOIN gl.journal_entry je ON je.id = jl.entry_id AND je.status = 'posted'
WHERE a.is_movement
GROUP BY a.code, a.label, a.class
ORDER BY a.code;

-- =====================================================================
--  SEED — Données initiales SYSCEBNL
-- =====================================================================

-- Plan comptable SYSCEBNL (extrait)
INSERT INTO ref.gl_account (code, label, class, is_movement, syscebnl_specific) VALUES
('10',     'Capital, fonds associatifs et réserves', '1', false, true),
('101',    'Fonds associatifs sans droit de reprise', '1', true, true),
('109',    'Apports avec ou sans droit de reprise (à amortir)', '1', true, true),
('11',     'Report à nouveau', '1', true, false),
('12',     'Résultat net de l''exercice', '1', true, false),
('15',     'Provisions réglementées et fonds dédiés', '1', false, true),
('19',     'Fonds dédiés', '1', true, true),
('19_1',   'Fonds dédiés sur subventions de fonctionnement', '1', true, true),
('19_2',   'Fonds dédiés sur dons manuels affectés', '1', true, true),
('2',      'COMPTES D''ACTIFS IMMOBILISÉS', '2', false, false),
('21',     'Immobilisations corporelles', '2', false, false),
('218',    'Matériel et outillage', '2', true, false),
('281',    'Amortissements des immobilisations corporelles', '2', true, false),
('4',      'COMPTES DE TIERS', '4', false, false),
('40',     'Fournisseurs et comptes rattachés', '4', false, false),
('401',    'Fournisseurs', '4', true, false),
('408',    'Fournisseurs - Factures non parvenues (FNP)', '4', true, false),
('44',     'État et collectivités publiques', '4', false, false),
('445',    'État, TVA', '4', true, false),
('5',      'COMPTES FINANCIERS', '5', false, false),
('52',     'Banques', '5', false, false),
('521',    'Banques locales', '5', true, false),
('522',    'Banques étrangères', '5', true, false),
('57',     'Caisse', '5', true, false),
('6',      'COMPTES DE CHARGES', '6', false, false),
('60',     'Achats et variations de stocks', '6', false, false),
('601',    'Achats de matières premières et fournitures liées', '6', true, false),
('604',    'Achats stockés de matières et fournitures consommables', '6', true, false),
('6041',   'Réactifs et consommables de laboratoire', '6', true, false),
('605',    'Autres achats', '6', true, false),
('61',     'Transports', '6', false, false),
('62',     'Services extérieurs A', '6', false, false),
('622',    'Locations et charges locatives', '6', true, false),
('626',    'Frais postaux et télécommunications', '6', true, false),
('63',     'Services extérieurs B', '6', false, false),
('632',    'Rémunérations d''intermédiaires et de conseils', '6', true, false),
('66',     'Charges de personnel', '6', false, false),
('661',    'Rémunérations directes', '6', true, false),
('664',    'Charges sociales', '6', true, false),
('68',     'Dotations aux amortissements et provisions', '6', false, false),
('681',    'Dotations aux amortissements', '6', true, false),
('689',    'Dotations aux fonds dédiés', '6', true, true),
('7',      'COMPTES DE PRODUITS', '7', false, false),
('75',     'Cotisations, dons, subventions reçues', '7', false, true),
('754',    'Subventions d''exploitation reçues', '7', true, true),
('756',    'Dons manuels reçus', '7', true, true),
('789',    'Reports des ressources non utilisées', '7', true, true),
('8',      'COMPTES SPÉCIAUX', '8', false, true),
('80',     'Engagements hors bilan', '8', false, true),
('801',    'Engagements donnés (BC en cours)', '8', true, true),
('802',    'Contre-engagement BC en cours', '8', true, true),
('9',      'COMPTABILITÉ ANALYTIQUE', '9', false, true),
('90',     'Comptes réfléchis', '9', false, true),
('92',     'Sections analytiques', '9', true, true),
('93',     'Coûts', '9', true, true),
('98',     'Résultats analytiques', '9', true, true);

-- Quelques rôles standards
INSERT INTO auth.role (code, label, description) VALUES
('SUPER_ADMIN',   'Super administrateur', 'Accès complet'),
('DAF',           'Directeur Administratif et Financier', 'Pilotage financier, validations finales'),
('CONTROLEUR',    'Contrôleur de gestion', 'Paramétrage conventions, supervision analytique'),
('COMPTABLE',     'Comptable', 'Saisie, validation factures, écritures'),
('TRESORIER',     'Trésorier', 'Mise en paiement, gestion bancaire'),
('ACHETEUR',      'Acheteur', 'Sourcing, BC'),
('MAGASINIER',    'Magasinier / Réception', 'Constatation du service fait'),
('PI',            'Principal Investigator', 'Validation budgétaire projet'),
('DEMANDEUR',     'Demandeur', 'Saisie des DA'),
('BAILLEUR',      'Bailleur / Auditeur (lecture)', 'Consultation en lecture seule'),
('CAISSIER',      'Caissier', 'Gestion de la caisse en espèces, approbation des DA petty_cash');

-- Quelques bailleurs typiques de l'IPD
INSERT INTO ref.donor (code, label, type, country) VALUES
('BMGF',  'Bill & Melinda Gates Foundation', 'private_foundation', 'USA'),
('EDCTP', 'European & Developing Countries Clinical Trials Partnership', 'public_intl', 'EU'),
('UE',    'Union Européenne (Horizon Europe)', 'public_intl', 'EU'),
('AFD',   'Agence Française de Développement', 'bilateral', 'France'),
('GAVI',  'GAVI The Vaccine Alliance', 'public_intl', 'CH'),
('CEPI',  'Coalition for Epidemic Preparedness Innovations', 'public_intl', 'NO'),
('WHO',   'Organisation Mondiale de la Santé', 'multilateral', 'CH'),
('USAID', 'United States Agency for International Development', 'bilateral', 'USA'),
('IPD',   'Fonds propres IPD', 'own_funds', 'SN');

-- Codes TVA Sénégal
INSERT INTO ref.tax_code (code, label, rate, account_code) VALUES
('TVA18',  'TVA collectée 18 %', 0.1800, '445'),
('TVA0',   'Exonéré recherche',   0.0000, '445'),
('RAS5',   'Retenue à la source 5 %', 0.0500, '445');

-- Périodes fiscales 2026
INSERT INTO gl.fiscal_period (code, period_type, start_date, end_date) VALUES
('2026',     'year',    '2026-01-01', '2026-12-31'),
('2026-Q1',  'quarter', '2026-01-01', '2026-03-31'),
('2026-Q2',  'quarter', '2026-04-01', '2026-06-30'),
('2026-01',  'month',   '2026-01-01', '2026-01-31'),
('2026-02',  'month',   '2026-02-01', '2026-02-28'),
('2026-03',  'month',   '2026-03-01', '2026-03-31'),
('2026-04',  'month',   '2026-04-01', '2026-04-30'),
('2026-05',  'month',   '2026-05-01', '2026-05-31');

-- =====================================================================
--  SPRINT 2.3 — Petite caisse (petty_cash + cash_advance)
--
--  Idéal pour les achats urgents/de faible montant payés en espèces :
--   - petty_cash    : sortie immédiate, 1 étape (CAISSIER)
--   - cash_advance  : avance de mission, 2 étapes (PI puis CAISSIER) + settle
--
--  Les caisses sont des entités référentielles avec plafonds (par requête,
--  par jour/utilisateur, plafond global). Le solde est décrémenté à
--  l'approbation finale et remonté lors du settle (régularisation) pour
--  cash_advance.
-- =====================================================================

CREATE TABLE IF NOT EXISTS ref.cash_box (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code              TEXT UNIQUE NOT NULL,
    label             TEXT NOT NULL,
    custodian_user_id UUID REFERENCES auth.app_user(id),
    currency          CHAR(3) NOT NULL DEFAULT 'XOF',
    current_balance   NUMERIC(18,2) NOT NULL DEFAULT 0,
    ceiling           NUMERIC(18,2) NOT NULL DEFAULT 500000,
    per_request_max   NUMERIC(18,2) NOT NULL DEFAULT 100000,
    per_day_user_max  NUMERIC(18,2) NOT NULL DEFAULT 200000,
    is_active         BOOLEAN NOT NULL DEFAULT true,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (current_balance >= 0),
    CHECK (per_request_max  > 0),
    CHECK (per_day_user_max > 0),
    CHECK (ceiling          > 0)
);
CREATE INDEX IF NOT EXISTS idx_cash_box_active ON ref.cash_box(is_active);

-- Rattachement de la DA à une caisse — obligatoire métier si request_type ∈
-- ('petty_cash','cash_advance'), facultatif sinon (standard). Le contrôle
-- métier est dans le service ; la colonne reste NULLABLE car les DA standard
-- existantes ne portent pas de caisse.
ALTER TABLE procurement.purchase_request
    ADD COLUMN IF NOT EXISTS cash_box_id UUID REFERENCES ref.cash_box(id);
CREATE INDEX IF NOT EXISTS idx_pr_cash_box ON procurement.purchase_request(cash_box_id)
    WHERE cash_box_id IS NOT NULL;

-- Régularisation d'une avance de mission. Une seule entrée par DA cash_advance
-- (UNIQUE), créée par le caissier ou la DAF à la clôture.
CREATE TABLE IF NOT EXISTS ref.cash_settlement (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    purchase_request_id UUID NOT NULL UNIQUE REFERENCES procurement.purchase_request(id),
    actual_spent        NUMERIC(18,2) NOT NULL CHECK (actual_spent >= 0),
    variance            NUMERIC(18,2) NOT NULL,
    justifications      TEXT,
    settled_by          UUID REFERENCES auth.app_user(id),
    settled_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cash_settlement_pr ON ref.cash_settlement(purchase_request_id);

-- =====================================================================
--  SPRINT 4.1 — Réception de biens et services
--
--  La table procurement.goods_receipt et goods_receipt_line existent depuis
--  le sprint 0. On enrichit ici :
--    - cold_chain_required : flag biomédical (réactifs, vaccins)
--    - rejected_reason     : motif si livraison refusée par le magasinier
--    - cancellation_*      : annulation d'un GR draft
--    - 'cancelled' ajouté à l'enum gr_status
--    - quantity >= 0 sur goods_receipt_line (pour init à 0 lors createFromPo)
-- =====================================================================

-- Enum : ajout de 'cancelled' (idempotent)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'gr_status' AND e.enumlabel = 'cancelled'
    ) THEN
        ALTER TYPE procurement.gr_status ADD VALUE 'cancelled';
    END IF;
END$$;

-- Colonnes additionnelles sur goods_receipt
ALTER TABLE procurement.goods_receipt
    ADD COLUMN IF NOT EXISTS cold_chain_required BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS rejected_reason     TEXT,
    ADD COLUMN IF NOT EXISTS rejected_at         TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS rejected_by         UUID REFERENCES auth.app_user(id),
    ADD COLUMN IF NOT EXISTS cancelled_at        TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS cancelled_reason    TEXT,
    ADD COLUMN IF NOT EXISTS cancelled_by        UUID REFERENCES auth.app_user(id),
    ADD COLUMN IF NOT EXISTS completed_at        TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS completed_by        UUID REFERENCES auth.app_user(id),
    ADD COLUMN IF NOT EXISTS updated_at          TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_gr_po     ON procurement.goods_receipt(po_id);
CREATE INDEX IF NOT EXISTS idx_gr_status ON procurement.goods_receipt(status);

-- goods_receipt_line : relâcher quantity > 0 en quantity >= 0
DO $$
DECLARE
    cname TEXT;
BEGIN
    SELECT conname INTO cname
    FROM pg_constraint
    WHERE conrelid = 'procurement.goods_receipt_line'::regclass
      AND contype  = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%quantity%>%0%';
    IF cname IS NOT NULL THEN
        EXECUTE format('ALTER TABLE procurement.goods_receipt_line DROP CONSTRAINT %I', cname);
    END IF;
END$$;

ALTER TABLE procurement.goods_receipt_line
    DROP CONSTRAINT IF EXISTS goods_receipt_line_quantity_check;

ALTER TABLE procurement.goods_receipt_line
    ADD CONSTRAINT goods_receipt_line_quantity_nonneg
    CHECK (quantity >= 0);

-- =====================================================================
--  SPRINT 4.2a — Réception facture + OCR + Matching 3-way
--
--  La table ap.invoice / invoice_line / invoice_match existe depuis le
--  sprint 0. On enrichit ici :
--    - matched_by / matched_at : qui a soumis au matching et quand
--    - match_summary : récapitulatif JSONB du dernier run de matching
--      (compteurs par résultat, max écart prix/qty, détails par ligne)
-- =====================================================================

ALTER TABLE ap.invoice
    ADD COLUMN IF NOT EXISTS matched_by    UUID REFERENCES auth.app_user(id),
    ADD COLUMN IF NOT EXISTS matched_at    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS match_summary JSONB;

-- =====================================================================
--  FIN DU SCRIPT — Vérifications rapides
-- =====================================================================
-- SELECT COUNT(*) AS nb_tables FROM information_schema.tables
--   WHERE table_schema IN ('auth','ref','procurement','ap','gl','co','reporting','audit');
-- SELECT * FROM ref.gl_account ORDER BY code LIMIT 20;

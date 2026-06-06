-- =====================================================================
--  Migration GRANTFLOW IPD — Sprint S1 / US-001-US-002
--  Date : 2026-07-02
--  Auteur : El Hadj Amadou NIANG
--  Description : Ajout des colonnes multidevise (*_xof, fx_rate,
--                fx_rate_date) sur les tables financières, conformément
--                à ADR-005 (Multidevise tripartite avec XOF SYSCEBNL).
--  Source : extrait de docs/grantflow_ddl_postgresql.sql section
--           Sprint S1 (SHA 7a414b8).
--  Idempotent : oui (ALTER TABLE ... ADD COLUMN IF NOT EXISTS).
--  Application :
--    psql -h <host> -U <user> -d <db> -f docs/migrations/2026-07-02-sprint-s1-multicurrency-columns.sql
-- =====================================================================

-- 1) procurement.purchase_request — total_amount
ALTER TABLE procurement.purchase_request
    ADD COLUMN IF NOT EXISTS total_amount_xof BIGINT,
    ADD COLUMN IF NOT EXISTS fx_rate          NUMERIC(14,6),
    ADD COLUMN IF NOT EXISTS fx_rate_date     DATE;
COMMENT ON COLUMN procurement.purchase_request.total_amount_xof IS
  'ADR-005 — équivalent XOF (franc CFA entier) de total_amount, calculé par ExchangeRateService au taux fx_rate.';
COMMENT ON COLUMN procurement.purchase_request.fx_rate IS
  'ADR-005 — taux appliqué pour convertir total_amount (devise=currency) en XOF. 1 si currency=XOF.';
COMMENT ON COLUMN procurement.purchase_request.fx_rate_date IS
  'ADR-005 — date du taux fx_rate (ref.exchange_rate.rate_date) pour reproductibilité de l''audit-trail.';

-- 2) procurement.purchase_request_line — unit_price (line_total est GENERATED — NON touché)
ALTER TABLE procurement.purchase_request_line
    ADD COLUMN IF NOT EXISTS unit_price_xof BIGINT,
    ADD COLUMN IF NOT EXISTS fx_rate        NUMERIC(14,6),
    ADD COLUMN IF NOT EXISTS fx_rate_date   DATE;
COMMENT ON COLUMN procurement.purchase_request_line.unit_price_xof IS
  'ADR-005 — équivalent XOF (franc CFA entier) de unit_price. line_total reste calculé par PostgreSQL (GENERATED) en devise transactionnelle.';
COMMENT ON COLUMN procurement.purchase_request_line.fx_rate IS
  'ADR-005 — taux appliqué pour convertir unit_price en XOF. 1 si devise de la DA = XOF.';
COMMENT ON COLUMN procurement.purchase_request_line.fx_rate_date IS
  'ADR-005 — date du taux fx_rate (ref.exchange_rate.rate_date).';

-- 3) procurement.purchase_order — total_ht / total_vat / total_ttc
ALTER TABLE procurement.purchase_order
    ADD COLUMN IF NOT EXISTS total_ht_xof  BIGINT,
    ADD COLUMN IF NOT EXISTS total_vat_xof BIGINT,
    ADD COLUMN IF NOT EXISTS total_ttc_xof BIGINT,
    ADD COLUMN IF NOT EXISTS fx_rate       NUMERIC(14,6),
    ADD COLUMN IF NOT EXISTS fx_rate_date  DATE;
COMMENT ON COLUMN procurement.purchase_order.total_ht_xof IS
  'ADR-005 — équivalent XOF (franc CFA entier) de total_ht. HT/TVA séparés car SYSCEBNL impute charge et TVA récupérable sur des lignes distinctes.';
COMMENT ON COLUMN procurement.purchase_order.total_vat_xof IS
  'ADR-005 — équivalent XOF (franc CFA entier) de total_vat.';
COMMENT ON COLUMN procurement.purchase_order.total_ttc_xof IS
  'ADR-005 — équivalent XOF (franc CFA entier) de total_ttc (montant engagé / payable).';
COMMENT ON COLUMN procurement.purchase_order.fx_rate IS
  'ADR-005 — taux appliqué pour convertir les totaux du BC (devise=currency) en XOF. 1 si currency=XOF.';
COMMENT ON COLUMN procurement.purchase_order.fx_rate_date IS
  'ADR-005 — date du taux fx_rate (ref.exchange_rate.rate_date).';

-- 4) procurement.purchase_order_line — unit_price (line_total est GENERATED — NON touché)
ALTER TABLE procurement.purchase_order_line
    ADD COLUMN IF NOT EXISTS unit_price_xof BIGINT,
    ADD COLUMN IF NOT EXISTS fx_rate        NUMERIC(14,6),
    ADD COLUMN IF NOT EXISTS fx_rate_date   DATE;
COMMENT ON COLUMN procurement.purchase_order_line.unit_price_xof IS
  'ADR-005 — équivalent XOF (franc CFA entier) de unit_price. line_total reste GENERATED par PostgreSQL en devise transactionnelle.';
COMMENT ON COLUMN procurement.purchase_order_line.fx_rate IS
  'ADR-005 — taux appliqué pour convertir unit_price en XOF. 1 si devise du BC = XOF.';
COMMENT ON COLUMN procurement.purchase_order_line.fx_rate_date IS
  'ADR-005 — date du taux fx_rate (ref.exchange_rate.rate_date).';

-- 5) ap.invoice — total_ht / total_vat / total_ttc
--    NB : exchange_rate (NUMERIC 18,8) existe déjà (taux sans date). Le triplet
--    ADR-005 ci-dessous le standardise et ajoute la date pour l'audit-trail.
ALTER TABLE ap.invoice
    ADD COLUMN IF NOT EXISTS total_ht_xof  BIGINT,
    ADD COLUMN IF NOT EXISTS total_vat_xof BIGINT,
    ADD COLUMN IF NOT EXISTS total_ttc_xof BIGINT,
    ADD COLUMN IF NOT EXISTS fx_rate       NUMERIC(14,6),
    ADD COLUMN IF NOT EXISTS fx_rate_date  DATE;
COMMENT ON COLUMN ap.invoice.total_ht_xof IS
  'ADR-005 — équivalent XOF (franc CFA entier) de total_ht.';
COMMENT ON COLUMN ap.invoice.total_vat_xof IS
  'ADR-005 — équivalent XOF (franc CFA entier) de total_vat.';
COMMENT ON COLUMN ap.invoice.total_ttc_xof IS
  'ADR-005 — équivalent XOF (franc CFA entier) de total_ttc.';
COMMENT ON COLUMN ap.invoice.fx_rate IS
  'ADR-005 — taux appliqué pour convertir les totaux facture en XOF (devise=currency). Standardise l''ancien exchange_rate en ajoutant la date.';
COMMENT ON COLUMN ap.invoice.fx_rate_date IS
  'ADR-005 — date du taux fx_rate (ref.exchange_rate.rate_date).';

-- 6) ap.invoice_line — unit_price + line_total (ICI line_total est NUMERIC NOT NULL, PAS generated)
ALTER TABLE ap.invoice_line
    ADD COLUMN IF NOT EXISTS unit_price_xof BIGINT,
    ADD COLUMN IF NOT EXISTS line_total_xof BIGINT,
    ADD COLUMN IF NOT EXISTS fx_rate        NUMERIC(14,6),
    ADD COLUMN IF NOT EXISTS fx_rate_date   DATE;
COMMENT ON COLUMN ap.invoice_line.unit_price_xof IS
  'ADR-005 — équivalent XOF (franc CFA entier) de unit_price.';
COMMENT ON COLUMN ap.invoice_line.line_total_xof IS
  'ADR-005 — équivalent XOF (franc CFA entier) de line_total. NB : sur ap.invoice_line, line_total est NUMERIC NOT NULL (NON GENERATED, contrairement aux lignes DA/BC), donc son équivalent XOF est stockable.';
COMMENT ON COLUMN ap.invoice_line.fx_rate IS
  'ADR-005 — taux appliqué pour convertir les montants de ligne en XOF. 1 si devise facture = XOF.';
COMMENT ON COLUMN ap.invoice_line.fx_rate_date IS
  'ADR-005 — date du taux fx_rate (ref.exchange_rate.rate_date).';

-- 7) gl.journal_line — l'équivalent XOF EST déjà debit/credit ; il manque le taux + sa date.
--    On N'AJOUTE PAS de *_xof (ce serait dupliquer debit/credit). On ajoute
--    seulement fx_rate + fx_rate_date pour reproduire la conversion
--    debit_currency/credit_currency (transactionnel) → debit/credit (XOF).
ALTER TABLE gl.journal_line
    ADD COLUMN IF NOT EXISTS fx_rate      NUMERIC(14,6),
    ADD COLUMN IF NOT EXISTS fx_rate_date DATE;
COMMENT ON COLUMN gl.journal_line.fx_rate IS
  'ADR-005 — taux appliqué pour convertir debit_currency/credit_currency (devise transactionnelle) en debit/credit (XOF fonctionnel). 1 si currency=XOF.';
COMMENT ON COLUMN gl.journal_line.fx_rate_date IS
  'ADR-005 — date du taux fx_rate (ref.exchange_rate.rate_date). debit/credit portent déjà l''équivalent XOF.';

-- 8) ap.payment — amount (devise du compte payeur). Ajout de l'équivalent XOF + taux daté.
--    Coexiste avec original_amount/original_currency/exchange_rate (axe facture↔paiement,
--    écart FX 666/766) : ici fx_rate/fx_rate_date couvrent l'axe amount↔XOF fonctionnel.
ALTER TABLE ap.payment
    ADD COLUMN IF NOT EXISTS amount_xof   BIGINT,
    ADD COLUMN IF NOT EXISTS fx_rate      NUMERIC(14,6),
    ADD COLUMN IF NOT EXISTS fx_rate_date DATE;
COMMENT ON COLUMN ap.payment.amount_xof IS
  'ADR-005 — équivalent XOF (franc CFA entier) de amount (montant décaissé en devise du compte payeur).';
COMMENT ON COLUMN ap.payment.fx_rate IS
  'ADR-005 — taux appliqué pour convertir amount en XOF. Distinct de exchange_rate (axe facture↔paiement, F4a). 1 si currency=XOF.';
COMMENT ON COLUMN ap.payment.fx_rate_date IS
  'ADR-005 — date du taux fx_rate (ref.exchange_rate.rate_date).';

-- ---------------------------------------------------------------------
-- Vérification post-migration
-- ---------------------------------------------------------------------
-- Lancer après application pour confirmer que les 28 colonnes sont
-- présentes :
--
-- SELECT table_schema, table_name, column_name
-- FROM information_schema.columns
-- WHERE column_name LIKE '%_xof' OR column_name IN ('fx_rate', 'fx_rate_date')
-- ORDER BY table_schema, table_name, column_name;
--
-- Résultat attendu : 28 lignes.

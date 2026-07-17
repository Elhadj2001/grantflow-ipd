-- =====================================================================
--  GRANTFLOW IPD — US-067 (Sprint S7) : seed taux USD→XOF daté
-- =====================================================================
--  Objectif : éteindre les WARN `fx_indicative_fallback_used` vus en prod
--  (ExchangeRateService retombe sur FALLBACK_INDICATIVE_TO_XOF.USD=600
--  tant que ref.exchange_rate n'est pas alimentée pour USD).
--
--  Procédure CG (docs/uemoa-exchange-rate.md §3/§9) : le Contrôle de
--  Gestion alimente ref.exchange_rate avec le cours indicatif BCEAO.
--  Taux retenu : 1 USD = 590,50 XOF au 2026-07-15 (cours indicatif
--  BCEAO mi-juillet 2026 — cohérent avec la parité EUR fixe 655,957 et
--  un EUR/USD ≈ 1,11). Sens inverse stocké aussi (pattern du seed EUR).
--
--  IDEMPOTENT : ON CONFLICT (from_currency,to_currency,rate_date)
--  DO NOTHING — ne JAMAIS écraser une saisie CG existante à cette date.
--  Application : psql "$DATABASE_URL" -f scripts/seed-exchange-rate-usd-xof.sql
--  (au même moment que le backfill budget_line.category — cf. US-067).
--
--  NB : le lookup service prend le taux le plus récent ≤ date demandée →
--  ce taux daté du 2026-07-15 couvre toutes les conversions ultérieures
--  jusqu'à la prochaine saisie mensuelle CG.
-- =====================================================================

BEGIN;

INSERT INTO ref.exchange_rate (from_currency, to_currency, rate, rate_date, source, is_fixed)
VALUES
  ('USD', 'XOF', 590.50000000, DATE '2026-07-15', 'BCEAO cours indicatif — saisie CG (US-067)', false),
  ('XOF', 'USD', 0.00169348,   DATE '2026-07-15', 'BCEAO cours indicatif — saisie CG (US-067)', false)
ON CONFLICT (from_currency, to_currency, rate_date) DO NOTHING;

-- Vérification post-seed : doit renvoyer les 2 lignes datées 2026-07-15.
SELECT from_currency, to_currency, rate, rate_date, source, is_fixed
FROM ref.exchange_rate
WHERE 'USD' IN (from_currency, to_currency)
ORDER BY rate_date DESC, from_currency;

COMMIT;

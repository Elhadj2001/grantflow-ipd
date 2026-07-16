-- =====================================================================
--  GRANTFLOW IPD — Backfill ref.budget_line.category (US-055 / CLOSE-S6)
--  ---------------------------------------------------------------------
--  Objectif : peupler budget_line.category (NULL sur les lignes créées
--  avant US-055) à partir de la catégorie MAJORITAIRE des natures de
--  dépense observées sur les DA qui ont consommé chaque ligne
--  (purchase_request.expense_nature_code → grant_office.expense_nature).
--  Les lignes sans historique résoluble restent NULL (fallback proxy
--  US-056 + WARN au runtime) et sont listées dans le rapport.
--
--  MODES :
--    • DRY-RUN (DÉFAUT) : rapport seul, AUCUNE écriture.
--    • APPLY : exécuter au préalable
--        SET grantflow.backfill_apply = 'on';
--      dans la MÊME session psql, puis rejouer ce fichier.
--
--  Idempotent : ne touche que les lignes où category IS NULL ; rejouable.
--  Exécution PROD (Neon) = décision utilisateur séparée — ce script ne
--  fait partie d'aucun run automatique.
--
--  Usage :
--    psql -h localhost -p 5433 -U grantflow -d grantflow_dev \
--      -f scripts/backfill-budget-line-category.sql
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Rapport : proposition de catégorie par ligne (majorité des natures)
-- ---------------------------------------------------------------------
WITH usage AS (
  SELECT
    prl.budget_line_id,
    en.category,
    COUNT(*) AS uses
  FROM procurement.purchase_request_line prl
  JOIN procurement.purchase_request pr ON pr.id = prl.pr_id
  JOIN grant_office.expense_nature en ON en.code = pr.expense_nature_code
  WHERE pr.expense_nature_code IS NOT NULL
  GROUP BY prl.budget_line_id, en.category
),
ranked AS (
  SELECT
    budget_line_id,
    category,
    uses,
    ROW_NUMBER() OVER (PARTITION BY budget_line_id ORDER BY uses DESC, category) AS rk
  FROM usage
)
SELECT
  bl.id          AS budget_line_id,
  bl.code        AS ligne,
  bl.category    AS categorie_actuelle,
  r.category     AS categorie_proposee,
  r.uses         AS occurrences
FROM ref.budget_line bl
LEFT JOIN ranked r ON r.budget_line_id = bl.id AND r.rk = 1
WHERE bl.category IS NULL
ORDER BY (r.category IS NULL), bl.code;

-- ---------------------------------------------------------------------
-- 2) Compteurs de synthèse
-- ---------------------------------------------------------------------
SELECT
  COUNT(*) FILTER (WHERE bl.category IS NOT NULL)                    AS deja_categorisees,
  COUNT(*) FILTER (WHERE bl.category IS NULL AND r.category IS NOT NULL) AS resolubles,
  COUNT(*) FILTER (WHERE bl.category IS NULL AND r.category IS NULL) AS non_resolubles_restent_null
FROM ref.budget_line bl
LEFT JOIN (
  SELECT budget_line_id, category,
         ROW_NUMBER() OVER (PARTITION BY budget_line_id ORDER BY COUNT(*) DESC, category) AS rk
  FROM procurement.purchase_request_line prl
  JOIN procurement.purchase_request pr ON pr.id = prl.pr_id
  JOIN grant_office.expense_nature en ON en.code = pr.expense_nature_code
  WHERE pr.expense_nature_code IS NOT NULL
  GROUP BY budget_line_id, category
) r ON r.budget_line_id = bl.id AND r.rk = 1;

-- ---------------------------------------------------------------------
-- 3) APPLY (uniquement si grantflow.backfill_apply = 'on')
-- ---------------------------------------------------------------------
DO $$
DECLARE
  apply_mode text := current_setting('grantflow.backfill_apply', true);
  updated_count integer;
BEGIN
  IF apply_mode IS DISTINCT FROM 'on' THEN
    RAISE NOTICE 'DRY-RUN (défaut) — aucune écriture. Pour appliquer : SET grantflow.backfill_apply = ''on''; puis rejouer.';
    RETURN;
  END IF;

  WITH ranked AS (
    SELECT budget_line_id, category,
           ROW_NUMBER() OVER (PARTITION BY budget_line_id ORDER BY COUNT(*) DESC, category) AS rk
    FROM procurement.purchase_request_line prl
    JOIN procurement.purchase_request pr ON pr.id = prl.pr_id
    JOIN grant_office.expense_nature en ON en.code = pr.expense_nature_code
    WHERE pr.expense_nature_code IS NOT NULL
    GROUP BY budget_line_id, category
  )
  UPDATE ref.budget_line bl
  SET category = r.category
  FROM ranked r
  WHERE r.budget_line_id = bl.id
    AND r.rk = 1
    AND bl.category IS NULL;   -- idempotence : ne touche jamais une valeur posée

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RAISE NOTICE 'APPLY — % ligne(s) budgétaire(s) catégorisée(s). Les lignes sans historique restent NULL (fallback US-056).', updated_count;
END $$;

# Notes opérationnelles — Déploiement & migrations

> Journal des actions de déploiement à appliquer sur les environnements
> (Neon prod en priorité). Workflow DDL-first : les migrations sont des
> extraits idempotents de `docs/grantflow_ddl_postgresql.sql` (cf. CLAUDE.md §9).

## Sprint S3 — Migration à appliquer sur Neon prod

Deux migrations à appliquer **en séquence** :

1. `docs/migrations/2026-06-07-sprint-s3-budget-line-xof.sql`
   (4 colonnes `ALTER TABLE ref.budget_line` : `budgeted_amount_xof`,
   `fx_rate`, `fx_rate_date`, `currency`)
2. `docs/migrations/2026-06-07-sprint-s3-v-general-balance-xof.sql`
   (`CREATE OR REPLACE VIEW gl.v_general_balance` — ajoute `balance_xof`,
   `total_debit_xof`, `total_credit_xof`, `transaction_currencies`, `line_count`)

Application (exemple psql) :

```bash
psql "$DATABASE_URL" -f docs/migrations/2026-06-07-sprint-s3-budget-line-xof.sql
psql "$DATABASE_URL" -f docs/migrations/2026-06-07-sprint-s3-v-general-balance-xof.sql
```

Puis exécuter le script de backfill (fige l'équivalent XOF des lignes
budgétaires existantes au taux du jour d'exécution) :

```bash
npx ts-node apps/api/scripts/backfill-budget-line-xof.ts
```

**Idempotent** : skip les lignes déjà matérialisées (`budgeted_amount_xof`
non NULL) ; les deux migrations utilisent `ADD COLUMN IF NOT EXISTS` /
`CREATE OR REPLACE VIEW`.

**Pré-requis** : aucun. Les colonnes ajoutées sont **nullable** (rétrocompat
garantie le temps du backfill) ; la vue conserve ses 6 colonnes historiques.

**Vérification post-migration** :

```sql
-- 4 lignes attendues
SELECT column_name FROM information_schema.columns
  WHERE table_schema='ref' AND table_name='budget_line'
    AND column_name IN ('budgeted_amount_xof','fx_rate','fx_rate_date','currency');
-- 5 lignes attendues
SELECT column_name FROM information_schema.columns
  WHERE table_schema='gl' AND table_name='v_general_balance'
    AND column_name IN ('total_debit_xof','total_credit_xof','balance_xof',
                        'transaction_currencies','line_count');
```

**Note dette** : les 4 lignes `journal_line` USD seed ont `fx_rate` NULL ;
leur backfill + le `CHECK chk_fx_consistency` sont planifiés en **US-140**
(ne pas ajouter le CHECK avant ce backfill, sinon l'`ALTER` échoue).

## Sprint S3bis — Migration Neon prod

À appliquer **après** les migrations S3 (la colonne `gl.journal_line.fx_rate`
doit déjà exister). Ordre impératif (le backfill précède le CHECK) :

1. `docs/migrations/2026-06-07-sprint-s3bis-v-general-balance-posted-filter.sql`
   (`CREATE OR REPLACE VIEW` — filtre `posted` corrigé, US-139)
2. **Backfill** des lignes étrangères legacy AVANT le CHECK :
   ```bash
   npx ts-node -r dotenv/config apps/api/scripts/backfill-journal-line-fx-rate.ts
   ```
3. `docs/migrations/2026-06-07-sprint-s3bis-chk-fx-consistency.sql`
   (`CHECK chk_fx_consistency` — I1/I3/I4, US-140)
4. `docs/migrations/2026-06-07-sprint-s3bis-i5-currency-consistency-trigger.sql`
   (constraint trigger I5, US-140)

```bash
psql "$DATABASE_URL" -f docs/migrations/2026-06-07-sprint-s3bis-v-general-balance-posted-filter.sql
npx ts-node -r dotenv/config apps/api/scripts/backfill-journal-line-fx-rate.ts
psql "$DATABASE_URL" -f docs/migrations/2026-06-07-sprint-s3bis-chk-fx-consistency.sql
psql "$DATABASE_URL" -f docs/migrations/2026-06-07-sprint-s3bis-i5-currency-consistency-trigger.sql
```

**Pré-requis** : migrations S3 appliquées (colonne `fx_rate` présente).

> ⚠️ **Avant `chk_fx_consistency`** : vérifier qu'aucune ligne étrangère ne
> reste sans taux, sinon l'`ALTER ... ADD CONSTRAINT` échoue :
> ```sql
> SELECT count(*) FROM gl.journal_line WHERE currency <> 'XOF' AND fx_rate IS NULL;  -- doit être 0
> ```

**Idempotence** : vue via `CREATE OR REPLACE` ; CHECK via `DO`-block
(`IF NOT EXISTS pg_constraint`) ; trigger via `CREATE OR REPLACE FUNCTION` +
`DROP TRIGGER IF EXISTS` ; backfill ne touche que `fx_rate IS NULL`.

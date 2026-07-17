# CI/CD GRANTFLOW IPD — Migration-then-deploy

**Auteur** : El Hadj Amadou NIANG
**Date** : 02 juin 2026
**Statut** : actif

---

## Objectif

Garantir qu'**à chaque déploiement de code sur main, les migrations DDL nécessaires sont appliquées sur Neon prod AVANT que Render serve le nouveau code**. Cela évite la classe d'erreurs 500 « column does not exist » observée lors du déploiement Sprint S5.

## Pipeline retenu

GitHub Actions workflow `.github/workflows/migrate-neon.yml`.

Déclenché à chaque push sur `main` qui touche aux fichiers de schéma ou de migration :
- `docs/migrations/**`
- `docs/grantflow_ddl_postgresql.sql`
- `apps/api/scripts/**`
- `apps/api/prisma/schema.prisma`

Étapes :

1. Checkout du repo.
2. Setup Node.js 22 + install deps + `prisma generate`.
3. **Apply migrations** : lance `scripts/apply-all-migrations.ts` qui applique les 8 migrations + 2 backfills dans l'ordre correct.
4. **Trigger Render deploy** : POST sur le Deploy Hook Render (optionnel — si non configuré, Render auto-deploy gère).
5. **Sanity check** : ping `/health` 3 min après pour confirmer que l'API redéploie correctement.
6. **Notify on failure** : log clair dans l'onglet Actions, possibilité de re-déclencher manuellement.

## Configuration initiale (une seule fois)

### 1. GitHub Secret `DATABASE_URL`

1. Va sur **GitHub repo → Settings → Secrets and variables → Actions**.
2. Clique **+ New repository secret**.
3. Nom : `DATABASE_URL`
4. Valeur : le DSN Neon prod en **mode Direct** (pas Pooled).
   - Format : `postgresql://USER:PASSWORD<AT>ep-XXX.eu-central-1.aws.neon.tech/neondb?sslmode=require` (`<AT>` = arobase — placeholder neutralisé pour la règle anti-leak du repo)
   - À récupérer depuis Neon Console → Connection Details → Direct connection.
5. Clique **Add secret**.

### 2. GitHub Secret `RENDER_DEPLOY_HOOK_URL` (recommandé)

1. Va sur **Render Dashboard → grantflow-api → Settings → Deploy Hook**.
2. Clique **Generate Deploy Hook** (si pas déjà fait).
3. Copie l'URL générée (format `https://api.render.com/deploy/srv-XXX?key=YYY`).
4. Sur GitHub → **Settings → Secrets → New repository secret** :
   - Nom : `RENDER_DEPLOY_HOOK_URL`
   - Valeur : l'URL copiée.

### 3. (Recommandé) Désactiver Render auto-deploy

Pour un flux strictement séquentiel migrations → deploy :

1. Sur Render → **grantflow-api → Settings → Auto-Deploy**.
2. Décocher / mettre sur **No**.
3. Sauver.

Désormais, **seul** le GitHub Actions déclenche un deploy. Pas de race condition possible entre migration et deploy.

> Note : tu peux aussi modifier `render.yaml` pour mettre `autoDeploy: false`, mais cela demande un commit + push, ce qui déclenchera un dernier deploy auto. Préférer la modification UI.

## Comment ça fonctionne en pratique

### Cas 1 — Sprint qui touche au DDL

Tu mergues une branche `feature/sprint-s6-...` sur main qui contient :
- `docs/grantflow_ddl_postgresql.sql` modifié
- `docs/migrations/2026-XX-XX-sprint-s6-...sql` nouveau

Le workflow détecte les changements sur `docs/migrations/**`, se déclenche.

1. Applique la nouvelle migration sur Neon (idempotent — les anciennes ne re-créent rien).
2. POST sur Render deploy hook.
3. Render redéploie avec le code qui utilise les nouvelles colonnes.
4. Sanity check : `/health` retourne 200.

Total : 4-7 minutes du push au site fonctionnel.

### Cas 2 — Sprint qui ne touche pas au DDL

Tu mergues une story du type « refactor service » qui ne modifie ni migrations ni schema.prisma.

Le workflow **ne se déclenche pas** (path filter). Render auto-deploy (si encore activé) ou rien.

Pour forcer un deploy manuel : Render UI → Manual Deploy.

### Cas 3 — Migration foireuse

Le workflow échoue à l'étape « Apply migrations ». Le log Actions montre l'erreur SQL exacte (avec position et contexte).

1. Tu corriges la migration dans une nouvelle PR.
2. Tu mergues.
3. Le workflow re-tente automatiquement.
4. Si tu veux re-tenter une migration déjà committée sans nouveau push : **Actions → "Apply Neon migrations..." → Run workflow → Branche main → Run**.

## Tests préalables recommandés

Avant de pousser une migration sur main :

1. **L'appliquer sur ta DB Docker locale** :
   ```bash
   docker exec -i grantflow-postgres psql -U grantflow -d grantflow_dev \
     -f docs/migrations/<file>.sql
   ```
2. **Lancer la suite de tests** : `cd apps/api && npm test`.
3. **Vérifier le diff Prisma** : `npx prisma db pull` ne doit rien changer ou seulement refléter les nouvelles colonnes.
4. **Faire la PR + revue**.

## Maintenance

### Quand une nouvelle migration est ajoutée

Édite `apps/api/scripts/apply-all-migrations.ts` et ajoute la nouvelle migration au tableau :
- `MIGRATIONS_BEFORE_BACKFILL` si la migration peut s'appliquer sans backfill préalable.
- `MIGRATIONS_AFTER_BACKFILL` si elle introduit un CHECK qui nécessite backfill préalable.

Si une migration introduit une nouvelle colonne XOF qui doit être backfillée :
1. Ajoute un nouveau script `backfill-XYZ.ts` dans `apps/api/scripts/`.
2. L'ajoute au tableau `BACKFILL_SCRIPTS` du `apply-all-migrations.ts`.

### Si Neon change de credentials

Update le secret GitHub `DATABASE_URL`. Le workflow utilisera la nouvelle valeur dès le prochain déclenchement.

### Si tu changes d'hébergeur

Le workflow est portable. Remplace l'URL `/health` et le mécanisme Deploy Hook par l'équivalent de ton nouvel hébergeur. Le reste (migrations + backfills) ne change pas.

## Historique des décisions

- **2026-06-08** — Adoption GitHub Actions migrate-then-deploy après incident 500 sur Sprint S5 (DDL non synchronisé entre code et Neon prod).

---

*Document maintenu par El Hadj Amadou NIANG — GRANTFLOW IPD.*

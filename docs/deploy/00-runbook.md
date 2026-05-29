# Runbook déploiement cloud — GRANTFLOW IPD

> Ordre canonique pour mettre l'application en ligne depuis zéro (ou après
> un reset). Lis ce document **en entier** avant de commencer ; chaque
> étape dépend de la précédente.

## Architecture cible

```
            ┌─────────────────────────────────────┐
            │  Vercel (frontend Next.js)          │
            │  https://<URL Vercel>               │
            └────────┬─────────────────────┬──────┘
                     │ NEXT_PUBLIC_API_URL │ KEYCLOAK_ISSUER
                     ▼                     ▼
       ┌──────────────────────┐   ┌────────────────────────┐
       │ Render — API NestJS   │   │ Render — Keycloak      │
       │ /api/v1/*             │   │ /realms/grantflow/*    │
       └─┬────────┬────────┬───┘   └─────────┬──────────────┘
         │        │        │                 │
         ▼        ▼        ▼                 │
      Neon      R2     Mailtrap              │
      Postgres  S3     SMTP                  │
         ▲                                   │
         └─────── (Keycloak phase 2) ────────┘
                   (en phase 1 : disque persistant Render free)
```

## Pré-requis (déjà préparés par l'utilisateur)

- [x] **Neon** : projet créé, DDL appliqué (cf. `docs/grantflow_ddl_postgresql.sql`),
      schémas `auth/ref/gl/co/procurement/reporting/audit` vérifiés.
- [x] **R2** : bucket `grantflow-pdf` + API token (Read & Write, scope bucket, no expiration).
- [x] **Mailtrap** : inbox Sandbox + creds SMTP.
- [x] **Render** : compte connecté à GitHub repo `grantflow-ipd-skeleton`.
- [x] **Vercel** : projet importé depuis le repo, root=`apps/web`.
- [x] **Secrets locaux** générés : `NEXTAUTH_SECRET`, `KEYCLOAK_CLIENT_SECRET`,
      `KEYCLOAK_ADMIN_PASSWORD`, **clé Anthropic** rotée.

## Étapes (ordre canonique)

### 1. Push la branche `main` sur GitHub

```
git push origin main
```

Render et Vercel auto-déploient sur push (configuré via `render.yaml` et
le projet Vercel). Le `render.yaml` du repo déclenche le **Blueprint**
au premier import.

### 2. Render — Apply Blueprint

Dashboard Render → **New → Blueprint** → sélectionne le repo
`grantflow-ipd-skeleton`, branche `main`. Render lit `render.yaml` →
2 services apparaissent (`grantflow-api`, `grantflow-keycloak`) +
1 disque persistant `keycloak-data` (1 GB).

Cliquer **Apply**. Le build commence. Les services échoueront au 1er
boot (variables `sync: false` non renseignées) — c'est attendu.

### 3. Render — coller les env vars `grantflow-api`

Dashboard Render → service `grantflow-api` → Environment → coller la liste
complète depuis [render.md §3](./render.md#3-variables-denvironnement--grantflow-api).

**Variables à renseigner** :

```
DATABASE_URL              postgresql://<user>:<pass>${AT}<host>/neondb?sslmode=require&channel_binding=require
                          (récupérer dans Neon → Connection string "Pooled")
                          (composer le @ avec ${AT} dans un script, OU laisser tel
                           quel dans Render dashboard puisque ce champ n'est PAS
                           tracké dans le repo — la règle anti-leak ne s'applique
                           qu'aux fichiers du repo)
KEYCLOAK_URL              <à coller après l'étape 4 — URL publique du Keycloak Render>
KEYCLOAK_CLIENT_SECRET    <à coller après l'étape 5 — régénéré dans Keycloak admin>
ANTHROPIC_API_KEY         <ta clé rotée, format sk-ant-... (Anthropic Console)>
OCR_VISION_MODEL          <vide pour défaut interne, ou claude-sonnet-4-6>
S3_ENDPOINT               https://<accountid>.r2.cloudflarestorage.com
S3_ACCESS_KEY             <R2 Access Key ID>
S3_SECRET_KEY             <R2 Secret Access Key>
S3_BUCKET                 grantflow-pdf
SMTP_USER                 <Mailtrap inbox SMTP Username>
SMTP_PASS                 <Mailtrap inbox SMTP Password>
```

Les autres vars (OCR_PROVIDER, S3_REGION, SMTP_HOST/PORT, MAIL_FROM,
ENABLE_DEMO_INVOICE_SIMULATOR, NODE_ENV, etc.) sont déjà fixées dans
`render.yaml`. JWT_SECRET est généré automatiquement par Render.

> ⚠ KEYCLOAK_URL et KEYCLOAK_CLIENT_SECRET dépendent des étapes 4-5 —
> laisse les vides pour l'instant, l'API échouera à démarrer, c'est OK.

### 4. Render — coller les env vars `grantflow-keycloak`

Dashboard Render → service `grantflow-keycloak` → Environment → coller :

```
KEYCLOAK_ADMIN_PASSWORD   <le mot de passe que tu as généré localement>
KC_HOSTNAME               <laisse vide pour le 1er boot — voir ci-dessous>
```

Save → Render rebuild Keycloak. Quand le service est **Live** dans le
dashboard, note son URL publique (ex.
`https://grantflow-keycloak-xxxx.onrender.com`).

Re-éditer `KC_HOSTNAME` et y coller cette URL → Save → redéploiement.
Keycloak est maintenant accessible avec son hostname correct.

### 5. Premier boot Keycloak — régénérer le secret du client `grantflow-api`

Le `realm.json` contient un secret **placeholder** pour `grantflow-api`.
Le régénérer :

1. Ouvre `https://<URL Render Keycloak>` → connexion `admin` /
   `<KEYCLOAK_ADMIN_PASSWORD>`.
2. Realm `grantflow` → Clients → `grantflow-api` → **Credentials** →
   **Regenerate** → copie la valeur.
3. Retour Render → service `grantflow-api` → Environment →
   `KEYCLOAK_CLIENT_SECRET` = `<valeur copiée>`.
4. Aussi côté Render → `grantflow-api` → Environment → `KEYCLOAK_URL` =
   l'URL Render Keycloak (sans `/realms/grantflow` à la fin).
5. Save → l'API redémarre. Logs : `🚀 GRANTFLOW API running on
   http://localhost:4000/api/v1`.

### 6. Vercel — coller les env vars frontend

Dashboard Vercel → projet → Settings → Environment Variables. Coller pour
**Production** ET **Preview** :

```
NEXT_PUBLIC_API_URL          https://<URL Render API>/api/v1
NEXTAUTH_URL                 https://<URL Vercel>  (poule-œuf, voir vercel.md §2)
NEXTAUTH_SECRET              <ton secret généré localement>
KEYCLOAK_ID                  grantflow-web
KEYCLOAK_SECRET              (vide — publicClient)
KEYCLOAK_ISSUER              https://<URL Render Keycloak>/realms/grantflow
KEYCLOAK_FORCE_LOGIN_PROMPT  true
```

### 7. Vercel — redéployer

Dashboard Vercel → Deployments → triple dots sur le dernier → **Redeploy**.
Surveiller les logs jusqu'au `Compiled successfully`. Note l'URL finale
publique (`https://grantflow-ipd.vercel.app` par défaut).

### 8. Keycloak — autoriser l'URL Vercel

Retour Keycloak admin (`https://<URL Render Keycloak>`) :
- Realm `grantflow` → Clients → `grantflow-web` → Settings :
  - **Valid redirect URIs** : ajouter `https://<URL Vercel>/*`
  - **Valid post logout redirect URIs** : ajouter `https://<URL Vercel>/*`
  - **Web Origins** : ajouter `https://<URL Vercel>`
- Save.

### 9. Smoke test final

1. `https://<URL Render API>/api/v1/health` → `{ status: "ok", ts: ... }`
2. `https://<URL Render Keycloak>/realms/grantflow/.well-known/openid-configuration`
   → JSON OIDC valide
3. `https://<URL Vercel>/login` → bouton "Se connecter avec Keycloak"
4. Login avec un compte de seed (cf. `seed/users.json`) → arrivée
   dashboard, KPIs réels
5. Procurement → créer un BC → envoyer → vérifier dans Mailtrap
   (`https://mailtrap.io` → ton inbox) que l'e-mail est arrivé avec le
   PDF en pièce jointe
6. Vérifier l'écriture comptable classe 8 dans Comptabilité

## DATABASE_URL — composition

Pour respecter la règle anti-leak (`git grep` sur le pattern d'URL
Postgres avec credentials doit être vide dans les fichiers trackés —
voir le `sprintBrief` F-DEPLOY-CLOUD), aucune URL avec identifiants
incorporés n'est écrite dans le repo. Pour composer le DSN dans Render dashboard
(valeur **non trackée**), prendre tel quel le DSN affiché par Neon :

- Neon Console → Dashboard → **Connection Details** → Format `Pooled` ou
  `Unpooled`. Copier la chaîne complète qui ressemble à :
  `postgresql://neondb_owner:<pass>${AT}<host>.neon.tech/neondb?sslmode=require&channel_binding=require`
- Coller cette chaîne dans `DATABASE_URL` côté Render.

## Limites connues (free tier) — résumé

| Plateforme | Limite | Workaround |
|---|---|---|
| Render API | cold start ~30 s après 15 min d'inactivité | Acceptable démo ; `cron-job.org` ping/5min si besoin |
| Render Keycloak | KC_DB=dev-file non clusterable | OK démo. Phase 2 IPD → Postgres |
| Render disque | 1 GB max | Suffisant pour Keycloak |
| Vercel | URL `.vercel.app` (pas de domaine custom HTTPS gratuit) | OK démo jury |
| Neon | 0.5 GB stockage / 191 h compute/mois | Suffisant pour démo |
| R2 | 10 GB stockage / 10M Class A ops/mois | Largement suffisant |
| Mailtrap Sandbox | inbox 100 emails/mois (free) | Suffisant pour démo |

## Phase 2 — migration vers serveur IPD

Quand le DAF IPD provisionne un serveur dédié, voir
[migration-to-ipd-cloud.md](./migration-to-ipd-cloud.md) pour la liste
exacte des changements (essentiellement : `DATABASE_URL`, `KEYCLOAK_ISSUER`,
`KEYCLOAK_URL`, `NEXT_PUBLIC_API_URL` et `NEXTAUTH_URL` à pointer sur les
nouveaux hostnames). Les images Docker sont déjà prêtes (Lot A).

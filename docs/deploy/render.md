# Déploiement Render — GRANTFLOW IPD

> Render héberge **l'API NestJS** et **Keycloak**. Le frontend Next.js est
> hébergé sur Vercel (cf. [vercel.md](./vercel.md)). Suivre d'abord le
> [runbook 00](./00-runbook.md) pour l'ordre canonique entre les plateformes.

## 1. Pré-requis

- Compte Render gratuit connecté à GitHub.
- Repo `grantflow-ipd-skeleton` accessible par Render (organisation autorisée).
- Côté utilisateur, déjà disponibles :
  - **Neon** : DSN Postgres avec DDL appliqué (cf. `docs/grantflow_ddl_postgresql.sql`).
  - **Cloudflare R2** : bucket + API token (Read & Write, scope bucket).
  - **Mailtrap Sandbox** : creds SMTP de l'inbox.
  - **Anthropic API key** rotée (rappel : aucune clé dans le repo).
  - Secrets locaux générés : `NEXTAUTH_SECRET`, `KEYCLOAK_CLIENT_SECRET`,
    `KEYCLOAK_ADMIN_PASSWORD`.

## 2. Apply Blueprint

Render détecte automatiquement le fichier `render.yaml` à la racine du repo
et propose de provisionner les 2 services (`grantflow-api` + `grantflow-keycloak`).

1. Sur Render dashboard → **New → Blueprint**.
2. Sélectionner le repo `grantflow-ipd-skeleton` et la branche `main`.
3. Render lit `render.yaml` → 2 services apparaissent dans l'aperçu, plus
   un disque persistant `keycloak-data` de 1 GB pour Keycloak.
4. Cliquer **Apply** — Render commence à build les 2 images Docker.
   ⚠ Les services vont **échouer au premier boot** parce que les
   variables `sync: false` ne sont pas encore renseignées. C'est normal.

## 3. Variables d'environnement — `grantflow-api`

Dashboard Render → service `grantflow-api` → **Environment** → coller :

| Variable | Source / Valeur |
|---|---|
| `DATABASE_URL` | Neon dashboard → Connection string (mode "Pooled") |
| `KEYCLOAK_URL` | URL publique de `grantflow-keycloak` (à coller APRÈS son 1er boot, étape 5) |
| `KEYCLOAK_CLIENT_SECRET` | La valeur que tu as générée localement (PAS le placeholder du repo) |
| `ANTHROPIC_API_KEY` | Clé rotée (format `sk-ant-…`, voir Anthropic Console → API Keys) |
| `OCR_VISION_MODEL` | Vide (= défaut interne `claude-sonnet-4-6`) ou ID Sonnet récent |
| `S3_ENDPOINT` | `https://<accountid>.r2.cloudflarestorage.com` — Cloudflare R2 → API Tokens → S3 endpoint |
| `S3_ACCESS_KEY` | Access Key ID R2 |
| `S3_SECRET_KEY` | Secret Access Key R2 |
| `S3_BUCKET` | `grantflow-pdf` (le bucket que tu as créé sur R2) |
| `SMTP_USER` | Mailtrap inbox → SMTP Settings → Username |
| `SMTP_PASS` | Mailtrap inbox → SMTP Settings → Password |

Les autres variables ont des valeurs par défaut dans `render.yaml`
(`OCR_PROVIDER=auto`, `S3_REGION=auto`, `SMTP_HOST=sandbox.smtp.mailtrap.io`,
`SMTP_PORT=2525`, `ENABLE_DEMO_INVOICE_SIMULATOR=true`, etc.). Le port `4000`
est exposé via `$PORT` Render automatiquement.

> 💡 Cliquer **Save changes** → Render redéploie. Surveiller les logs
> jusqu'au message `🚀 GRANTFLOW API running on http://localhost:4000/api/v1`.

## 4. Variables d'environnement — `grantflow-keycloak`

Dashboard Render → service `grantflow-keycloak` → **Environment** :

| Variable | Source / Valeur |
|---|---|
| `KEYCLOAK_ADMIN_PASSWORD` | Le mot de passe que tu as généré localement |
| `KC_HOSTNAME` | URL publique du service (visible après le 1er build dans le dashboard, ex. `https://grantflow-keycloak-XXXX.onrender.com`) |

Astuce ordre :
1. Première fois : laisse `KC_HOSTNAME` vide → Render build l'image →
   le service obtient son URL `https://grantflow-keycloak-XXXX.onrender.com`.
2. Copie cette URL → colle-la dans `KC_HOSTNAME` → **Save changes** →
   Keycloak redémarre proprement avec son hostname.
3. Récupère cette même URL pour la coller dans `KEYCLOAK_URL` de
   `grantflow-api` (étape 3).

## 5. Premier boot Keycloak — secret du client `grantflow-api`

Le `realm.json` du repo contient un secret **placeholder**
(`grantflow-api-dev-secret-2026`) pour le client `grantflow-api`. Ce secret
n'est pas utilisable en cloud — il faut le **régénérer** côté Keycloak :

1. Ouvrir `https://grantflow-keycloak-XXXX.onrender.com` → connexion
   `admin` / `<KEYCLOAK_ADMIN_PASSWORD>`.
2. Realm `grantflow` → Clients → `grantflow-api` → **Credentials** →
   **Regenerate** → copier la valeur.
3. Coller cette valeur dans `KEYCLOAK_CLIENT_SECRET` du service
   `grantflow-api` côté Render → Save → l'API redémarre.

Idem pour le client `grantflow-web` (si confidential dans ta config) — mais
par défaut `grantflow-web` est `publicClient: true` dans le realm.json, donc
pas de secret à régénérer pour lui.

## 6. Mise à jour des URLs autorisées dans Keycloak

Toujours dans l'admin Keycloak :

- Realm `grantflow` → Clients → `grantflow-web` → **Settings** :
  - **Valid redirect URIs** : ajouter `https://<URL Vercel>/*`
    (ex. `https://grantflow-ipd.vercel.app/*`).
  - **Valid post logout redirect URIs** : ajouter `https://<URL Vercel>/*`.
  - **Web Origins** : ajouter `https://<URL Vercel>`.
- Save.

Ces URIs sont déjà documentées avec valeurs `localhost:3000` dans le
`realm.json` du repo (pour le dev). En cloud, on **ajoute** l'URL Vercel
en parallèle (on ne remplace pas — on garde les valeurs locales pour
permettre le dev en // de la prod cloud).

## 7. Vérifications finales

- `https://<URL Render api>/api/v1/health` → renvoie `{ status: "ok", ts: ... }`
- `https://<URL Render keycloak>/realms/grantflow/.well-known/openid-configuration`
  → renvoie le JSON OIDC du realm
- Logs Render `grantflow-api` : pas d'erreur Prisma (connexion Neon OK)
- Logs Render `grantflow-keycloak` : `Keycloak ... started in ...` + import
  realm `grantflow` réussi

## 8. Limitations free-tier connues

| Limite | Impact | Workaround |
|---|---|---|
| Render free : services s'éteignent après 15 min d'inactivité | 1er appel froid = ~30 s de cold start | Acceptable pour démo jury ; cron-job.org peut keep-alive si besoin |
| Render free : 750 h/mois cumulées | Suffisant pour 1 API + 1 Keycloak en démo | Surveiller le compteur |
| Keycloak `KC_DB=dev-file` | Pas clusterable, perfs limitées | OK pour démo. Migrer vers Postgres en phase 2 IPD |
| Disque persistant Render free : 1 GB | Suffisant pour Keycloak + ses sessions | Surveiller la croissance |

Pour la phase 2 (serveur IPD), voir [migration-to-ipd-cloud.md](./migration-to-ipd-cloud.md).

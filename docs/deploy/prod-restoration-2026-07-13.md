# Restauration prod GRANTFLOW IPD — 2026-07-13

> **RÉSOLU le 2026-07-13** : prod restaurée E2E (grantflow-api Live +
> grantflow-keycloak Live + UptimeRobot 100 % + rotation password Neon).
> **URL API actuelle** : `https://grantflow-api-udmd.onrender.com` (Frankfurt,
> migration 2026-07 — historique des suffixes : `kqmv` → `cvde` → `udmd`).
> Keycloak : `https://grantflow-keycloak.onrender.com` (nom libéré, sans
> suffixe). Mettre à jour tout outillage qui code l'URL en dur — les scripts
> `prod-health-check.*` / `warmup-*` acceptent des overrides par env.
> **Complément 2026-07-16** : le dernier résidu (crash NextAuth
> « Configuration » sur Vercel, bug 5 du post-mortem) est **RÉSOLU** —
> login E2E Vercel→Keycloak→app confirmé. Cascade entièrement soldée.

> Post-mortem + procédure de restauration après ~2 mois d'inactivité.
> **Actions dashboard (Render / Neon / Vercel / Cloudflare / UptimeRobot) =
> manuelles (user).** Claude Code fournit les valeurs exactes ; il n'a pas
> accès à ces dashboards.

---

## 1. Post-mortem (symptômes → cause racine)

| # | Symptôme | Cause racine | Fix |
|---|---|---|---|
| 1 | Render `grantflow-api` : deploy failed (Exited status 1), `TypeError: Configuration key "KEYCLOAK_URL" does not exist` | Variables 🔴 BOOT perdues sur le service → `JwtStrategy` (getOrThrow) crashe au démarrage | Re-saisie des vars (§2) |
| 2 | `StorageService` boot en `dev-multi-bucket`, endPoint=localhost | Tous les `S3_*` supprimés (debug R2 antérieur) → fallback MinIO | Différé (§5, upload BC KO assumé) |
| 3 | UptimeRobot ne ping plus | Monitors auto-pausés après N échecs consécutifs (service down) | Resume + URLs mises à jour (§4) |
| 4 | Neon lente / injoignable au 1er accès | Free tier suspendu après inactivité → réveil au 1er `DATABASE_URL` | `SELECT 1;` + rotation password |
| 5 | Vercel : crash NextAuth « Configuration » au login (**résolu 2026-07-16**) | Keycloak derrière le proxy Render (terminaison TLS) générait un **issuer `http://`** dans son discovery OIDC → mismatch strict avec le `KEYCLOAK_ISSUER` `https://` configuré côté Vercel → NextAuth refuse la configuration | `KC_PROXY_HEADERS=xforwarded` (déclaré dans render.yaml depuis US-142) + `KC_HOSTNAME_STRICT_HTTPS` sur `grantflow-keycloak` → issuer https cohérent. Login E2E Vercel→Keycloak→app confirmé |

**Cause première** : perte des variables d'environnement 🔴 BOOT sur
`grantflow-api` (KEYCLOAK_*, DATABASE_URL) + 🟠 `WEB_ORIGIN` ; aggravée par la
recréation du service Keycloak **sans** les réglages proxy (bug 5 — l'issuer
OIDC dépend des en-têtes `X-Forwarded-*`, invisibles tant qu'on ne teste pas
le login de bout en bout).

> `KC_HOSTNAME_STRICT_HTTPS="true"` est déclaré dans `render.yaml` (parité
> Blueprint faite) et couvert par `scripts/check-render-env-parity.sh`.

**Prévention future** : `render.yaml` (Blueprint) redéclare les clés, mais les
valeurs `sync:false` doivent être re-saisies au dashboard. Envisager un
**Environment Group** Render partagé + un export chiffré des secrets (Doppler/
Vault) pour reconstruire en < 5 min. Garder `env-vars-inventory.md` à jour.

---

## 2. CHECKLIST restauration Render — `grantflow-api` (ACTION USER)

> Dashboard Render → service **grantflow-api** → onglet **Environment**.
> Réveiller Neon d'abord (étape 0) sinon le 1er boot peut timeout.

**Étape 0 — Réveiller Neon** : dashboard Neon → projet GRANTFLOW → ouvrir le
SQL Editor et lancer `SELECT 1;` (réveille le compute suspendu). Récupérer la
**Connection string pooled** (bouton *Connect* → *Pooled connection*).

**Étape 1 — Vérifier l'Environment Group** : si un Environment Group est lié au
service (onglet Environment → *Linked Environment Groups*), vérifier qu'il est
bien attaché ; sinon saisir les variables directement sur le service.

**Étape 2 — Saisir/rétablir les variables (ordre recommandé)** :

| # | Key | Valeur à saisir | Provenance |
|---|---|---|---|
| 1 | `DATABASE_URL` | `postgresql://<user>:<pass>@<host>/<db>?sslmode=require` | **Neon dashboard → Connect → Pooled** |
| 2 | `KEYCLOAK_URL` | `https://grantflow-keycloak-<suffix>.onrender.com` | **URL Render du service grantflow-keycloak** (onglet du service KC) |
| 3 | `KEYCLOAK_REALM` | `grantflow` | en dur (documenté) |
| 4 | `KEYCLOAK_CLIENT_ID` | `grantflow-api` | en dur (documenté) |
| 5 | `KEYCLOAK_CLIENT_SECRET` | `<secret>` | **Keycloak admin → Clients → grantflow-api → Credentials → Client secret** |
| 6 | `WEB_ORIGIN` | `https://<front>.vercel.app` | **URL Vercel du front** (⚠ non déclarée dans render.yaml — à ajouter à la main) |
| 7 | `NODE_ENV` | `production` | en dur |
| 8 | `TIMEZONE` | `Africa/Dakar` | en dur |
| 9 | `DEFAULT_CURRENCY` | `XOF` | en dur |
| 10 | `DEFAULT_LOCALE` | `fr` | en dur |
| 11 | `OCR_PROVIDER` | `pdfparse` | en dur (mettre `auto` seulement si ANTHROPIC_API_KEY fourni) |
| 12 | `ENABLE_DEMO_INVOICE_SIMULATOR` | `true` | env démo |

**Étape 3 — S3_\* : VOLONTAIREMENT OMIS À CE STADE.** Ne PAS saisir S3_ENDPOINT/
S3_ACCESS_KEY/S3_SECRET_KEY/S3_BUCKET/S3_REGION maintenant. L'API bootera en
mode `dev-multi-bucket` (MinIO local) : **l'upload PDF de BC sera KO**, mais
login, DA, BC, factures (hors PDF), compta et reporting fonctionnent. À
restaurer **après** validation R2 (`scripts/test-r2-credentials.ts`).

**Étape 4 — Déclencher un redeploy** : *Manual Deploy → Clear build cache &
deploy* (ou push). Suivre les logs : le boot doit passer la ligne
`storage client init` sans crash et afficher `Nest application successfully
started`.

### 2bis. Si `grantflow-keycloak` a aussi perdu ses variables

Service **grantflow-keycloak** → Environment (cf. `render.yaml` 99-139) :
`KEYCLOAK_ADMIN_PASSWORD` (secret), `KC_HOSTNAME` (= URL publique du service KC,
sans `https://`), `KC_DB_URL` (JDBC Neon, ex.
`jdbc:postgresql://<host>/<db>?sslmode=require`), `KC_DB_USERNAME`,
`KC_DB_PASSWORD` (rôle+password Neon). En dur : `KC_DB=postgres`,
`KC_HEALTH_ENABLED=true`, `KC_HTTP_ENABLED=true`, `KC_HTTP_PORT=8080`,
`KEYCLOAK_ADMIN=admin`.

> **CHECKPOINT 1** — Restaurer les variables ci-dessus + redeploy, puis passer
> à la Phase 3 (health-check). Confirmer avant de continuer.

---

## 3. Vérification post-restauration (Phase 3)

Exécuter le script fourni depuis un poste avec accès internet :

```bash
# bash (WSL / Git Bash / Linux / macOS)
API_URL=https://grantflow-api-<suffix>.onrender.com \
KC_URL=https://grantflow-keycloak-<suffix>.onrender.com \
  scripts/prod-health-check.sh
```
```powershell
# PowerShell (Windows)
$env:API_URL="https://grantflow-api-<suffix>.onrender.com"
$env:KC_URL="https://grantflow-keycloak-<suffix>.onrender.com"
scripts\prod-health-check.ps1
```

Attendu : tous les `[OK]`. Le 1er run peut être lent (cold start Render + réveil
Neon) — relancer après 60-90 s si timeout.

> **CHECKPOINT 2** — Confirmer la sortie du health-check avant Phase 4.

---

## 4. Réactivation UptimeRobot (Phase 4)

> Le keep-alive (cf. `docs/deploy/keep-alive.md`) empêche les cold starts ;
> après 2 mois de fails, les monitors sont probablement en pause.

1. Se connecter au **dashboard UptimeRobot**.
2. Vérifier le statut des **2 monitors** : `grantflow-api` et `grantflow-keycloak`.
3. Si **Paused** (auto-pause après trop d'échecs) → **Resume**.
4. **Vérifier l'URL de chaque monitor** : si un service Render a été **recréé**,
   son URL `*.onrender.com` a changé → mettre à jour l'URL du monitor
   (cibler `…/api/v1/health` pour l'API, `…/health/ready` pour Keycloak).
5. Intervalle : 5 min (free tier). Attendre **~15 min** et vérifier l'état
   **Up** (vert) sur les 2 monitors.

> **CHECKPOINT 3** — Monitors Up confirmés → prod stable → reprise Sprint S6
> (US-055).

---

## 5. Restauration R2 — **RÉSOLU le 2026-07-17** (US-143 fermée)

> **Fait** : `S3_ENDPOINT/S3_ACCESS_KEY/S3_SECRET_KEY/S3_BUCKET` +
> `S3_REGION=auto` restaurés sur `grantflow-api`, boot en
> `mode: cloud-single-bucket`, upload vérifié en prod (log `object uploaded`
> à l'envoi du BC-2026-0001 vers R2). **Cause racine historique** du debug R2 :
> corruption presse-papier lors des copies de tokens (les credentials
> semblaient invalides alors qu'ils étaient corrompus à la saisie).
>
> **Conséquence résiduelle** : les factures/BC capturés PENDANT la fenêtre
> sans stockage (dont FAC-SIM-BC-2026-0002-1) n'ont pas d'objet R2 →
> l'aperçu affiche « Aucun document archivé » (404
> `BUSINESS.DOCUMENT_NOT_FOUND`, US-069) — comportement attendu et définitif.

Procédure de référence si un service est recréé :
1. `scripts/test-r2-credentials.ts` avec les credentials R2 (putObject réel).
2. Si OK → saisir `S3_ENDPOINT/S3_ACCESS_KEY/S3_SECRET_KEY/S3_BUCKET` +
   `S3_REGION=auto` sur `grantflow-api` → redeploy. Le boot doit alors afficher
   `mode: cloud-single-bucket`. ⚠️ Coller les tokens depuis un éditeur texte
   intermédiaire (piège presse-papier ci-dessus).

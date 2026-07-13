# Inventaire des variables d'environnement API — GRANTFLOW IPD

> Recensement exhaustif des variables lues par `apps/api/src/**` (via
> `ConfigService.get / getOrThrow` et `process.env`), croisé avec
> `.env.example`, `render.yaml` et `docker-compose.yml`.
> **But** : restauration fiable de la prod Render après perte des variables.
> _Dernière mise à jour : 2026-07-13._

## Légende « Requis boot ? »
- **🔴 BOOT-CRITIQUE** : lu via `getOrThrow` au **constructeur** d'un provider
  (ou par Prisma à l'init). Absent → `TypeError: Configuration key "X" does not
  exist` → **deploy failed (Exited status 1)**. C'est la cause du crash actuel.
- **🟠 FONCTIONNEL** : a un défaut, ne crashe pas le boot, mais casse une
  fonction clé en prod (ex. CORS, login cross-origin).
- **🟢 OPTIONNEL** : défaut sain, dégradation gracieuse.

## Tableau

| Key | Requis boot ? | Valeur dev | Source prod | Fichier référence |
|---|---|---|---|---|
| `KEYCLOAK_URL` | 🔴 BOOT | `http://localhost:8080` | **à restaurer** (URL Render du service `grantflow-keycloak`) | jwt.strategy.ts:31, keycloak-admin.service.ts:72 |
| `KEYCLOAK_REALM` | 🔴 BOOT | `grantflow` | à saisir en dur : `grantflow` | jwt.strategy.ts:32, keycloak-admin.service.ts:73 |
| `KEYCLOAK_CLIENT_ID` | 🔴 BOOT | `grantflow-api` | à saisir en dur : `grantflow-api` | jwt.strategy.ts:33, keycloak-admin.service.ts:74 |
| `KEYCLOAK_CLIENT_SECRET` | 🔴 BOOT | `grantflow-api-dev-secret-2026` | **secret** — Keycloak admin → clients → grantflow-api → Credentials | keycloak-admin.service.ts:75 |
| `DATABASE_URL` | 🔴 BOOT (Prisma) | (composée depuis POSTGRES_*) | **secret** — Neon dashboard → Connection string (pooled) | prisma/schema.prisma:8 |
| `WEB_ORIGIN` | 🟠 FONCTIONNEL | `http://localhost:3000` (défaut) | **à restaurer** (URL Vercel du front, ex. `https://grantflow-ipd.vercel.app`) — **absent de render.yaml** | main.ts:43 (CORS) |
| `KEYCLOAK_CLIENT_SECRET` (Admin REST) | 🔴 (idem ci-dessus) | — | même variable, réutilisée pour l'Admin API | keycloak-admin.service.ts:75 |
| `NODE_ENV` | 🟢 | `development` | `production` | render.yaml:85 |
| `API_PORT` / `PORT` | 🟢 | `4000` | `4000` (Render injecte `PORT`) | main.ts:70 |
| `TIMEZONE` | 🟢 | `Africa/Dakar` | `Africa/Dakar` | render.yaml:90 |
| `DEFAULT_CURRENCY` | 🟢 | `XOF` | `XOF` | render.yaml:92 |
| `DEFAULT_LOCALE` | 🟢 | `fr` | `fr` | render.yaml:94 |
| `S3_ENDPOINT` | 🟢 (voir note) | vide | **secret R2** (`https://<acct>.r2.cloudflarestorage.com`) — **volontairement omis à ce stade** | storage.service.ts:69 |
| `S3_ACCESS_KEY` | 🟢 | vide | **secret R2** — omis | storage.service.ts:95 |
| `S3_SECRET_KEY` | 🟢 | vide | **secret R2** — omis | storage.service.ts:99 |
| `S3_REGION` | 🟢 | `us-east-1` (défaut) | `auto` (R2) | storage.service.ts:104 |
| `S3_BUCKET` | 🟢 | vide | `grantflow-pdf` — omis | storage.service.ts:116 |
| `MINIO_HOST/PORT/USE_SSL/ACCESS_KEY/SECRET_KEY` | 🟢 | MinIO local | non requis en prod (fallback si S3_* absent) | storage.service.ts:89-100 |
| `OCR_PROVIDER` | 🟢 | `pdfparse` | `auto` (render.yaml) → nécessite ANTHROPIC_API_KEY sinon retombe sur pdfparse | ocr.service.ts:50, invoicing.module.ts:29 |
| `ANTHROPIC_API_KEY` | 🟢 | vide | **secret** (requis seulement si OCR vision) | invoicing.module.ts:30, claude-vision-ocr.provider.ts:128 |
| `OCR_VISION_MODEL` | 🟢 | vide (défaut interne) | vide | claude-vision-ocr.provider.ts:143 |
| `OCR_VISION_FALLBACK_THRESHOLD` | 🟢 | `50` | `50` | ocr.service.ts:53 |
| `OCR_VISION_MAX_BYTES` | 🟢 | `5242880` | `5242880` | claude-vision-ocr.provider.ts:146 |
| `SMTP_HOST/PORT/SECURE` | 🟢 | MailHog `localhost:1025` | Mailtrap `sandbox.smtp.mailtrap.io:2525` | mail.service.ts:50-60 |
| `SMTP_USER` / `SMTP_PASS` | 🟢 | vide | **secret Mailtrap** | mail.service.ts:52-53 |
| `MAIL_FROM` | 🟢 | défaut interne | `GRANTFLOW IPD <no-reply@grantflow.demo>` | mail.service.ts:54 |
| `ENABLE_DEMO_INVOICE_SIMULATOR` | 🟢 | `false` | `true` (env démo) | (process.env) invoice-sim |
| `INVOICE_MATCH_PRICE_TOLERANCE_PCT` | 🟢 | `2.0` | défaut | matching.service.ts:78 |
| `INVOICE_MATCH_QTY_TOLERANCE_PCT` | 🟢 | `5.0` | défaut | matching.service.ts:82 |
| `JWT_SECRET` | 🟢 (legacy) | placeholder | non utilisé par la validation JWT (JWKS Keycloak) — conservé pour compat | .env.example:113 |

## Synthèse restauration

**5 variables 🔴 BOOT-CRITIQUES** (sans elles, l'API ne démarre pas) :
`KEYCLOAK_URL`, `KEYCLOAK_REALM`, `KEYCLOAK_CLIENT_ID`, `KEYCLOAK_CLIENT_SECRET`, `DATABASE_URL`.

**1 variable 🟠 FONCTIONNELLE** indispensable au login cross-origin :
`WEB_ORIGIN` (⚠ absente de `render.yaml` — bien penser à la saisir à la main,
sinon CORS bloque le front Vercel même si l'API boote).

**Bloc S3_\* volontairement omis** à ce stade (cf. debug R2) → l'API démarre en
mode `dev-multi-bucket` (endPoint=localhost). Conséquence : **upload PDF de BC
KO**, tout le reste fonctionne. À restaurer après validation R2
(cf. `scripts/test-r2-credentials.ts`).

**Keycloak** (service séparé) : ses variables (`KC_DB_URL`, `KC_DB_USERNAME`,
`KC_DB_PASSWORD`, `KC_HOSTNAME`, `KEYCLOAK_ADMIN_PASSWORD`) sont aussi
`sync:false` — à restaurer si le service Keycloak a lui aussi perdu ses vars
(cf. `render.yaml` lignes 99-139).

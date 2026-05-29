# Phase 2 — migration vers le cloud IPD (serveur DAF)

> Note de transition pour quand le DAF de l'Institut Pasteur de Dakar
> provisionne un serveur dédié et que GRANTFLOW IPD sort du free tier
> Render/Vercel pour s'auto-héberger.

## Architecture cible (phase 2)

```
                ┌──────────────────────────┐
                │  Serveur IPD (Docker)    │
                │  docker compose up -d    │
                ├──────────────────────────┤
                │  Reverse proxy (Caddy /  │
                │  Traefik)                │
                │   ↓                      │
                │  grantflow-web    :3000  │
                │  grantflow-api    :4000  │
                │  keycloak         :8080  │
                │  postgres         :5432  │
                │  minio            :9000  │  (ou R2 conservé)
                │  redis            :6379  │
                │  mailhog/postfix  :25    │
                └──────────────────────────┘
```

## Ce qui est déjà prêt côté repo

- **`apps/api/Dockerfile`** : image API production-ready, identique en
  phase 1 (Render) et phase 2 (serveur IPD).
- **`apps/web/Dockerfile`** : image Web Next.js standalone, à utiliser en
  phase 2 (Vercel est ignoré, le serveur IPD sert tout).
- **`docker/keycloak/Dockerfile.cloud`** : image Keycloak avec realm.json
  embarqué, réutilisable.
- **`docker-compose.yml`** : la base existe déjà pour le dev. Une version
  `docker-compose.prod.yml` reste à écrire (PR séparée — hors-scope sprint
  F-DEPLOY-CLOUD).

## Ce qui change

L'essentiel des changements porte sur les **variables d'environnement** —
les images sont les mêmes.

| Variable | Phase 1 (Render+Vercel+Neon+R2) | Phase 2 (serveur IPD) |
|---|---|---|
| `DATABASE_URL` | `…@neon.tech/neondb?sslmode=require` | `…@postgres:5432/grantflow_prod` (Postgres local du compose) |
| `KEYCLOAK_URL` | `https://grantflow-keycloak-xxx.onrender.com` | `https://auth.grantflow.pasteur.sn` (sous-domaine IPD) |
| `KEYCLOAK_ISSUER` | `https://...onrender.com/realms/grantflow` | `https://auth.grantflow.pasteur.sn/realms/grantflow` |
| `NEXT_PUBLIC_API_URL` | `https://grantflow-api-xxx.onrender.com/api/v1` | `https://api.grantflow.pasteur.sn/api/v1` |
| `NEXTAUTH_URL` | `https://grantflow-ipd.vercel.app` | `https://grantflow.pasteur.sn` |
| `S3_ENDPOINT` | `https://<acc>.r2.cloudflarestorage.com` | Option A : conserver R2 (recommandé — bandwidth IPD préservée). Option B : MinIO interne (`http://minio:9000`). |
| `S3_BUCKET` | `grantflow-pdf` (single bucket) | Idem (R2) OU pluri-bucket en repassant à MINIO_* (le code accepte les 2 modes). |
| `SMTP_HOST` | `sandbox.smtp.mailtrap.io` | SMTP IPD (Postfix interne ou relai O365) |
| `KC_DB` | `dev-file` (Render free) | `postgres` (DB dédiée pour Keycloak — séparée de grantflow_prod) |

## Procédure de bascule

1. **Provisionner** le serveur IPD (Linux + Docker installés).
2. **DDL** : initialiser la base Postgres avec `docs/grantflow_ddl_postgresql.sql`
   (DDL-first, cf. CLAUDE.md §9).
3. **Dump Neon → Postgres IPD** : `pg_dump` depuis Neon, `pg_restore` dans
   la nouvelle base. Préserver les données de démo si pertinent.
4. **Migration Keycloak** : exporter le realm depuis Render Keycloak
   (admin console → Export) → importer dans Keycloak IPD au démarrage
   (`--import-realm` reste utilisable, mais avec un fichier exporté
   contenant les vrais users créés en démo).
5. **R2 → optionnel migration MinIO** : si on quitte R2, `rclone copy`
   du bucket vers MinIO local. Garder R2 reste tout aussi valide (R2
   est S3-compatible et son free tier suffit largement à IPD).
6. **DNS** : créer `grantflow.pasteur.sn`, `api.grantflow.pasteur.sn`,
   `auth.grantflow.pasteur.sn` pointant sur l'IP serveur IPD. Caddy /
   Traefik gère les certificats TLS automatiques (Let's Encrypt).
7. **`docker compose up -d`** avec les images déjà publiées (build
   pipeline en CI ou `docker build` direct).
8. **Smoke test** identique au runbook §9.
9. **Bascule DNS** : couper Vercel / Render (économies free tier).

## Rollback

Tant que les services Render+Vercel restent provisionnés (même éteints),
on peut basculer le DNS dans l'autre sens en quelques minutes. Les
volumes Neon/R2 restent intacts.

## Coûts estimés (phase 2 IPD)

| Élément | Coût mensuel approximatif |
|---|---|
| Serveur 4 vCPU / 8 GB RAM (IPD interne ou OVH) | 0–50 € (selon le canal) |
| Domaine `*.pasteur.sn` | Déjà payé par IPD |
| R2 (si conservé, ce qui est recommandé) | 0 € (free tier 10 GB) |
| Sauvegardes Postgres → S3 | <5 € |
| **Total** | **< 60 €/mois** |

À comparer aux coûts SaaS comparables (NetSuite, Sage Cloud) qui démarrent
à plusieurs centaines d'euros par utilisateur et par mois.

---

_Document de prévision. À détailler quand la décision de provisionner
le serveur IPD sera prise._

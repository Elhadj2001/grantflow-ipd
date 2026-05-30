# =====================================================================
#  GRANTFLOW IPD — Dockerfile API (NestJS) — production cloud
#  Sprint F-DEPLOY-CLOUD Lot A
# =====================================================================
#
# Build multi-stage pour minimiser l'image finale :
#   1. deps    : installe TOUTES les deps (devDeps inclus) — nécessaire
#                pour @nestjs/cli et tsc pendant le build.
#   2. build   : compile NestJS + génère le client Prisma (binaires
#                inclus dans la couche).
#   3. runtime : node:alpine slim, copie dist + node_modules pruned,
#                user non-root, EXPOSE 4000, HEALTHCHECK /health.
#
# NOTE IMPORTANTE — la BD est gérée HORS-BANDE (DDL-first, cf. CLAUDE.md §9).
# Ce Dockerfile NE LANCE NI prisma migrate NI le DDL au démarrage : ces
# scripts ont déjà été appliqués sur Neon par l'utilisateur. Modifier
# le schéma = appliquer le DDL manuellement puis re-déployer cette image.
#
# Build depuis la racine du monorepo (pas depuis apps/api) :
#   docker build -f apps/api/Dockerfile -t grantflow-api .

# ---------------------------------------------------------------------
# Stage 1 : deps (installation complète, cache npm)
# ---------------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app

# OpenSSL est requis par le query engine Prisma (alpine ne l'a pas par défaut).
RUN apk add --no-cache openssl libc6-compat

# On copie d'abord les manifests pour profiter du cache Docker quand
# le code change mais pas les dépendances.
COPY package.json package-lock.json* ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/

# Install ALL deps (workspaces) — devDeps inclus pour le build TS.
# `prisma generate` du postinstall échouerait sans schema.prisma — on
# le neutralise avec || true (déjà géré dans le script du package.json).
RUN npm ci --include=dev

# ---------------------------------------------------------------------
# Stage 2 : build (compile NestJS + génère client Prisma)
# ---------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

RUN apk add --no-cache openssl libc6-compat

# Récupère node_modules de l'étape deps.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules

# Copie le code source nécessaire au build.
COPY package.json package-lock.json* ./
COPY tsconfig*.json ./
COPY packages ./packages
COPY apps/api ./apps/api

# Génère le client Prisma (les binaires query_engine vont dans node_modules/.prisma).
# Puis compile NestJS → dist/.
WORKDIR /app/apps/api
RUN npx prisma generate \
 && npm run build

# Prune devDeps pour la couche runtime — on conserve uniquement les deps
# de production dans /app/node_modules.
WORKDIR /app
RUN npm prune --omit=dev --workspaces --include-workspace-root

# ---------------------------------------------------------------------
# Stage 3 : runtime (image finale, minimale)
# ---------------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app

# OpenSSL pour Prisma query engine + curl pour le HEALTHCHECK.
RUN apk add --no-cache openssl libc6-compat curl tini \
 && addgroup -S grantflow \
 && adduser -S -G grantflow grantflow

ENV NODE_ENV=production \
    PORT=4000

# Code compilé + manifests + node_modules production-only + client Prisma.
COPY --from=build --chown=grantflow:grantflow /app/node_modules ./node_modules
COPY --from=build --chown=grantflow:grantflow /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build --chown=grantflow:grantflow /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=grantflow:grantflow /app/apps/api/package.json ./apps/api/
COPY --from=build --chown=grantflow:grantflow /app/apps/api/prisma ./apps/api/prisma
COPY --from=build --chown=grantflow:grantflow /app/package.json ./

USER grantflow

EXPOSE 4000

# Healthcheck : /health renvoie 200 + { status: 'ok' } (cf. HealthModule).
# Render lit healthCheckPath dans render.yaml mais le HEALTHCHECK Docker
# reste utile pour Docker compose / Kubernetes / Coolify.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${PORT}/api/v1/health || exit 1

# tini gère SIGTERM proprement (graceful shutdown Nest).
ENTRYPOINT ["/sbin/tini", "--"]
# `nest build` sans tsconfig.build.json (rootDir forcé) produit dist/src/main.js
# (et non dist/main.js). On pointe le CMD au bon endroit.
CMD ["node", "apps/api/dist/src/main.js"]

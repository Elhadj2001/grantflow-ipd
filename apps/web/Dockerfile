# =====================================================================
#  GRANTFLOW IPD — Dockerfile Web (Next.js) — phase 2 (cloud IPD)
#  Sprint F-DEPLOY-CLOUD Lot A
# =====================================================================
#
# Optionnel pour le déploiement Vercel courant (Vercel utilise son propre
# pipeline). Utile pour :
#   - Phase 2 : migration vers le serveur Docker du DAF IPD.
#   - Smoke tests locaux du build standalone.
#
# Multi-stage avec next.config.js `output: 'standalone'` → image finale
# ~150 Mo (vs ~1 Go sans standalone).
#
# Build depuis la racine du monorepo :
#   docker build -f apps/web/Dockerfile -t grantflow-web .

# ---------------------------------------------------------------------
# Stage 1 : deps (install complet pour build)
# ---------------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app

RUN apk add --no-cache libc6-compat

COPY package.json package-lock.json* ./
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/

RUN npm ci --include=dev

# ---------------------------------------------------------------------
# Stage 2 : build (Next.js standalone)
# ---------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

RUN apk add --no-cache libc6-compat

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules

COPY package.json package-lock.json* ./
COPY tsconfig*.json ./
COPY packages ./packages
COPY apps/web ./apps/web

# Variables PUBLIC_* nécessaires au build doivent être injectées au moment
# du `docker build` via --build-arg (Vercel les injecte automatiquement
# depuis ses env vars ; Render via les build-args du service Docker).
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

WORKDIR /app/apps/web
RUN npm run build

# ---------------------------------------------------------------------
# Stage 3 : runtime (Next standalone, image minimaliste)
# ---------------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache libc6-compat tini \
 && addgroup -S grantflow \
 && adduser -S -G grantflow grantflow

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# `output: 'standalone'` génère .next/standalone (self-contained) +
# .next/static (assets) + public/ (à copier séparément).
COPY --from=build --chown=grantflow:grantflow /app/apps/web/.next/standalone ./
COPY --from=build --chown=grantflow:grantflow /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=grantflow:grantflow /app/apps/web/public ./apps/web/public

USER grantflow
EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/web/server.js"]

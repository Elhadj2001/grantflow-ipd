# GRANTFLOW IPD — Squelette d'application

> **Plateforme d'automatisation Procure-to-Account et de comptabilité analytique multi-bailleurs — Institut Pasteur de Dakar**
> Mémoire MIAGE — El Hadj Amadou NIANG — 2025/2026

Ce squelette est l'amorce technique du projet GRANTFLOW IPD. Il est conçu pour être ouvert directement dans **Google Antigravity** et utilisé en collaboration avec **Claude Cowork**.

---

## Stack technique

| Couche | Technologie | Version |
|---|---|---|
| Frontend | Next.js (App Router) + React + TypeScript | 14 / 18 / 5 |
| UI | Tailwind CSS + shadcn/ui + lucide-react | latest |
| État | TanStack Query + Zustand | 5 / 4 |
| Backend | NestJS + Node.js + TypeScript | 10 / 22 / 5 |
| ORM | Prisma | 5 |
| Base de données | PostgreSQL | 16 |
| Cache / Queues | Redis + BullMQ | 7 / 5 |
| Stockage objet | MinIO (S3-compatible) | latest |
| Identité | Keycloak (OIDC) | 24 |
| Validation | Zod | 3 |
| Tests | Jest + Supertest + Playwright | 29 / 7 / 1.x |
| Conteneurs | Docker + docker-compose | latest |
| Monorepo | npm workspaces (option Turborepo) | — |

---

## Structure du dépôt

```text
grantflow-ipd-skeleton/
├── apps/
│   ├── web/          # Next.js — frontend
│   └── api/          # NestJS — backend
├── packages/
│   └── shared/       # Types partagés (Zod + DTO)
├── docs/             # Documentation interne
├── docker-compose.yml
├── .env.example
├── CLAUDE.md         # Contexte projet pour Claude / Antigravity
├── ANTIGRAVITY_PROMPTS.md
└── package.json      # Workspace racine
```

---

## Démarrage rapide

> Pré-requis : Node 22 LTS, Docker Desktop, Git, et VS Code (ou **Antigravity**).

```bash
# 1. Cloner le dépôt
git clone <votre-repo-git> grantflow-ipd
cd grantflow-ipd

# 2. Variables d'environnement
cp .env.example .env
# Note: Postgres est exposé sur le port host 5433 (et non 5432) pour
# cohabiter avec un éventuel Postgres natif sur Windows.
# Voir docs/SETUP_WINDOWS.md §9 si tu rencontres un conflit de port.

# 3. Installer les dépendances
npm install

# 4. Lancer l'infrastructure locale
docker compose up -d postgres redis minio keycloak

# 5. Préparer la base
cd apps/api
npx prisma migrate dev
npx prisma db seed
cd ../..

# 6. Lancer en développement (deux terminaux)
npm run dev --workspace=apps/api    # → http://localhost:4000
npm run dev --workspace=apps/web    # → http://localhost:3000
```

Comptes par défaut (seed) :
- `admin@pasteur.sn` / `Admin#2026`
- `daf@pasteur.sn` / `Daf#2026-IPD`
- `compta@pasteur.sn` / `Compta#2026`
- `tres@pasteur.sn` / `Tres#2026-IPD`
- `pi@pasteur.sn` / `Pi#2026-IPD`
- `amadou@pasteur.sn` / `Demandeur#2026`

---

## Méthode de travail avec Cowork + Antigravity

Voir le fichier dédié [`docs/COWORK_ANTIGRAVITY_GUIDE.md`](./docs/COWORK_ANTIGRAVITY_GUIDE.md).

En résumé :
1. **Cowork** (cette conversation avec Claude) sert à **discuter, planifier, expliquer** : chaque sprint, on cadre ensemble ce qu'il faut construire.
2. **Antigravity** sert à **écrire le code dans l'IDE** : on copie les prompts générés ici, on les colle dans Antigravity, et l'agent IA produit / modifie les fichiers.
3. **CLAUDE.md** fournit en permanence aux agents IA (Antigravity, Cursor, Copilot, etc.) le contexte métier et les règles d'or du projet.

---

## Roadmap des sprints (extrait du dossier d'avant-projet)

| Sprint | Durée | Livrables principaux |
|---|---|---|
| **Sprint 0** | 1 sem. | Infra Docker + Prisma + auth + healthchecks |
| **Sprint 1** | 2 sem. | Module Référentiels (M1) — utilisateurs, projets, conventions |
| **Sprint 2** | 2 sem. | Module Demandes d'achat (M2) — formulaire + workflow |
| **Sprint 3** | 2 sem. | Module Bons de commande (M3) + engagement classe 8 |
| **Sprint 4** | 2 sem. | OCR factures (M5) + rapprochement 3 voies |
| **Sprint 5** | 2 sem. | Comptabilité FI (M7) + analytique (M8) |
| **Sprint 6** | 2 sem. | Reporting bailleur (M9) + clôture + pilote |

---

## Conformité SYSCEBNL / OHADA

- Plan comptable SYSCEBNL pré-chargé via `prisma/seed.ts`
- Comptabilité d'engagement obligatoire (toute DA validée crée un engagement classe 8)
- Mécanisme des fonds dédiés (compte 19) modélisé en table `co.dedicated_fund_movement`
- Tableau Emplois-Ressources (TER) produit à la clôture (voir `apps/api/src/closing/`)
- Piste d'audit immuable avec chaînage par hash SHA-256 (`audit.event_log`)

---

## Licence et propriété

Propriété intellectuelle dans le cadre du mémoire MIAGE de El Hadj Amadou NIANG, en coopération avec l'Institut Pasteur de Dakar. Tous droits réservés. Une licence d'usage interne sera négociée avec l'IPD à l'issue du pilote.

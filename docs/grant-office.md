# Module Grant Office

> Bounded context métier IPD (Phase 5A). Hébergé sous `apps/api/src/grant_office/`.
> Fondations DDL : Sprint S4 (US-030/031). Catalogue seedé : US-032.
> Scaffolding module NestJS : **US-033 (cette story)**.

## 1. Vue d'ensemble

Le Grant Office (GO) est la cellule administrative qui traduit une convention
bailleur en **infrastructure budgétaire activée**, via la **Note Technique**
(cf. [ADR-006](adr/adr-006-grant-office-note-technique.md)). Les contrôles
d'éligibilité métier (natures, plafonds, dates, refacturation Pasteur Paris)
sont centralisés dans l'**Eligibility Engine**
(cf. [ADR-007](adr/adr-007-eligibility-engine.md)).

## 2. Sous-modules

| Sous-module | Rôle | État US-033 |
|---|---|---|
| `expense-nature/` | Catalogue typologique des natures de dépense (read-only, géré par seed US-032). | CRUD read-only ✅ |
| `overhead-rule/` | Règles d'overhead différenciées par catégorie (ADR-006). | CRUD complet ✅ |
| `note-technique/` | Note Technique : CRUD **draft uniquement**. | CRUD draft ✅ (workflow ❌ → S5) |
| `eligibility/` | EligibilityEngine (ADR-007). | **Placeholder** (S5+) |

## 3. Endpoints REST (`/api/v1`)

| Méthode | Route | Rôles | Notes |
|---|---|---|---|
| GET | `/expense-natures` | CONTROLEUR, DAF, COMPTABLE, SUPER_ADMIN | liste catalogue |
| GET | `/expense-natures/:code` | idem | détail par code |
| GET | `/overhead-rules` | CONTROLEUR, DAF, COMPTABLE, SUPER_ADMIN | liste |
| GET | `/overhead-rules/:id` | idem | détail |
| POST | `/overhead-rules` | DAF, SUPER_ADMIN | crée |
| PATCH | `/overhead-rules/:id` | DAF, SUPER_ADMIN | met à jour |
| DELETE | `/overhead-rules/:id` | DAF, SUPER_ADMIN | soft delete |
| GET | `/note-techniques` | CONTROLEUR, DAF, COMPTABLE, SUPER_ADMIN | filtres `grantId`/`status` |
| GET | `/note-techniques/:id` | idem | détail (overheadRule + budgetLines) |
| POST | `/note-techniques` | CONTROLEUR, DAF, SUPER_ADMIN | crée en `draft` |
| PATCH | `/note-techniques/:id` | CONTROLEUR, DAF, SUPER_ADMIN | édite **draft uniquement** |

> **Rôle GO** : un rôle RBAC dédié `GO` n'existe pas encore (`ROLES` n'en
> contient pas). En attendant son ajout (Sprint S5 : réalm Keycloak + tuple
> `ROLES` + `packages/shared`), la fonction Grant Office est portée par
> `CONTROLEUR` (contrôle de gestion). Les endpoints sont donc fonctionnels
> dès maintenant.

## 4. Conventions techniques

- Pattern Controller → Service → Repository (Prisma).
- DTO d'entrée validés par **Zod** (`createZodDto`, ZodValidationPipe global).
- Logger **Pino** structuré (`event: '...'`) sur les mutations.
- `note_technique.ownFundsContributionXof` est un `BigInt` (XOF) → sérialisé
  en `number` dans les réponses du service (montants < 2^53).

## 5. Roadmap

- **US-033 (fait)** — scaffolding : structure modulaire, CRUD basiques,
  Eligibility placeholder, câblage `AppModule`, tests de chargement.
- **Sprint S5** — workflow Note Technique `draft → pending_daf →
  validated_daf → active → superseded` (avec SoD GO ≠ DAF, ADR-009),
  matérialisation budgétaire à l'activation, **EligibilityEngine MVP**
  (natures éligibles, plafonds `max_per_request_xof`/`max_per_year_xof`,
  fenêtre temporelle), rôle Keycloak `GO` dédié.

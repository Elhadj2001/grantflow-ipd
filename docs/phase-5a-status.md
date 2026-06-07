# Phase 5A — Statut Grant Office (modèle métier IPD)

> Suivi de la trajectoire Phase 5A (modèle métier IPD : Note Technique,
> Eligibility Engine, overhead). Réf : [ADR-006](adr/adr-006-grant-office-note-technique.md),
> [ADR-007](adr/adr-007-eligibility-engine.md), [grant-office.md](grant-office.md).

## Avancement

### ✅ Sprint S4 — Fondations (terminé)
- **US-030** — DDL schéma `grant_office` : 5 tables (`expense_nature`,
  `overhead_rule`, `note_technique`, `note_technique_budget_line`,
  `eligibility_rule`) + 4 index. Aucun impact sur l'existant.
- **US-031** — UNIQUE PARTIEL `uq_note_technique_active_per_grant`
  (≤ 1 Note Technique active par convention) + sync Prisma (5 modèles
  PascalCase normalisés).
- **US-032** — Seeds catalogue : `expense-natures.json` (25 natures,
  PPT IPD + standards NGO) + `overhead-rules.json` (4 règles : USAID-15,
  Wellcome-0, EU-Horizon-25, Generic-10).
- **US-033** — Scaffolding module NestJS `grant_office` : 4 sous-modules,
  CRUD basiques (expense-nature read-only, overhead-rule CRUD, note-technique
  CRUD **draft only**), EligibilityEngine **placeholder**. Endpoints REST
  `/api/v1/{expense-natures,overhead-rules,note-techniques}`.

### ⏳ Sprint S5 — Workflow & moteur (à venir, US-040 → US-050, ~37 pts)
- Workflow Note Technique : `draft → pending_daf → validated_daf → active
  → superseded` (avec SoD GO ≠ DAF, ADR-009) + matérialisation budgétaire
  à l'activation.
- **EligibilityEngine MVP** : natures éligibles, plafonds
  (`max_per_request_xof` / `max_per_year_xof`), fenêtre temporelle,
  exclusions — branché sur `eligibility_rule` + `expense_nature` (ADR-007).
- Rôle Keycloak **GO** dédié (réalm + tuple `ROLES` + `packages/shared`) —
  aujourd'hui la fonction GO est portée par `CONTROLEUR`.

### ⏳ Sprint S6+ — Reporting & gouvernance
- Maquettes bailleur (templates imposés), génération de rapports financiers
  par Note Technique active.
- Versioning des Notes Techniques + piste d'audit.
- Refacturation inter-pôles / Pasteur Paris.

## Dette technique connexe (hors Phase 5A)
- **US-139/US-140** : soldées (filtre `posted` + invariants multidevise DB).
- Voir `docs/audit-codebase-2026-06-02.md` pour les findings restants
  (F3 SoD serveur, F4/F8 RBAC, F5/F13 enums partagés, etc.).

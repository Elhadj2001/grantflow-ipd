# Phase 5A — Statut Grant Office (modèle métier IPD)

> Suivi de la trajectoire Phase 5A (modèle métier IPD : Note Technique,
> Eligibility Engine, overhead). Réf : [ADR-006](adr/adr-006-grant-office-note-technique.md),
> [ADR-007](adr/adr-007-eligibility-engine.md), [grant-office.md](grant-office.md).

## Avancement

> **Phase 5A — Delivery 1 terminée (S4 + S5).** Fondations Grant Office +
> EligibilityEngine MVP opérationnel et branché sur la soumission de DA.

### ✅ Sprint S4 — Fondations Grant Office (terminé)
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

### ✅ Sprint S5 — EligibilityEngine MVP (terminé)
- **US-040** — Contrat `EligibilityRule` (code/severity/check) + types
  `Verdict` (ok/blocked/warning) + `EligibilityContext` (ADR-007).
- **US-041→047** — 7 règles core couvrant le PPT IPD slide 7 :
  `NatureAllowed`, `DateWindow`, `LineNotExceeded`, `LineNatureCoherent`,
  `NotPasteurParisReimbursed` (placeholder défensif), `NoCrossProjectDuplicate`
  (warning), `PeriodNotClosed`.
- **US-048** — Orchestrateur `EligibilityEngineService.validate()` :
  exécution **parallèle** (Promise.all), agrégation blocked/warning, token
  multi-inject `ELIGIBILITY_RULES`, log Pino structuré.
- **US-049** — Intégration dans `PurchaseRequestService.submit()` : gate
  d'éligibilité **dormante** (active dès que la DA porte une nature de
  dépense), enveloppe `{ pr, warnings }`, `EligibilityValidationException`
  (`BUSINESS.ELIGIBILITY_VALIDATION_FAILED`). Wiring DI complet
  (`EligibilityModule` → `ProcurementModule`).
- **US-050** — 14 tests d'intégration end-to-end couvrant le PPT slide 7 :
  **4/7 invariants bloquent via `submit()`** (nature, date, plafond, période) ;
  3/7 (ligne↔nature, Pasteur Paris, doublon facture) **prouvés au niveau
  moteur** en attendant la matérialisation du DTO PR (S6). Couverture
  `EligibilityEngineService` + `EligibilityContextBuilder` = **100 %**.

### ⏳ Sprint S6 — Workflow Note Technique & matérialisation (~20-25 pts)
- Workflow Note Technique : `draft → pending_daf → validated_daf → active →
  superseded` (SoD GO ≠ DAF, ADR-009) + matérialisation budgétaire à
  l'activation.
- Rôle Keycloak **GO** dédié (réalm + tuple `ROLES` + `packages/shared`) —
  aujourd'hui la fonction GO est portée par `CONTROLEUR`.
- **Matérialisation DTO PR** : `pasteurParisReimbursed`, `supplierInvoiceNumber`,
  `budget_line.category` → bascule automatique de PPT-4/5/6 en blocage/warning
  *end-to-end* via `submit()` (moteur déjà prêt, cf. US-050).

### ⏳ Sprint S7+ — Reporting & gouvernance
- Maquettes bailleur (templates imposés), génération de rapports financiers
  par Note Technique active.
- Versioning des Notes Techniques + immutabilité des rapports (ADR-011),
  colonne d'ajustement.
- Audit conventionnel, refacturation inter-pôles / Pasteur Paris, fonds
  propres, justificatifs typés, états SYSCEBNL réglementaires.

## Dette technique connexe (hors Phase 5A)
- **US-139/US-140** : soldées (filtre `posted` + invariants multidevise DB).
- Voir `docs/audit-codebase-2026-06-02.md` pour les findings restants
  (F3 SoD serveur, F4/F8 RBAC, F5/F13 enums partagés, etc.).

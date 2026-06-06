# Index documentaire — GRANTFLOW IPD

**Dernière mise à jour** : 02 juin 2026
**Auteur** : El Hadj Amadou NIANG

Point d'entrée navigable de la documentation projet. Lis ce fichier en premier pour t'orienter.

---

## 1. Stratégie et cadrage

| Document | Rôle | Statut |
|---|---|---|
| [`cadrage-phase-0.md`](./cadrage-phase-0.md) | Note de cadrage stratégique 12 mois — domaine IPD, hypothèses Q1-Q5, modélisation conceptuelle, plan d'action, risques | **Source de vérité stratégique** |
| [`memoire-plan.md`](./memoire-plan.md) | Plan détaillé du mémoire MIAGE, normes typographiques, jalons rédactionnels | Source de vérité rédactionnelle |
| [`backlog-initial.md`](./backlog-initial.md) | Backlog sprintable 12 mois avec ~135 user stories US-XXX et critères Gherkin | Source de vérité opérationnelle |
| [`audit-codebase-2026-06-02.md`](./audit-codebase-2026-06-02.md) | Audit transversal 28 findings (4 critiques, 17 majeurs, 7 mineurs) | Source de vérité dette technique |

## 2. Architecture Decision Records

Voir [`adr/README.md`](./adr/README.md) pour le catalogue complet.

| ADR | Sujet | Statut |
|---|---|---|
| [ADR-001](./adr/adr-001-ddl-first.md) | DDL-first comme source unique du schéma | accepted |
| [ADR-003](./adr/adr-003-modular-monolith.md) | Modular monolith comme architecture de départ | accepted |
| [ADR-005](./adr/adr-005-multidevise-tripartite.md) | Multidevise tripartite avec XOF SYSCEBNL | accepted |
| [ADR-006](./adr/adr-006-grant-office-note-technique.md) | Grant Office et Note Technique comme entités de premier plan | accepted |
| [ADR-007](./adr/adr-007-eligibility-engine.md) | Eligibility engine centralisé | accepted |
| [ADR-009](./adr/adr-009-segregation-of-duties.md) | Séparation des tâches enforced par identité | accepted |
| [ADR-011](./adr/adr-011-rapport-bailleur-immutabilite.md) | Immutabilité des rapports publiés | accepted |

ADRs à formaliser ultérieurement : 002 (Keycloak), 004 (Prisma), 008 (i18n), 010 (shared package), 012 (audit hash chain), 013 (multi-env), 014 (R2 vs MinIO), 015 (stratégie tests).

## 3. Documentation des modules métier

| Module | Document | Phase de stabilisation |
|---|---|---|
| Demande d'Achat | [`purchase-request.md`](./purchase-request.md) | Phase 1 |
| Bon de Commande | [`purchase-order.md`](./purchase-order.md) | Phase 1 |
| Email BC fournisseur | [`po-email.md`](./po-email.md) | Stable |
| Réception (Goods Receipt) | [`goods-receipt.md`](./goods-receipt.md) | Stable |
| Matching facture (3-way) | [`invoice-matching.md`](./invoice-matching.md) | Stable |
| Comptabilisation facture | [`invoice-posting.md`](./invoice-posting.md) | Stable |
| OCR multi-provider | [`ocr.md`](./ocr.md) | Phase 5B (ajout provider Python) |
| Caisse menue | [`cash-management.md`](./cash-management.md) | Stable |
| Payment runs | [`payment-run.md`](./payment-run.md) | Stable |
| Reporting bailleur | [`donor-reporting.md`](./donor-reporting.md) | **Phase 5A — extension majeure** |
| Clôture périodique | [`period-close.md`](./period-close.md) | Phase 5A (extension FNP/CCA/PCA) |
| Taux de change UEMOA | [`uemoa-exchange-rate.md`](./uemoa-exchange-rate.md) | **Phase 1 — extension multidevise** |

À créer en Phase 5A :

| Module | Document à créer | Sprint |
|---|---|---|
| Note Technique GO | `note-technique.md` | S11 |
| Eligibility Engine | `eligibility-engine.md` | S5 |
| Maquettes bailleur | `report-templates.md` | S13 |
| Versioning rapports + colonne ajustement | `report-versioning.md` | S15 |
| Audit conventionnel | `audit-mission.md` | S16 |
| Refacturation inter-pôles | `inter-center-transfer.md` | S17 |
| Contribution fonds propres | `own-funds-contribution.md` | S17 |
| Multi-devise tripartite | `multi-currency.md` | S1-S3 |

## 4. Démonstration et utilisateurs

| Document | Rôle |
|---|---|
| [`admin-users.md`](./admin-users.md) | Liste des utilisateurs Keycloak de démo + mots de passe |
| [`demo-features.md`](./demo-features.md) | Fonctionnalités de démo (simulateur facture F-INVOICE-SIM) — à isoler Phase 4 (US-123) |
| [`checklist-demo-jury.md`](./checklist-demo-jury.md) | Checklist du parcours démo jury — archive à terme |
| [`scenario-demo-bailleur.md`](./scenario-demo-bailleur.md) | Scénario démo orienté bailleur — archive à terme |

## 5. Setup et déploiement

| Document | Rôle |
|---|---|
| [`SETUP_WINDOWS.md`](./SETUP_WINDOWS.md) | Setup environnement Windows + WSL2 |
| [`GITHUB_SETUP.md`](./GITHUB_SETUP.md) | Configuration GitHub repository |
| [`COWORK_ANTIGRAVITY_GUIDE.md`](./COWORK_ANTIGRAVITY_GUIDE.md) | Workflow Cowork + Antigravity + Claude Code |
| [`keycloak-setup.md`](./keycloak-setup.md) | Configuration Keycloak (realm, clients, rôles) |
| [`deploy/`](./deploy/) | Documentation de déploiement par cible (Render, IPD on-premise — à venir Phase 7) |

## 6. Schéma de base de données

| Document | Rôle |
|---|---|
| [`grantflow_ddl_postgresql.sql`](./grantflow_ddl_postgresql.sql) | **Source de vérité du schéma de données** (DDL-first, cf. ADR-001) |
| [`migrations/`](./migrations/) | Migrations SQL idempotentes par sprint |

## 7. Captures et illustrations

| Dossier | Contenu |
|---|---|
| [`screenshots/`](./screenshots/) | Captures écran pour démo + mémoire |
| [`demo/`](./demo/) | Données de démo + assets |

## 8. Navigation conseillée

**Tu démarres un nouveau sprint** ?
1. Lire la story `US-XXX` dans [`backlog-initial.md`](./backlog-initial.md).
2. Identifier l'ADR ou le finding d'audit associé.
3. Vérifier les règles d'or dans [`../CLAUDE.md`](../CLAUDE.md).
4. Coder.

**Tu rédiges un chapitre du mémoire** ?
1. Trouver le chapitre cible dans [`memoire-plan.md`](./memoire-plan.md) §2.
2. Identifier la phase technique associée et les ADRs qui l'alimentent.
3. Rédiger en Markdown dans `docs/memoire/chap-XX-titre.md` (à créer Phase 0).

**Tu prépares une démo** ?
1. [`admin-users.md`](./admin-users.md) pour les credentials.
2. [`checklist-demo-jury.md`](./checklist-demo-jury.md) ou [`scenario-demo-bailleur.md`](./scenario-demo-bailleur.md) pour le scénario.
3. [`demo-features.md`](./demo-features.md) pour les flags d'environnement à activer.

**Tu redéploies l'environnement cloud** ?
1. [`deploy/render.md`](./deploy/) pour la cible Render.
2. Variables env documentées dans `render.yaml`.

---

*Index documentaire — Version 1.0 — 02 juin 2026*

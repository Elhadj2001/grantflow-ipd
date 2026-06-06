# Architecture Decision Records — GRANTFLOW IPD

Ce dossier consigne les **décisions d'architecture structurantes** prises au cours du projet GRANTFLOW IPD, dans la lignée du format **MADR** (Markdown Architecture Decision Records).

## Pourquoi des ADRs ?

Un ADR est un document court (2-5 pages) qui répond à trois questions :
- **Quel était le problème ?** (Context)
- **Qu'est-ce qu'on a décidé ?** (Decision)
- **Pourquoi, et qu'est-ce que ça coûte ?** (Consequences, Alternatives)

Les ADRs sont **immuables** une fois acceptées. Pour revenir sur une décision, on **crée un nouvel ADR** qui la supersede, avec lien explicite vers la précédente.

## Statuts possibles

- `proposed` — proposition en discussion, pas encore tranchée
- `accepted` — décision prise et appliquée
- `deprecated` — n'est plus pertinente mais a été appliquée par le passé
- `superseded by ADR-XXX` — remplacée par une autre décision

## Catalogue

| ID | Titre | Statut | Date |
|---|---|---|---|
| ADR-000 | Template | — | 2026-06-02 |
| ADR-001 | DDL-first comme source unique du schéma | accepted | 2026-06-02 |
| ADR-003 | Modular monolith comme architecture de départ | accepted | 2026-06-02 |
| ADR-005 | Multidevise tripartite avec XOF comme devise de tenue SYSCEBNL | accepted | 2026-06-02 |
| ADR-006 | Grant Office et Note Technique comme entités de premier plan | accepted | 2026-06-02 |
| ADR-007 | Eligibility engine centralisé vs validation éparpillée | accepted | 2026-06-02 |
| ADR-009 | Séparation des tâches enforced par identité avec dérogation explicite | accepted | 2026-06-02 |
| ADR-011 | Immutabilité des rapports publiés et versioning par colonne d'ajustement | accepted | 2026-06-02 |

À formaliser ultérieurement (mentionnés dans la note de cadrage Phase 0) :

| ID | Titre | Phase prévue |
|---|---|---|
| ADR-002 | Keycloak OIDC pour l'authentification et l'autorisation | Phase 3 |
| ADR-004 | Prisma comme ORM unique | Phase 4 |
| ADR-008 | Internationalisation portée par les rapports bailleur uniquement | Phase 5A |
| ADR-010 | `packages/shared` comme source unique avec codegen Prisma | Phase 4 |
| ADR-012 | Audit trail SHA-256 chaîné préservé en trigger PostgreSQL | Phase 3 |
| ADR-013 | Stratégie multi-environnements (dev / cloud / IPD on-premise) | Phase 7 |
| ADR-014 | Cloudflare R2 vs MinIO selon environnement | Phase 7 |
| ADR-015 | Pyramide de tests Unit > Integration > E2E avec couverture 70/50 | Phase 2 |

## Convention

Nommer les fichiers `adr-XXX-slug-court.md`. Une fois acceptée, ne plus modifier le corps : créer un nouvel ADR si la décision évolue.

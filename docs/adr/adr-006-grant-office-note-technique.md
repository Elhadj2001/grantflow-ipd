# ADR-006 — Grant Office et Note Technique comme entités de premier plan

**Statut** : accepted
**Date** : 2026-06-02
**Auteur** : El Hadj Amadou NIANG

## Contexte

L'analyse du PPT interne IPD *Présentation Gestion de Projet et Conventions de Recherche* a révélé deux éléments structurants absents du modèle GRANTFLOW v0 :

- Un **rôle métier critique** : le **Grant Office (GO)**, cellule administrative de l'IPD qui assure l'interface entre les bailleurs et l'opérationnel financier. Citation : *« La convention est envoyée au DAF et au Grant Office (GO), le PI conserve les originaux. »*
- Un **artefact métier pivot** : la **Note Technique**, document rédigé par le GO qui traduit la convention en infrastructure budgétaire activée. Citation : *« Le code budgétaire est créé après la réception de la convention et de la Note Technique. La note technique est rédigée par le GO après réception de la convention. »*

Dans la version initiale de GRANTFLOW, ces deux éléments n'étaient pas modélisés. Conséquences observées :

- Aucun workflow formalisé entre la réception d'une convention et l'activation des lignes budgétaires utilisables — les lignes sont créées implicitement, sans étape de validation GO/DAF.
- Les contraintes spécifiques à chaque convention (natures de dépenses autorisées, fenêtre temporelle, plafonds par ligne, taux et règle d'overhead, contribution sur fonds propres) sont **diluées dans la logique métier** au lieu d'être centralisées.
- L'absence de Note Technique comme entité empêche le tracking des **échéances de reporting** (intermédiaires et finales) qui en découlent — pourtant explicitement mentionnées par le PPT.
- Le rôle GO n'est pas distinguable des rôles DAF ou COMPTABLE dans la matrice RBAC.

Cette absence n'est pas un bug technique mais un **gap conceptuel** entre le modèle livré et le processus réel IPD. Sans ces deux éléments, GRANTFLOW ne peut pas réellement remplacer le couple Excel + Sage que l'IPD utilise aujourd'hui.

## Décision

GRANTFLOW IPD introduit en Phase 5A (sprints S25-S27) deux entités de premier plan :

**1. Rôle `GO` (Grant Office)** dans la matrice RBAC

- Nouveau rôle Keycloak `GO`.
- Permissions spécifiques : `note_technique.create`, `note_technique.update`, `note_technique.submit_to_daf`, `report.generate`, `report.transmit`, `audit_mission.create`, `audit_mission.update`.
- Lecture seule sur les DA, BC, factures (sans pouvoir d'approbation).
- Visible dans la matrice de visibilité (`canActorViewPr`) avec scope « projets/conventions dont je suis le GO assigné ».

**2. Entité `NoteTechnique`**

```
note_technique (schéma grant_office)
├── id UUID PK
├── grant_id UUID FK → ref.grant (UNIQUE quand status = 'active')
├── version INT NOT NULL DEFAULT 1
├── status TEXT CHECK IN ('draft', 'pending_daf', 'validated_daf', 'active', 'superseded')
├── drafted_by_user_id UUID FK → auth.app_user (rôle GO)
├── validated_by_daf_user_id UUID FK → auth.app_user NULL
├── validated_at TIMESTAMP NULL
├── activated_at TIMESTAMP NULL
├── budget_code TEXT NOT NULL UNIQUE  -- ex: 'USAID-2026-PCR-001'
├── reporting_intermediate_dates DATE[] NOT NULL
├── reporting_final_date DATE NOT NULL
├── own_funds_contribution_xof BIGINT NOT NULL DEFAULT 0
├── own_funds_contribution_currency TEXT
├── overhead_rule_id UUID FK → grant_office.overhead_rule
├── notes TEXT
├── supersedes_id UUID FK → note_technique NULL
├── created_at, updated_at, deleted_at
```

**Workflow `NoteTechnique`** :

1. **draft** : créée par le GO à réception de la convention. Le GO renseigne les champs (budget code, échéances, lignes budgétaires associées via une table `note_technique_budget_line`, overhead rule, contribution fonds propres).
2. **pending_daf** : le GO soumet à validation. La Note Technique devient visible côté DAF dans son tableau de bord.
3. **validated_daf** : le DAF approuve. Une trace `validated_by_daf_user_id` + `validated_at` est posée.
4. **active** : le GO active la Note. Les lignes budgétaires associées deviennent disponibles pour les DA. Une seule Note Technique peut être active par convention à un instant donné (contrainte UNIQUE PARTIELLE).
5. **superseded** : si une révision est nécessaire (avenant convention, redéploiement budgétaire), une nouvelle Note Technique en `draft` est créée avec `supersedes_id` pointant sur la précédente. Une fois activée, l'ancienne passe en `superseded`.

**Workflow d'activation budgétaire reposant sur Note Technique** :

- Avant cette ADR : `Grant` créé → lignes budgétaires créées directement → utilisables immédiatement.
- Après cette ADR : `Grant` créé → `NoteTechnique draft` rédigée par GO → soumission DAF → validation → activation → lignes budgétaires de la Note deviennent utilisables.

Les contraintes (natures éligibles, fenêtre, plafonds) sont portées par la Note Technique active, pas par le Grant nu.

## Conséquences

### Positives

- **Alignement avec le processus réel IPD** documenté par le PPT — argument fort d'adoption.
- **Workflow d'activation budgétaire formalisé** : plus de lignes orphelines créées hors processus.
- **Tracking automatique des échéances de reporting** rendu possible (un job BullMQ scanne les `reporting_intermediate_dates` et alerte le GO à approche).
- **Versioning natif** pour les avenants convention : une révision est traçable, non destructive.
- **Eligibility engine** (cf. ADR-007) trouve sa source de vérité dans la Note Technique active, pas éparpillée dans le code.
- **Rôle GO distingué** dans RBAC permet une **séparation des tâches** fine : le GO prépare, le DAF valide, l'opérationnel exécute.

### Négatives

- **Frottement workflow** ajouté avant utilisation budgétaire — peut être perçu comme bureaucratique par le PI qui voudrait imputer immédiatement. Atténué par : (a) une UI fluide GO → DAF, (b) un mode `single_actor_authorized` exceptionnel pour les conventions urgentes (à valider métier).
- **Migration de données existantes** : les grants déjà créés sans Note Technique doivent recevoir une « Note Technique de migration » rétroactive en `active` lors du déploiement du module. Migration documentée en Phase 5A.
- **Charge cognitive** pour les utilisateurs : un concept de plus à apprendre. Mitigée par un onboarding GO dédié dans la documentation utilisateur Phase 7.
- **Complexification du modèle** : une nouvelle entité, des relations en cascade, un workflow d'état supplémentaire à tester.

## Alternatives considérées

- **Garder le statu quo** (pas de Note Technique) — rejeté. Le système ne pourrait pas s'aligner avec le processus IPD réel et ne pourrait pas porter l'eligibility engine de manière propre.
- **Note Technique comme champ JSON sur `Grant`** — rejeté. Perdrait le versioning, les statuts de workflow, la traçabilité validation DAF, l'unicité contrainte par DDL.
- **Modélisation avec EAV** (Entity-Attribute-Value) pour les contraintes — rejeté. Pattern anti-relationnel, performances dégradées, type-safety perdue.
- **Note Technique séparée par grand chapitre budgétaire** (fonctionnement, équipement, etc.) — rejeté pour la v1. Pourrait être étendu plus tard si le besoin émerge.

## Références

- PPT IPD *Présentation Gestion de Projet et Conventions de Recherche*, slides 3-4.
- SAP Public Sector Management — Funds Management module, concept de Funded Program.
- Oracle Grants Accounting — Award + Budget Hierarchy.
- Sage Intacct Nonprofit — Grant tracking with Budget Plans.
- Note de cadrage Phase 0, §2.2 et §13.1.
- ADR-007 — Eligibility engine centralisé (dépend de cette ADR).

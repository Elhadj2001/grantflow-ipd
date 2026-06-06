# ADR-001 — DDL-first comme source unique du schéma de données

**Statut** : accepted
**Date** : 2026-06-02
**Auteur** : El Hadj Amadou NIANG

## Contexte

GRANTFLOW IPD est un système de comptabilité analytique multi-bailleurs régi par le référentiel SYSCEBNL (Acte uniforme OHADA). Plusieurs invariants métier doivent être protégés au niveau du moteur de base de données, pas seulement de l'application :

- **Équilibre débit-crédit** sur chaque écriture comptable validée (trigger `gl.check_entry_balance`).
- **Interdiction de modification d'une période fiscale close** (trigger `gl.check_period_open`).
- **Chaînage SHA-256 inviolable des événements d'audit** (trigger `audit.compute_hash_chain`).
- **Colonnes calculées déterministes** : `purchase_request_line.line_total`, `purchase_order_line.line_total`, `co.overhead_calculation.overhead_amount` — déclarées `GENERATED ALWAYS AS STORED`.
- **Contraintes CHECK métier** : classe comptable ∈ 1-9, débit XOR crédit exclusif, montants positifs sur les engagements.
- **Vues matérialisées** : `co.v_budget_tracking`, `gl.v_general_balance`, qui alimentent en temps réel les KPI utilisateur.

L'ORM Prisma, par contraint sa philosophie « schéma déclaratif Prisma → migration », ne peut pas générer ces constructions. Une exécution de `prisma migrate dev` ou `prisma migrate deploy` **supprimerait silencieusement** ces protections critiques, exposant le système à des écritures déséquilibrées, des modifications de périodes closes, ou une rupture du chaînage d'audit.

Trois options s'offraient au démarrage du projet : (a) faire confiance à Prisma migrate et reposter les triggers manuellement après chaque migration, (b) inverser le flux et faire du DDL la source de vérité avec Prisma en lecture seule, (c) abandonner Prisma au profit d'un client raw SQL.

## Décision

**Le fichier `docs/grantflow_ddl_postgresql.sql` est la source unique de vérité du schéma de la base de données.** Le fichier `apps/api/prisma/schema.prisma` est généré par `npx prisma db pull` et n'est jamais modifié à la main.

**Workflow d'évolution du schéma** :

1. Modifier `docs/grantflow_ddl_postgresql.sql` (revue obligatoire par le contrôle de gestion si la modification touche aux classes comptables, conventions, ou fonds dédiés).
2. Préparer une **migration SQL idempotente** : `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`. Pas de `DROP` destructif sans revue spécifique.
3. Appliquer la migration en environnement de dev via `psql -f`.
4. Lancer `npx prisma db pull` pour synchroniser `apps/api/prisma/schema.prisma`.
5. Lancer `npm run prisma:generate` pour mettre à jour le client typé.
6. Vérifier que triggers, CHECK et GENERATED sont toujours présents (`\d+ table_name`).
7. Ajouter un test d'intégration qui couvre la nouvelle contrainte.

**Interdictions strictes** :

- `npx prisma migrate dev` — **interdit**.
- `npx prisma migrate deploy` — **interdit**.
- Modification manuelle de `schema.prisma` — **interdit**.
- Écriture côté code applicatif des colonnes `GENERATED ALWAYS AS STORED` — **rejetée par PostgreSQL**.

## Conséquences

### Positives

- Les invariants comptables critiques sont **protégés au niveau moteur**, indépendamment d'un éventuel bug applicatif ou d'un accès direct à la base par un administrateur.
- Le DDL est **lisible par tout DBA** indépendamment de la stack TypeScript, facilitant les audits externes et la portabilité éventuelle.
- Les triggers et CHECK constituent une **défense en profondeur** complémentaire des validations applicatives Zod et NestJS.
- Le mémoire peut s'appuyer sur un **invariant solide** pour défendre la fiabilité comptable du système.

### Négatives

- Workflow plus **manuel** que `prisma migrate` standard : chaque évolution de schéma demande l'écriture d'une migration SQL idempotente à la main.
- Risque de **dérive entre DDL et Prisma** si `db pull` n'est pas joué après modification. Atténué par un test CI qui vérifie la synchronisation.
- Compétence SQL requise pour les contributeurs au schéma — exclut les contributeurs purement TypeScript des évolutions de modèle de données.
- Pas de **rollback automatique** comme Prisma migrate ; nécessite des migrations descendantes manuelles documentées.

## Alternatives considérées

- **Prisma migrate avec re-application post-migration des triggers** — rejetée. Risque d'oublier la re-application, fenêtre de vulnérabilité entre migration et re-trigger, complexité opérationnelle équivalente sans le bénéfice du DDL lisible.
- **Abandon de Prisma au profit d'un client raw** (Knex, pg avec types maison) — rejetée. Perte de la type-safety end-to-end qui est un acquis fort de la stack TypeScript et un argument du mémoire. Prisma en lecture seule du DDL offre les deux bénéfices.
- **Utilisation de Prisma `views` et `enums` natives uniquement** — rejetée. Prisma ne supporte pas les triggers, CHECK complexes, ou colonnes `GENERATED STORED` au moment du démarrage du projet (v5.22).

## Références

- `CLAUDE.md` §9 — Workflow base de données.
- `docs/grantflow_ddl_postgresql.sql` — source de vérité du schéma.
- Prisma docs — [Limitations of `prisma migrate` with database-level features](https://www.prisma.io/docs/orm/prisma-migrate).
- PostgreSQL docs — [Generated Columns](https://www.postgresql.org/docs/current/ddl-generated-columns.html), [Triggers](https://www.postgresql.org/docs/current/trigger-definition.html).
- Note de cadrage Phase 0, §15 — Impacts DDL et stratégie de migration.

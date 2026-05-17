# CLAUDE.md — Contexte projet GRANTFLOW IPD

> Ce fichier est lu automatiquement par Claude (dans Cowork, Claude Code, Antigravity et tout autre agent compatible). Il fournit le contexte indispensable pour collaborer efficacement.

## 1. Identité du projet

- **Nom** : GRANTFLOW IPD
- **Type** : Plateforme web d'automatisation Procure-to-Account et de comptabilité analytique multi-bailleurs
- **Client / structure** : Institut Pasteur de Dakar — Direction Finance & Comptabilité
- **Cadre** : Mémoire MIAGE 2025/2026 — El Hadj Amadou NIANG
- **Référentiel comptable** : SYSCEBNL (OHADA) — fiscalité sénégalaise

## 2. Vocabulaire et règles d'or

### Acronymes à connaître
- **DA** = Demande d'Achat (Purchase Request, PR)
- **BC** = Bon de Commande (Purchase Order, PO)
- **GR** = Goods Receipt (réception)
- **FNP** = Facture Non Parvenue (clôture)
- **CCA / PCA** = Charges / Produits Constatés d'Avance
- **TER** = Tableau des Emplois et Ressources (état SYSCEBNL)
- **PI** = Principal Investigator (responsable scientifique)
- **DAF** = Directeur Administratif et Financier
- **Overhead** = frais administratifs facturables au bailleur (taux conventionnel)

### Règles d'or
1. **Imputation analytique obligatoire à la source** (dès la DA) : projet + grant + ligne budgétaire + centre de coût + activité.
2. **Comptabilité d'engagement** : un BC validé crée une écriture en classe 8 ; une facture crée une écriture en classe 4/6.
3. **Contrôle budgétaire** : aucune DA ne peut être soumise si le solde de la ligne budgétaire est insuffisant.
4. **Multidevises** : la comptabilité est tenue en XOF ; les écritures multidevises stockent la valeur en devise + équivalent XOF + taux.
5. **Piste d'audit immuable** : toute écriture et toute modification est journalisée avec chaînage hash SHA-256.
6. **Séparation des tâches** : le saisisseur ≠ le valideur (pour les DA, BC, factures, écritures, paiements).
7. **Périodes fiscales** : aucune écriture ne peut être passée ou modifiée dans une période close.

### Données toujours à respecter
- Devise par défaut : **XOF** (Franc CFA UEMOA)
- Fuseau horaire : **Africa/Dakar (UTC+0)**
- Langue UI primaire : **français**, secondaire : **anglais** (i18n)
- Format des dates : **ISO 8601** (`YYYY-MM-DD`) en base, format français côté UI (`14/05/2026`)
- Format des nombres : **séparateur de milliers = espace insécable**, décimal = virgule

## 3. Architecture

- **Monorepo npm workspaces** : `apps/web` (Next.js), `apps/api` (NestJS), `packages/shared` (types partagés Zod).
- **Modular monolith** au démarrage, extraction progressive en micro-services après le pilote.
- **PostgreSQL** comme source de vérité, **Prisma** comme ORM unique.
- **Redis + BullMQ** pour les jobs asynchrones (OCR, génération de rapports, runs de paiement).
- **MinIO** pour le stockage des PDF de factures et pièces jointes.
- **Keycloak** pour l'authentification OIDC + MFA + RBAC.
- **Schémas Postgres** par bounded context : `auth`, `ref`, `procurement`, `ap`, `gl`, `co`, `reporting`, `audit`.

## 4. Conventions de code

### Général
- TypeScript strict : `"strict": true`, jamais de `any`, préférer `unknown` puis narrowing.
- ESLint + Prettier configurés dans `.eslintrc.cjs` et `.prettierrc`.
- Convention de nommage : **camelCase** pour variables/fonctions, **PascalCase** pour types/classes, **kebab-case** pour fichiers, **snake_case** pour colonnes SQL.
- Aucune chaîne de caractères "magique" : préférer enums TypeScript ou constantes typées.

### Frontend (Next.js)
- App Router uniquement (`apps/web/app/`), pas de `pages/`.
- Server Components par défaut, `"use client"` uniquement quand nécessaire.
- `app/(authenticated)/...` pour les pages protégées.
- Composants UI dans `components/ui/` (shadcn/ui) ; composants applicatifs dans `components/`.
- Appels API via `lib/api-client.ts` avec TanStack Query.
- Tous les forms utilisent React Hook Form + Zod.

#### Charte couleur IPD (aqua institutionnel)
- **Primaire** : `ipd` (#4FC3D9) — aqua doux / teal institutionnel. Le nom historique « Pasteur rouge » ne s'applique PAS à l'IPD.
- **Secondaire** : `navy` (#1E3A5F) — pour graphiques + transitions.
- **Règles d'usage AA** :
  - `bg-ipd` → grandes surfaces (header, hero, login aside).
  - `bg-ipd-dark` (#2BA0B8) → **boutons primaires** (texte blanc reste lisible).
  - `text-ipd-darker` (#1B7A8E) → texte de marque sur fond clair (titres, liens).
  - `bg-ipd-50/100` → fonds très clairs (items actifs sidebar, hover doux).
  - **Jamais** `bg-ipd` + `text-white` ensemble (contraste insuffisant).
- Tokens shadcn (`--primary`, `--ring`, `--accent`) mappés sur cette charte dans `globals.css`.

### Backend (NestJS)
- Un module par bounded context : `auth/`, `procurement/`, `ap/`, `gl/`, `co/`, `reporting/`, `treasury/`, `referential/`.
- Pattern Controller → Service → Repository (Prisma).
- DTO d'entrée validés par Zod (via `nestjs-zod`).
- Tous les endpoints sont versionnés sous `/api/v1/`.
- Exceptions métier : utiliser `BusinessException` (à créer dans `common/`).
- Logger structuré (Pino) avec correlation-id.

### Base de données
- Convention de nommage : `snake_case`, pluriel pour les tables (`purchase_requests`).
- Toutes les tables ont : `id UUID PK`, `created_at`, `updated_at`.
- Soft delete : utiliser `deleted_at TIMESTAMP` au lieu de DELETE physique.
- Index obligatoires sur les FK et colonnes de filtre fréquent.
- **Workflow d'évolution du schéma : voir section 9 (DDL-first) — `prisma migrate dev` est INTERDIT.**

## 5. Tests

- **Unitaires** (services, utilitaires) : Jest, couverture > 80 %.
- **Intégration** (API) : Supertest + base de test PostgreSQL éphémère.
- **End-to-end** (parcours utilisateur) : Playwright sur `apps/web`.
- Tout PR doit passer `npm run lint`, `npm run typecheck`, `npm run test`.

## 6. Sécurité

- Tous les endpoints protégés par JWT (sauf `/health`, `/login`).
- RBAC granulaire : décorateur `@RequirePermission('procurement.pr.create')`.
- Validation Zod sur **toutes** les entrées utilisateur.
- Pas de secret en clair dans le code : tout passe par `.env` (chargé via `@nestjs/config`).
- Helmet, CORS strict, rate limiting (10 req/s par utilisateur en défaut).
- Logs jamais contenir de PII (e-mails masqués, IBAN partiel).

## 7. Communication avec Claude

Quand Claude m'aide (Cowork, Antigravity, etc.) :
- **Toujours** lire ce fichier d'abord avant d'écrire du code.
- Préférer des **petits changements incrémentaux** plutôt que de gros refactors.
- Toujours **expliquer la décision** (en commentaire ou réponse) avant le code.
- **Ne jamais** inventer un fournisseur, un bailleur ou une convention : utiliser les seeds existants ou demander.
- **Toujours** mettre à jour les tests quand le code change.

## 8. À ne pas faire

- ❌ Pas d'écriture comptable sans imputation analytique.
- ❌ Pas de modification d'une période fiscale close.
- ❌ Pas de soft delete d'une écriture validée (`posted`).
- ❌ Pas de stockage de mot de passe en base (Keycloak gère).
- ❌ Pas de hardcoding du taux d'overhead (vient de la convention).
- ❌ Pas de duplication de logique métier entre `apps/web` et `apps/api` : factoriser dans `packages/shared`.
- ❌ Pas d'utilisation de `prisma migrate dev` ou `prisma migrate deploy` (voir section 9).
- ❌ Pas d'écriture côté code applicatif des colonnes `GENERATED ALWAYS AS STORED` (`line_total`, `overhead_amount`) — PostgreSQL les calcule.

## 9. Workflow base de données — DDL-first (CRITIQUE)

**La source de vérité du schéma de données est `docs/grantflow_ddl_postgresql.sql`, PAS le `schema.prisma`.**

### Pourquoi
Le métier comptable impose des invariants critiques qui doivent être protégés au niveau du moteur de base (et pas seulement de l'ORM) :
- Trigger `gl.check_entry_balance` — équilibre débit = crédit obligatoire à chaque écriture validée.
- Trigger `gl.check_period_open` — interdiction de modifier une période close.
- Trigger `audit.compute_hash_chain` — chaînage SHA-256 inviolable des événements d'audit.
- Colonnes `GENERATED ALWAYS AS STORED` — calculs déterministes (`line_total`, `overhead_amount`).
- Contraintes `CHECK` — classe comptable ∈ 1-9, débit ⊕ crédit exclusif, montants positifs.
- Vues `co.v_budget_tracking` et `gl.v_general_balance` — sources des suivis temps réel.

Prisma ne sait pas générer ces constructions. Toute commande `prisma migrate` les supprimerait silencieusement.

### Workflow officiel

**Initialisation d'une base vierge** (dev ou prod) :
```bash
# 1. Lancer Postgres via Docker
docker compose up -d postgres

# 2. Appliquer le DDL (source de vérité)
psql -h localhost -U grantflow -d grantflow_dev -f docs/grantflow_ddl_postgresql.sql

# 3. Générer le client Prisma typé
cd apps/api && npm run prisma:generate

# 4. Charger les données métier depuis seed/*.json
npm run prisma:seed
```

**Évolution du schéma** :
1. Modifier `docs/grantflow_ddl_postgresql.sql` en premier (revue obligatoire par le contrôle de gestion si la modification touche aux classes comptables, conventions, fonds dédiés).
2. Préparer une migration SQL idempotente (`ALTER TABLE`, `CREATE INDEX IF NOT EXISTS`, etc.) — pas un drop/recreate.
3. Appliquer la migration en environnement de dev.
4. Lancer `npx prisma db pull` pour synchroniser `apps/api/prisma/schema.prisma`.
5. Lancer `npm run prisma:generate` pour mettre à jour le client.
6. Vérifier que les triggers, CHECK et GENERATED sont toujours présents (`\d+ table_name` dans psql).
7. Ajouter un test d'intégration qui couvre la nouvelle contrainte.

### Colonnes calculées : règle d'or
Ne JAMAIS écrire dans le code applicatif les colonnes calculées par PostgreSQL :
- `purchase_request_line.line_total`
- `purchase_order_line.line_total`
- `invoice_line.line_total` (si applicable)
- `co.overhead_calculation.overhead_amount`

Les modèles Prisma les exposent en lecture seule de fait — toute tentative d'écriture sera rejetée par PostgreSQL.

---

_Dernière mise à jour : 14/05/2026 — El Hadj Amadou NIANG_

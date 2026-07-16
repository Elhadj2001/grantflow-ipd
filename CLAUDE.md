# CLAUDE.md — Contexte projet GRANTFLOW IPD

> Ce fichier est lu automatiquement par Claude (dans Cowork, Claude Code, Antigravity et tout autre agent compatible). Il fournit le contexte indispensable pour collaborer efficacement.

## 0. Documents de référence (lire avant toute action structurante)

- **`docs/cadrage-phase-0.md`** — note de cadrage stratégique : domaine métier IPD, mapping vs codebase, hypothèses Q1-Q5, modélisation conceptuelle, plan 12 mois.
- **`docs/adr/`** — Architecture Decision Records (DDL-first, Modular monolith, Multidevise tripartite, Grant Office, Eligibility engine, SoD, Immutabilité rapports).
- **`docs/memoire-plan.md`** — plan du mémoire MIAGE et trajectoire de rédaction.
- **`docs/backlog-initial.md`** — backlog sprintable 12 mois avec user stories US-XXX et critères Gherkin.
- **`docs/audit-codebase-2026-06-02.md`** — audit transversal 28 findings, base de la roadmap de résorption.
- **`docs/INDEX.md`** — point d'entrée navigable de toute la documentation.

## 1. Identité du projet

- **Nom** : GRANTFLOW IPD
- **Type** : Plateforme web d'automatisation Procure-to-Account et de comptabilité analytique multi-bailleurs
- **Client / structure** : Institut Pasteur de Dakar — Direction Finance & Comptabilité
- **Cadre** : Mémoire MIAGE 2025/2026 — El Hadj Amadou NIANG
- **Référentiel comptable** : SYSCEBNL (OHADA) — fiscalité sénégalaise
- **Soutenance cible** : fin mai 2027

## 2. Vocabulaire et règles d'or

### Acronymes et entités à connaître
- **DA** = Demande d'Achat (Purchase Request, PR)
- **BC** = Bon de Commande (Purchase Order, PO)
- **GR** = Goods Receipt (réception)
- **FNP** = Facture Non Parvenue (clôture)
- **CCA / PCA** = Charges / Produits Constatés d'Avance
- **TER** = Tableau des Emplois et Ressources (état SYSCEBNL)
- **PI** = Principal Investigator (responsable scientifique)
- **GO** = Grant Office (cellule administrative IPD interface bailleurs ↔ opérationnel — rédige la **Note Technique**)
- **DAF** = Directeur Administratif et Financier (valide Note Technique, co-signe rapports financiers)
- **Directeur** = Directeur Général ou Scientifique (co-signe rapports bailleur avec le DAF)
- **CG** = Contrôleur de Gestion (imputation analytique, disponibilité budgétaire)
- **Overhead** = frais administratifs facturables au bailleur (taux conventionnel, peut être différencié par catégorie de dépense — cf. ADR-006)
- **Note Technique** = document GO traduisant une convention en infrastructure budgétaire activée (entité de premier plan, cf. ADR-006)
- **Eligibility Engine** = moteur centralisé de validation des règles d'éligibilité issues du PPT IPD (cf. ADR-007)
- **Maquette bailleur** = template de rapport financier imposé par le bailleur, utilisé tel quel par le système

### Règles d'or
1. **Imputation analytique obligatoire à la source** (dès la DA) : projet + grant + ligne budgétaire + centre de coût + activité + nature de dépense.
2. **Comptabilité d'engagement** : un BC validé crée une écriture en classe 8 ; une facture crée une écriture en classe 4/6.
3. **Contrôle budgétaire en XOF** : aucune DA ne peut être soumise si l'équivalent XOF de la dépense fait dépasser le solde de la ligne budgétaire (cf. ADR-005).
4. **Multidevise tripartite** : devise transactionnelle + fonctionnelle XOF (tenue SYSCEBNL) + devise de reporting (selon contexte). Stockage systématique du triplet `*_amount`, `*_amount_xof`, `*_fx_rate`, `*_fx_rate_date` (cf. ADR-005).
5. **Piste d'audit immuable** : toute écriture et toute modification est journalisée avec chaînage hash SHA-256 au niveau du trigger PostgreSQL `audit.compute_hash_chain`.
6. **Séparation des tâches enforced par identité** : le saisisseur ≠ le valideur pour DA, BC, GR, factures, écritures, paiements. Dérogation explicite via convention `single_actor_authorized` ou break-glass SUPER_ADMIN avec `bypass_reason` obligatoire (cf. ADR-009).
7. **Périodes fiscales** : aucune écriture ne peut être passée ou modifiée dans une période close (trigger `gl.check_period_open`).
8. **Eligibility engine centralisé** : aucune validation d'éligibilité métier (nature, date, plafond, refacturation Pasteur Paris) ne doit exister hors du moteur `EligibilityEngine` (cf. ADR-007).
9. **Note Technique comme source de vérité budgétaire** : les contraintes d'éligibilité, le taux d'overhead, les échéances de reporting sont portées par la Note Technique active de la convention, pas par le Grant nu (cf. ADR-006).
10. **Immutabilité des rapports publiés** : un rapport bailleur transmis ne peut pas être modifié ; toute correction crée une nouvelle version avec **colonne d'ajustement** explicite et nouveau total (cf. ADR-011).

### Données toujours à respecter
- Devise par défaut : **XOF** (Franc CFA UEMOA)
- Fuseau horaire : **Africa/Dakar (UTC+0)**
- Langue UI : **français uniquement**. L'internationalisation est portée par les **rapports bailleur uniquement** (selon la maquette transmise par chaque bailleur, souvent EN). Pas d'i18n UI prévue (cf. cadrage Q4 et ADR-008).
- Format des dates : **ISO 8601** (`YYYY-MM-DD`) en base, format français côté UI (`14/05/2026`)
- Format des nombres : **séparateur de milliers = espace insécable**, décimal = virgule
- Parité fixe BCEAO : **1 EUR = 655,957 XOF** (immuable, garantie Trésor français). Codée en dur dans `ExchangeRateService`.

## 3. Architecture

- **Monorepo npm workspaces** : `apps/web` (Next.js), `apps/api` (NestJS), `packages/shared` (types partagés Zod).
- **Modular monolith** au démarrage, extraction progressive en micro-services après le pilote.
- **PostgreSQL** comme source de vérité, **Prisma** comme ORM unique.
- **Redis + BullMQ** pour les jobs asynchrones (OCR, génération de rapports, runs de paiement).
- **MinIO** pour le stockage des PDF de factures et pièces jointes.
- **Keycloak** pour l'authentification OIDC + MFA + RBAC.
- **Schémas Postgres** par bounded context : `auth`, `ref`, `procurement`, `ap`, `gl`, `co`, `reporting`, `audit`. À étendre Phase 5A avec `grant_office` (Note Technique, eligibility, overhead rules) et `compliance_audit` (audit conventionnel).
- **Cloud cible 12 mois** : Render (API + Keycloak Docker) + Vercel (Web) + Neon (Postgres) + Cloudflare R2 (storage) + Mailtrap (SMTP sandbox). Migration vers infra IPD on-premise prévue post-soutenance (cf. ADR-013 à formaliser).

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

#### Charte couleur IPD (charte officielle 2025)
- **Source de vérité** : `docs/design/CHARTE_OFFICIELLE_2025.md` (extraite du
  brand manual IPD 2025 — copie du projet frère « Enregistrement Fact et Paie »).
- **Primaire** : `ipd-bleu` (#0089D0). **Secondaires** : `ipd-navy` (#052A62),
  `ipd-bleu-clair` (#86B4DD), `ipd-beige` (#E3E0D8), `ipd-taupe` (#BFB8B0).
  **Neutres** : `ipd-gris` (#D7D8DB), `ipd-gris-clair` (#F2F3F5, fond body), blanc.
  L'ancienne palette aqua (#4FC3D9/#2BA0B8/#1B7A8E) et `cream` sont RETIRÉES.
- **Typographie** : Poppins Bold = titres (h1-h4, navy), Poppins Light =
  sous-titres (bleu), Lato Regular = corps. Vendored dans `apps/web/app/fonts/`
  (`next/font/local`, `--font-poppins` / `--font-lato`, classes `font-titre`
  / `font-corps` ; `font-sans` = Lato).
- **Logos** (`apps/web/public/img/`) : `logo_ipd_couleur.png` sur fonds clairs,
  `logo_ipd_blanc.png` sur fonds sombres (sidebar navy, login),
  `icone_ipd_blanc.png` pour le menu replié, `logo_ipd_noir.png` monochrome.
- **Règles d'usage AA** :
  - `bg-ipd-bleu` + `hover:bg-ipd-bleu-dk` (#0070AD) + `shadow-btn` → boutons primaires.
  - `text-ipd-bleu-fonce` (#055A8C) → texte de marque sur fond clair / badges bleus.
  - Sidebar : dégradé `from-ipd-navy to-ipd-navy-2`, texte `ipd-nav-texte`,
    item actif `shadow-actif` (liseré bleu inset) + `bg-ipd-bleu/30`.
  - Badges de statut : teintes douces `*-tint` + texte foncé associé
    (`.ipd-badge` / variantes `ui/badge.tsx`) — jamais de texte blanc sur tint.
  - Cartes : `rounded-carte` (12px) + `shadow-douce` + `border-ipd-bordure-carte`.
- Tokens shadcn (`--primary`, `--ring`, `--accent`, `--secondary`) mappés sur
  cette charte dans `globals.css`. Aucun hex de marque en dur dans les
  composants : uniquement les tokens `ipd-*` de `tailwind.config.ts`.

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

- ❌ Pas d'écriture comptable sans imputation analytique complète (projet + grant + ligne + cost center + activité + nature).
- ❌ Pas de modification d'une période fiscale close (trigger PG l'empêche, mais valider en amont applicatif aussi).
- ❌ Pas de soft delete d'une écriture validée (`posted`).
- ❌ Pas de stockage de mot de passe en base (Keycloak gère).
- ❌ Pas de hardcoding du taux d'overhead (vient de la Note Technique active de la convention).
- ❌ Pas de duplication de logique métier entre `apps/web` et `apps/api` : factoriser dans `packages/shared`.
- ❌ Pas d'utilisation de `prisma migrate dev` ou `prisma migrate deploy` (voir section 9).
- ❌ Pas d'écriture côté code applicatif des colonnes `GENERATED ALWAYS AS STORED` (`line_total`, `overhead_amount`) — PostgreSQL les calcule.
- ❌ Pas de comparaison de montant brut à un seuil XOF sans conversion préalable via `ExchangeRateService.convertToXof` (cf. ADR-005).
- ❌ Pas de validation d'éligibilité métier (nature, date, plafond, refacturation Pasteur Paris) hors du moteur `EligibilityEngine` (cf. ADR-007).
- ❌ Pas d'approbation par le créateur de l'opération (saisisseur ≠ valideur, cf. ADR-009). Dérogation = convention `single_actor_authorized = true` ou header `X-Bypass-SoD-Reason`.
- ❌ Pas de modification d'un rapport bailleur en statut `transmitted` (cf. ADR-011). Toute correction = nouvelle version avec colonne d'ajustement.
- ❌ Pas de `Number(decimal)` sur un montant Decimal Prisma utilisé dans un agrégat ou une comparaison comptable (perte de précision float64 — cf. audit finding F10).
- ❌ Pas de validation d'éligibilité Zod en doublon de l'EligibilityEngine : Zod valide la structure, le moteur valide la cohérence métier.

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

### Convention sprint : section additive DDL + migration extraite

Chaque sprint qui touche au DDL ajoute :
1. Une section additive idempotente en fin de `grantflow_ddl_postgresql.sql`,
   délimitée par un commentaire `-- Sprint SX / US-XXX — description`.
   Tous les `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, `CREATE INDEX
   IF NOT EXISTS`, etc.
2. Un fichier migration extrait dans `docs/migrations/YYYY-MM-DD-sprint-SX-description.sql`
   contenant strictement la même section, en-tête de traçabilité, et
   requête de vérification post-migration.
3. Le DDL principal reste la source de vérité ; le fichier migration
   est un extrait dérivé pour application opérationnelle sur les
   bases existantes (Neon prod, dev local) sans rejouer tout le DDL.

### Colonnes calculées : règle d'or
Ne JAMAIS écrire dans le code applicatif les colonnes calculées par PostgreSQL :
- `purchase_request_line.line_total`
- `purchase_order_line.line_total`
- `invoice_line.line_total` (si applicable)
- `co.overhead_calculation.overhead_amount`

Les modèles Prisma les exposent en lecture seule de fait — toute tentative d'écriture sera rejetée par PostgreSQL.

---

## 10. Workflow de développement (cadence sprint)

Le projet est désormais cadencé en **sprints de 2 semaines** (S1, S2, …) avec démarrage le lundi et démo personnelle le vendredi de la 2ᵉ semaine. Le backlog complet est dans `docs/backlog-initial.md`, avec une cadence cible de 36-47 story points par sprint.

**Convention de branche** : `feature/sprint-SX-US-XXX-slug` pour les stories, `fix/finding-FNN-slug` pour les correctifs d'audit.

**Convention de commits** : `<type>(<scope>): <message>` avec types `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `perf`.

**Definition of Done** : code mergé `main`, tests passent, couverture stable, doc à jour (ADR/CLAUDE.md/README module), illustration E2E ou capture quand pertinent.

---

_Dernière mise à jour : 02/06/2026 — El Hadj Amadou NIANG (réalignement post-cadrage Phase 0)_

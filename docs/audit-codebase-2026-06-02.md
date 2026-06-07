# Rapport d'audit transversal — GRANTFLOW IPD

> **Destinataire** : Claude Cowork (analyse + proposition de solutions).
> **Date** : 2026-06-02 · **Périmètre** : monorepo complet (`apps/api`, `apps/web`, `packages/shared`, DDL).
> **Méthode** : 6 analyses parallèles en lecture seule (backend services, DTO/enums, alignement DDL-first, frontend, tests, sécurité/dette transversale). Aucune modification de code.
> **Nature** : audit statique. Les findings marqués _« à valider métier »_ doivent être confirmés avec le contrôle de gestion IPD avant correction.

---

## 1. Résumé exécutif

Le projet est **globalement sain en architecture** (pattern Controller→Service→Repository majoritairement respecté, catalogue d'exceptions métier riche, transactions Prisma présentes sur les chemins comptables, alignement DDL↔Prisma structurellement bon, colonnes générées et triggers non contournés). Les problèmes sérieux sont **concentrés sur 3 axes** :

1. **Exactitude comptable multidevise** — la conversion XOF n'est branchée que sur le routage d'approbation ; le **contrôle budgétaire** et les **limites de caisse** comparent encore des montants bruts cross-devise → contrôles d'engagement faussables.
2. **Santé des tests** — **~28 tests API rouges** (pas 5) à cause d'un même défaut systémique : un refactor `count()`→`findFirst()` des générateurs de numéros de séquence non répercuté dans les mocks Prisma de 7 suites.
3. **Cohérence RBAC & séparation des tâches** — un drift front/back garantit un 403 (clôture/TRESORIER), plusieurs items de menu non gatés, et surtout **la séparation des tâches (saisisseur ≠ valideur) n'est pas enforced côté serveur**.

À cela s'ajoute une **dette de redondance** importante (helpers copiés ~35×, `resolveAppUserId` dupliqué ~10×, `FULL_VIEW_ROLES` redéfini 4× avec contenus divergents) et l'**i18n annoncée mais inexistante**.

### Tableau de bord par sévérité

| # | Finding | Sévérité | Axe |
|---|---|---|---|
| F1 | Contrôle budgétaire & limites caisse sans conversion XOF | 🔴 CRITIQUE | Compta |
| F2 | ~28 tests API rouges (mocks `findFirst` périmés, 7 suites) | 🔴 CRITIQUE | Tests |
| F3 | Séparation des tâches (saisisseur ≠ valideur) non enforced serveur | 🔴 CRITIQUE | Sécurité |
| F4 | Drift RBAC : `canViewClosure()` autorise TRESORIER, back le refuse → 403 | 🔴 CRITIQUE | RBAC |
| F5 | `packages/shared` `PrStatus` incomplet (manque `pending_caissier`, `settled`) | 🔴 CRITIQUE | Enums |
| F6 | Items sidebar sans gating `visible` → 403 BAILLEUR/MAGASINIER | 🟠 MAJEUR | RBAC |
| F7 | `resolveAppUserId` dupliqué ~10× + 3 controllers écrivent en base | 🟠 MAJEUR | Archi |
| F8 | `FULL_VIEW_ROLES` redéfini 4× avec contenu divergent | 🟠 MAJEUR | RBAC |
| F9 | Audit `event_log` dérivé de l'URL + erreurs swallow (pas au niveau domaine) | 🟠 MAJEUR | Audit |
| F10 | `Number()` sur `Prisma.Decimal` dans calculs comptables (44 occ.) | 🟠 MAJEUR | Compta |
| F11 | i18n annoncée (FR/EN) mais 100 % hardcodé FR, aucune lib | 🟠 MAJEUR | Front |
| F12 | Data-fetching dupliqué (hooks n'utilisent pas `use-api.ts`) | 🟠 MAJEUR | Front |
| F13 | 5 enums Prisma validés par tuples littéraux (drift latent type `pending_caissier`) | 🟠 MAJEUR | Enums |
| F14 | Helpers Zod (`coerceInt`/`coerceBool`/`ISO_DATE`) copiés ~35× | 🟠 MAJEUR | Archi |
| F15 | Couplage cross-context PO→Invoice (feature démo dans service prod) | 🟠 MAJEUR | Archi |
| F16 | `bg-ipd` + `text-white` dans AppHeader (viole charte CLAUDE.md) | 🟠 MAJEUR | Front |
| F17 | Dépendances obsolètes/vulnérables (multer 1.x, xlsx, next 14.2, axios) | 🟠 MAJEUR | Sécu |
| F18 | `createCommitmentEntry` multidevise sans équivalent XOF/taux | 🟠 MAJEUR | Compta |
| F19 | Colonnes TEXT à sémantique d'enum non typées (`payment_run.status`…) | 🟠 MAJEUR | DDL |
| F20 | Suite e2e auth/RBAC `describe.skip` en dur | 🟠 MAJEUR | Tests |
| F21 | Controllers critiques sans tests unitaires (posting, treasury, invoice…) | 🟠 MAJEUR | Tests |
| F22 | Tests fragiles : `new Date()` non mocké, années `2026` en dur (10 specs) | 🟠 MAJEUR | Tests |
| F23 | Formatage montants/dates éclaté (toLocaleString inline vs composants) | 🟡 MINEUR | Front |
| F24 | Listes de devises dupliquées 3× ; bornes `pageSize` incohérentes | 🟡 MINEUR | Enums |
| F25 | Exceptions HTTP Nest nues mêlées au catalogue métier (controllers) | 🟡 MINEUR | Archi |
| F26 | `gr_status` dépend d'un `ALTER TYPE` post-création (DDL partiel = drift) | 🟡 MINEUR | DDL |
| F27 | Secret client Keycloak en clair dans `realm.json` (placeholder dev) | 🟡 MINEUR | Sécu |
| F28 | Script `npm run test:int` référence un `jest-int.config.js` inexistant | 🟡 MINEUR | Tests |

---

## 2. Findings détaillés

### 🔴 F1 — Contrôle budgétaire & limites de caisse sans conversion XOF (CRITIQUE)

> [Résolu Sprint S2 — main b2eb7bd — US-010+US-011+US-012+US-014]

Un correctif récent (`fix-approval-workflow-currency-conversion`) a branché `ExchangeRateService.convertToXof` **uniquement** sur le routage par seuil d'approbation (`approval-workflow.service.ts:117-119`). Les deux **autres** comparaisons financières restent en montant brut :

- **Contrôle budgétaire** — `purchase-request.service.ts` `computeBudgetUsageByLine` (~l.606-621) compare `budgetLine.budgetedAmount` (XOF) à `Number(l.lineTotal)` et aux agrégats PR+PO **dans leur devise d'origine**. Une DA de 100 000 EUR (~65,6 M XOF) consomme « 100 000 » contre un budget XOF → engagement faux. `checkBudget` (~l.441-443) et `submit` (~l.483-490) héritent du défaut. **Viole les Règles d'or n°3 et n°4 du CLAUDE.md.**
- **Limites caisse** — `purchase-request.service.ts` `assertCashInvariants` (~l.264-300) compare `totalAmount` à `cashBox.perRequestMax` / `perDayUserMax` sans conversion. Le décrément caisse (`approval-workflow.service.ts:152,194`) soustrait aussi `totalAmount` brut du `currentBalance` → mélange de devises sur le solde.

**Solution attendue** : généraliser `convertToXof` à `computeBudgetUsageByLine`, `assertCashInvariants` et au décrément caisse, en convertissant chaque montant dans la devise de la cible (ligne budgétaire / caisse) avant comparaison. _À valider métier : les budgets/caisses sont-ils toujours en XOF ?_

---

### 🔴 F2 — ~28 tests API rouges, défaut systémique (CRITIQUE)

> [Résolu Sprint S2bis — main 6e30f32 — US-060+US-061 : createPrismaMock helper via mockDeep<PrismaService>(), 7 specs migrées (dedicated-funds, posting-payment, posting, goods-receipt, payment-run, purchase-order, purchase-request). Compteur F2 28 → 0. CI 100 % verte (1029/1029).]

Diagnostic initial (5 tests `tx.purchaseRequest.findFirst is not a function`) **confirmé ET étendu**. Cause racine : refactor des générateurs de numéros de séquence `count()`→`findFirst()` (« MAX résilient aux trous ») **non répercuté dans les mocks Prisma littéraux**. Comme `$transaction` passe `prisma` lui-même comme `tx`, tout test atteignant la création plante.

| Service (l.) | Méthode tx manquante | Spec | Rouges |
|---|---|---|---|
| `purchase-request.service.ts:535` | `purchaseRequest.findFirst` | `purchase-request.service.spec.ts:123` | 5 |
| `accounting/services/dedicated-funds.service.ts` | `journalEntry.findFirst` | `dedicated-funds.service.spec.ts` | 6 |
| `accounting/services/posting.service.ts:1185` | `journalEntry.findFirst` | `posting-payment.service.spec.ts` | 6 |
| `accounting/services/posting.service.ts:1185` | idem (OD-number) | `posting.service.spec.ts` | 2 |
| `procurement/services/goods-receipt.service.ts` | `goodsReceipt.findFirst` | `goods-receipt.service.spec.ts` | 4 |
| `treasury/services/payment-run.service.ts` | `paymentRun.findFirst` | `payment-run.service.spec.ts` | 2 |
| `procurement/services/purchase-order.service.ts` | `purchaseOrder.findFirst` | `purchase-order.service.spec.ts` | 3 |

**Solution attendue** : (a) correctif rapide = stubber `findFirst` dans les 7 mocks ; (b) **correctif racine = remplacer les mocks littéraux `jest.fn()` par `mockDeep<PrismaService>()` (jest-mock-extended)**, ce qui auto-stube toute méthode et empêche la réapparition du défaut. Le code de production est correct ; ce sont les mocks qui sont périmés.

---

### 🔴 F3 — Séparation des tâches non enforced côté serveur (CRITIQUE — à valider métier)

CLAUDE.md §6 / Règle d'or n°6 : saisisseur ≠ valideur. **Aucune vérification `actor != créateur`** n'a été trouvée :

- `approval-workflow.service.ts:93-212` (`approveCurrentStep`) ne contrôle que le **rôle** (`assertRoleMatches`) + l'ownership PI. Un utilisateur cumulant `DEMANDEUR` + `PI`/`CONTROLEUR`/`DAF` peut créer **puis approuver** sa propre DA — `pr.requestedBy` n'est jamais comparé à `appUserId`.
- `payment-run.service.ts:397` (`approve`) : `approvedBy` jamais comparé à `preparedBy` (l.171) → même trésorier prépare et approuve.
- `posting.service.ts` (`postedBy`) : pas de contrôle vis-à-vis du créateur de la facture/BC.
- Aggravants : `SUPER_ADMIN` bypass total + **auto-provisioning silencieux** d'`app_user` (un compte inconnu est créé à la volée, brouillant la traçabilité).

**Solution attendue** : ajouter des gardes `requestedBy !== approverId`, `preparedBy !== approvedBy`, etc., levant une `BusinessException` dédiée (`SegregationOfDutiesException`). Décider du traitement de `SUPER_ADMIN` (bypass documenté ou non). _À valider métier : tolérance sur petites structures où une personne porte plusieurs rôles ?_

---

### 🔴 F4 — Drift RBAC clôture : 403 garanti pour TRESORIER (CRITIQUE)

- Front : `use-permissions.ts:311-312` → `canViewClosure()` autorise `TRESORIER`.
- Back : `accounting.controller.ts:48` (`GET /accounting/periods`, `/events`, `/checks`) gated `('COMPTABLE','CONTROLEUR','DAF','SUPER_ADMIN')` — **TRESORIER absent**.
- Effet : `AppSidebar.tsx:101` affiche « Clôture » au TRESORIER → la page appelle `usePeriods()` → **403**.

**Solution attendue** : trancher la règle métier (TRESORIER voit-il la clôture ?) puis aligner les deux côtés. Idéalement, **dériver les permissions front d'une source partagée** plutôt que de redupliquer les `@Roles`.

---

### 🔴 F5 — `packages/shared` `PrStatus` incomplet (CRITIQUE — contrat faux)

`packages/shared/src/index.ts:13` : le `z.enum` partagé liste **9 statuts** mais omet `pending_caissier` ET `settled` (présents dans Prisma `PrStatus`). C'est exactement le bug `pending_caissier` déjà rencontré en query DTO, non corrigé dans le package « source partagée ». Idem `PoStatus`/`InvoiceStatus` partagés = tuples figés.

Aggravant structurel : **3 définitions divergentes de `PrStatus`** coexistent — `shared` (incomplète), `apps/web/lib/api/procurement.ts:9` (correcte, redéclarée à la main), `@prisma/client` (autorité). L'API n'importe **pas** les enums de `shared` (elle utilise `@prisma/client`, mieux). Le package n'apporte donc **aucune garantie d'alignement**.

**Solution attendue** : soit (a) faire de `packages/shared` la vraie source unique en y générant les enums depuis Prisma et en les important côté web ; soit (b) **retirer le package** s'il n'est pas réellement partagé. Ne pas laisser un contrat faux.

---

### 🟠 Findings MAJEURS (résumé actionnable)

- **F6 — Items sidebar sans `visible`** : `AppSidebar.tsx` « Achats » (l.54), « Comptabilité/invoices » (l.87), « Trésorerie » (l.104) n'ont aucun prédicat. BAILLEUR/MAGASINIER les voient → 403 sur `GET /invoices`, `/payment-runs`, `/purchase-requests`. Ajouter `visible: canListInvoices()` / `canListPaymentRuns()` / `canListPurchaseRequests()` (ce dernier helper **manque** dans `use-permissions.ts`).
- **F7 — `resolveAppUserId` dupliqué ~10×** (purchase-request:672, approval-workflow:588, purchase-order:937, goods-receipt:655, invoice:722, pilotage:438, + variante `resolveActor` dans **3 controllers** : payment-run.controller:322, reporting.controller:332, accounting.controller:221). Les 3 controllers **écrivent en base** (`appUser.create`) → viole Controller→Service→Repository. Extraire un `AppUserResolver` partagé ; idéalement la `JwtStrategy` expose `actor.id`.
- **F8 — `FULL_VIEW_ROLES` redéfini 4× divergent** : purchase-request:34 & invoice:39 = `{CG,DAF,COMPTABLE,TRESORIER,SA}` ; purchase-order:60 & goods-receipt:37 = **+ ACHETEUR + MAGASINIER**. Même nom, sens différent selon le module. Unifier dans un module RBAC central.
- **F9 — Audit non fiable** : `audit.event_log` écrit **uniquement** par l'intercepteur HTTP. `entityType`/`entityId` dérivés de l'**URL** (`audit-log.service.ts:127-139`), pas de l'entité mutée. `persistSafe` **swallow** les erreurs (l.201-206) → un échec de chaînage hash perd l'événement silencieusement. Mutations hors HTTP (jobs BullMQ, seed) non auditées. **Viole la Règle d'or n°5.** Émettre les événements au niveau domaine + faire échouer la transaction si l'audit échoue.
- **F10 — `Number()` sur `Prisma.Decimal`** (44 occ., 7 fichiers) : posting (débit/crédit × taux), purchase-request (totalAmount), approval-workflow (variance), payment-run (`fullyPaid`). Perte de précision float64 sur des montants comptables. Utiliser `Prisma.Decimal` pour agrégats et comparaisons.
  > [Partiellement résolu Sprint S2 — main b2eb7bd — US-013 : 42 occurrences sur 44 du périmètre comptable strict (95%) migrées vers Decimal natif. Reste ~2 occurrences acceptables aux frontières. Mesure globale grep Number() prod : 227 (inclut frontières convertToXof, DTO, Prisma writes hors périmètre audit). Story future si nouvelle exigence comptable sur les frontières.]
- **F11 — i18n inexistante** : aucune lib (`next-intl`/`react-i18next`), 100 % FR hardcodé, EN absent. L'objectif bilingue du CLAUDE.md n'est pas câblé. Décision produit nécessaire (implémenter ou retirer l'exigence).
- **F12 — Data-fetching dupliqué** : `lib/use-api.ts` expose `useApiQuery`/`useApiMutation` (propres) mais les hooks métier ré-implémentent `useQuery + useSession + try/catch + mapApiErrorToToast` à la main → `useApiQuery` quasi-orphelin. Factoriser les hooks dessus.
- **F13 — 5 enums validés par tuples littéraux** (drift latent) : `DONOR_TYPES` (donor-query:12 **et** create-donor:12, copié 2×), `GRANT_STATUSES` (create-grant:10), `PR_REQUEST_TYPES` (create-pr:5), `PaymentMethodEnum` (payment-run:6). Tous complets aujourd'hui mais reproduisent le pattern du bug `pending_caissier` (ex : ajout très plausible d'un `PaymentMethod 'mobile_money'` au Sénégal → 400). Migrer vers `z.nativeEnum(PrismaEnum)`.
- **F14 — Helpers Zod copiés ~35×** : `coerceInt` (15 fichiers), `coerceBool` (10), `ISO_DATE` (9), bloc pagination (~14). Créer `common/dto/query.helpers.ts` + un builder `paginationSchema({sortFields, maxPageSize})`.
- **F15 — Couplage PO→Invoice** : `purchase-order.service.ts` (:29,:143,:753) appelle `InvoiceService` pour la feature **démo** `F-INVOICE-SIM` — dépendance à rebours du flux P2P qui fuit dans un service de production. Isoler dans un module/contrôleur démo dédié.
- **F16 — Violation charte** : `AppHeader.tsx:66` `bg-ipd text-white` — interdit explicitement par CLAUDE.md §3 (contraste insuffisant). Utiliser `bg-ipd-dark` ou texte foncé.
- **F17 — Dépendances vulnérables** (≈ Dependabot 63/31 high) : `multer@1.4.5` (déprécié, CVE DoS → 2.x), `xlsx@0.18.5` (prototype pollution/ReDoS non patchés sur npm → exceljs ou source SheetJS), `next@14.2.0` (CVE → latest 14.2.x/15), `axios@1.6.0` (→1.7.x), `next-auth@5.0.0-beta` (beta en prod). NestJS 10 / ESLint 8 (EOL).
- **F18 — `createCommitmentEntry` multidevise** : `posting.service.ts:165-188` renseigne `currency: po.currency` mais **pas** `debitCurrency`/`creditCurrency` ni l'équivalent XOF/taux quand `po.currency ≠ XOF`. Viole la Règle d'or n°4. _À valider : les engagements classe 8 sont-ils toujours en XOF ?_
  > [Résolu Sprint S3 — main 610d009 — US-020+US-024+US-021+US-022 : createCommitmentEntry et postPayment convertissent en XOF via ExchangeRateService.convertToXof ; budget_line.budgetedAmountXof matérialisé au paramétrage (figé) ; v_general_balance expose balance_xof comme source de vérité SYSCEBNL ; 5 invariants I1-I5 couverts par sentinelles applicatives (CHECK DB chk_fx_consistency planifié US-140 après backfill USD et fix postInvoice). Suite 1044+/1044+. Complément Sprint S3bis — US-139 : correction du filtre `posted` de v_general_balance (les écritures `draft` ne polluent plus les agrégats — FILTER WHERE je.status='posted'). **Clôturé Sprint S3bis — US-140** : postInvoice (+ extournes) peuplent fx_rate/fx_rate_date sur TOUTES les lignes ; backfill des 4 lignes USD legacy ; CHECK DB `chk_fx_consistency` (I1/I3/I4) + trigger contrainte `trg_check_je_currency_consistency` (I5, XOF-tolérant) ajoutés → invariants désormais enforced au niveau base. F18 totalement résolu.]
- **F19 — Colonnes TEXT à sémantique d'enum** : `payment_run.status` (DDL:564, défaut `'draft'`, n'utilise PAS `ap.payment_status`), `project.status`, `approval_step.status` — TEXT libre côté DDL **et** Prisma `String`, sans garde-fou. Soit créer les types enum Postgres, soit conserver des tests sentinelles (déjà fait pour payment-run).
- **F20 — Auth e2e désactivée** : `auth/__tests__/auth.e2e-spec.ts:22` `describe.skip('Auth & RBAC — integration')` — toute la suite d'intégration RBAC (sécurité) est désactivée en dur.
- **F21 — Controllers critiques sans tests unitaires** : posting, treasury/payment-run, invoice, goods-receipt, purchase-request, pilotage, reporting, accounting controllers n'ont aucun spec unitaire (guards/`@RequirePermission` couverts seulement par des e2e skippés).
- **F22 — Tests fragiles temporels** : 10 specs utilisent `new Date()` sans `jest.useFakeTimers`/`setSystemTime`, avec attentes encodant `2026` en dur (`DA-2026-`, `OD-2026-`) → **casseront au 01/01/2027**.
  > [Mitigation Sprint S2bis — US-062 (d438173) + US-063 — stack non encore mergée sur main : 8 specs migrées vers fakeTimers (horloge figée à 2026-06-15 via `test-utils/fake-time.ts`) ; sentinelle anti-régression `src/__tests__/no-direct-date-in-generators.spec.ts` ajoutée — elle balaye tout le code de production et échoue si `new Date().getFullYear()` (année dérivée de l'horloge) apparaît dans un générateur de séquence hors allowlist documentée. Dette propre restante : injecter un `ClockService` mockable.]

### 🟡 Findings MINEURS

- **F23** — Formatage éclaté : `toLocaleString('fr-FR')`/`Intl.NumberFormat` inline (PurchaseRequestForm:202,424 ; GrantPicker:73 ; DiffTable:157 ; invoices/[id]:365) en parallèle de `AmountDisplay`/`pilotage.formatAmount` → décimales XOF incohérentes. Idem dates (~12 `toLocaleDateString` inline vs `DateDisplay`). Centraliser.
- **F24** — `SUPPORTED_CURRENCIES` (grant) = `SUPPLIER_CURRENCIES` (supplier) = `Currency` (shared) : 3 listes identiques dupliquées. Bornes `pageSize` max incohérentes : 100 (standard), 50 (tax-code:24), 200 (exchange-rate:27), 500 (gl-account:27). payment-run utilise `z.coerce.number()` au lieu du `coerceInt` maison.
- **F25** — Exceptions HTTP Nest nues mêlées au catalogue métier dans les controllers (invoice:80,82 ; pilotage:98,126 ; budget-line:111) + quelques `throw new Error()` (storage:82, claude-vision-ocr:133). Harmoniser sur `BusinessException`.
- **F26** — `gr_status` créé sans `cancelled` (DDL:65) puis `ALTER TYPE ADD VALUE` (DDL:1118) : une base initialisée sans la section Sprint 4.1 divergerait de Prisma. Consolider l'enum dans le `CREATE TYPE`.
- **F27** — `realm.json:78` secret client OIDC `grantflow-api-dev-secret-2026` en clair (= `.env.example:77`). **Placeholder de dev assumé** (la prod l'override via env Render avec `sync:false`) ; aucun vrai secret (clé API Anthropic, mot de passe Neon, ou DSN avec identifiants) trouvé tracké. À documenter comme tel et garantir l'override prod.
- **F28** — `npm run test:int` (package.json:13) référence `jest-int.config.js` **inexistant** → script cassé.

---

## 3. Ce qui est sain (à ne pas « corriger »)

- Pattern Controller→Service→Repository respecté (sauf les 3 controllers du F7).
- Colonnes `GENERATED ALWAYS AS STORED` (`line_total`, `overhead_amount`) jamais écrites par le code (vérifié API + web).
- Triggers `check_entry_balance`, `check_period_open`, `compute_hash_chain` non contournés ; périodes closes pré-vérifiées **en plus** du trigger (défense en profondeur, `findOpenPeriodForDate`).
- 13 enums Postgres réellement typés = identiques DDL↔Prisma. PR/PO/GR/Invoice query DTO déjà migrés en `z.nativeEnum` (le bug `pending_caissier` est corrigé là où il avait frappé).
- `$transaction` dense sur les chemins comptables ; catalogue `BusinessException` (~150 sous-classes) cohérent.
- `fx-fallback.ts` (front) : usage unique, documenté indicatif, ne fuit pas vers la compta ; taux EUR↔XOF fixe BCEAO exact.
- Aucun secret réel tracké ; `.env` non tracké ; `render.yaml` en `sync:false`/`generateValue`.

---

## 4. Plan de remédiation proposé (lots)

> Ordre = risque métier décroissant. Chaque lot = 1 branche + commit unique + tests + merge main.

**Lot 1 — Exactitude comptable multidevise (CRITIQUE)**
F1 (contrôle budgétaire + limites caisse via `convertToXof`), F18 (équivalent XOF/taux sur engagement classe 8), F10 (Decimal au lieu de float sur agrégats/comparaisons). _Pré-requis : valider avec le contrôle de gestion si budgets/caisses/engagements sont toujours XOF._

**Lot 2 — Réparer la CI tests (CRITIQUE)**
F2 (migrer les 7 mocks vers `mockDeep<PrismaService>()`), F22 (mock horloge + dates fixes), F20 (réactiver auth e2e ou documenter pourquoi), F28 (créer/retirer `jest-int.config.js`). Objectif : suite verte et stable.

**Lot 3 — Sécurité & séparation des tâches (CRITIQUE)**
F3 (gardes `créateur ≠ valideur`), F9 (audit au niveau domaine, ne plus swallow), F4 + F6 (aligner RBAC front/back, gater la sidebar), F27 (documenter le placeholder Keycloak + garantir override prod).

**Lot 4 — Dette d'architecture (MAJEUR)**
F7 (`AppUserResolver` partagé + sortir Prisma des controllers), F8 (RBAC central unique), F14 (`common/dto/query.helpers.ts`), F12 (hooks sur `use-api.ts`), F15 (isoler la démo PO→Invoice).

**Lot 5 — Contrat de types & enums (MAJEUR)**
F5 (corriger ou retirer `packages/shared`), F13 (`z.nativeEnum` sur les 5 tuples), F19 (enums Postgres ou tests sentinelles), F24 (devises + bornes centralisées).

**Lot 6 — Frontend & conformité (MAJEUR/MINEUR)**
F11 (décision i18n), F16 (charte AppHeader), F23 (formatage centralisé), F25 (exceptions homogènes), F26 (consolider `gr_status`).

**Lot 7 — Dépendances (MAJEUR)**
F17 (`npm audit fix`, bump multer→2, next→14.2.latest, axios→1.7.x, remplacer xlsx, statuer sur next-auth beta).

---

## 5. Questions ouvertes à trancher avec le métier

1. Les **lignes budgétaires, caisses et engagements** sont-ils toujours libellés en XOF, ou faut-il un vrai multidevise de bout en bout ? (conditionne le Lot 1)
2. **Séparation des tâches** : tolérance pour les petites structures où une personne cumule des rôles ? `SUPER_ADMIN` doit-il bypasser ? (conditionne F3)
3. **TRESORIER** doit-il accéder à la clôture mensuelle ? (conditionne F4)
4. **i18n EN** : exigence réelle pour le jury/prod, ou français suffisant pour le pilote ? (conditionne F11)
5. `packages/shared` : on en fait la **vraie** source unique, ou on le **retire** ? (conditionne F5)

---

_Rapport généré par audit statique parallèle (6 axes). Les références `fichier:ligne` sont à confirmer ponctuellement (le code évolue). Aucun secret réel exposé dans ce document._

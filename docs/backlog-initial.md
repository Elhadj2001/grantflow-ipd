# Backlog initial sprintable — GRANTFLOW IPD

**Auteur** : El Hadj Amadou NIANG
**Date** : 02 juin 2026
**Version** : 1.0
**Cadence** : sprints de 2 semaines, démarrage le lundi
**Convention** : user stories format `En tant que ... je veux ... afin de ...` + critères d'acceptation Gherkin

---

## 1. Mode d'emploi

Ce backlog opérationnalise le plan d'action 12 mois de la note de cadrage Phase 0 en **user stories actionnables**. Chaque story porte un identifiant `US-XXX`, une estimation en story points (Fibonacci 1/2/3/5/8/13), un statut, et des critères d'acceptation testables.

**Statuts** : `backlog`, `todo`, `in_progress`, `review`, `done`, `cancelled`.

**Estimation** :
- 1 pt — < 1 heure (réglage trivial)
- 2 pts — 1-3 heures
- 3 pts — 0,5-1 jour
- 5 pts — 1-2 jours
- 8 pts — 3-5 jours
- 13 pts — > 1 semaine (à découper)

**Vélocité estimée** : 20-30 pts par sprint en mode autonome solo, 30-50 pts en mode assisté Claude Code. Un sprint = 2 semaines.

**Liens** : chaque story est rattachée à un finding d'audit (`F1`-`F28`) et/ou à une ADR (`ADR-XXX`) le cas échéant.

---

## 2. Phase 1 — Exactitude comptable multidevise + Eligibility engine

**Période** : semaines 5-14 (juillet → mi-septembre 2026)
**Sprints** : S1 à S5 (5 sprints de 2 semaines)
**Capacité totale estimée** : 150-200 story points

### Sprint S1 — DDL multidevise + service FX

**Objectif** : étendre le schéma de base de données avec les colonnes équivalent XOF + taux + date, et consolider `ExchangeRateService` comme source unique.

| ID | Story | Pts | ADR/Finding |
|---|---|---|---|
| US-001 | En tant que développeur, je veux étendre le DDL `grantflow_ddl_postgresql.sql` avec les triplets `*_amount_xof`, `*_fx_rate`, `*_fx_rate_date` sur les 12 tables financières concernées, afin de stocker l'équivalent XOF et son audit trail. | 8 | ADR-005, F1 |
| US-002 | En tant que développeur, je veux préparer une migration SQL idempotente qui applique l'extension US-001 à une base existante sans drop, afin de respecter le workflow DDL-first. | 5 | ADR-001 |
| US-003 | En tant que développeur, je veux lancer `npx prisma db pull` et `npm run prisma:generate`, afin de synchroniser le schéma Prisma. | 1 | ADR-001 |
| US-004 | En tant que développeur, je veux compléter `ExchangeRateService` avec une méthode `convertToXof(amount, currency, date?)` documentée comme source unique pour les décisions opérationnelles, afin de centraliser la conversion. | 5 | ADR-005 |
| US-005 | En tant que développeur, je veux ajouter dans `ExchangeRateService` les constantes `FX_BCEAO_EUR_XOF = 655.957` et `FALLBACK_INDICATIVE_TO_XOF = { USD: 600, GBP: 800, CHF: 700 }` documentées en JSDoc, afin d'avoir un fallback démo loud loggé. | 2 | ADR-005 |
| US-006 | En tant que développeur, je veux ajouter un log Pino structuré sur chaque appel à `convertToXof` avec `{prId, currency, rawAmount, xofAmount, fxRate, isIndicativeFallback}`, afin d'avoir un audit trail FX. | 3 | ADR-005 |
| US-007 | En tant que développeur, je veux écrire 6 tests unitaires sur `convertToXof` couvrant XOF, EUR exacte BCEAO, USD/GBP/CHF fallback, date historique, devise inconnue, afin de garantir le contrat. | 5 | ADR-005 |

**Critères d'acceptation Sprint S1** :
```gherkin
Given une migration SQL idempotente
When elle est appliquée sur une base existante au schéma actuel
Then aucune table n'est supprimée
And les colonnes *_amount_xof, *_fx_rate, *_fx_rate_date sont ajoutées
And les triggers existants (équilibre, période, audit) restent en place
And prisma db pull synchronise sans erreur
And convertToXof('100', 'EUR') retourne exactement 65595700 XOF
```

### Sprint S2 — Conversion sur contrôle budgétaire et caisses

**Objectif** : faire bénéficier les contrôles budgétaires et les limites de caisse de la conversion XOF.

| ID | Story | Pts | ADR/Finding |
|---|---|---|---|
| US-010 | En tant que développeur, je veux modifier `computeBudgetUsageByLine` dans `purchase-request.service.ts` pour convertir chaque montant en XOF avant comparaison aux plafonds budgétaires, afin de corriger le bug F1. | 5 | F1 |
| US-011 | En tant que développeur, je veux modifier `assertCashInvariants` pour convertir le `totalAmount` en XOF avant comparaison à `cashBox.perRequestMax` et `perDayUserMax`, afin de corriger la limite caisse multidevise. | 5 | F1 |
| US-012 | En tant que développeur, je veux modifier le décrément `cashBox.currentBalance` pour soustraire l'équivalent XOF et non le brut, afin d'éviter le mélange devise du solde caisse. | 3 | F1 |
| US-013 | En tant que développeur, je veux remplacer `Number(decimal)` par `Prisma.Decimal.toNumber()` ou des opérations Decimal natives sur les agrégats critiques (44 occurrences identifiées par F10), afin d'éviter la perte de précision float64. | 8 | F10 |
| US-014 | En tant que développeur, je veux ajouter 5 tests d'intégration couvrant : DA 100k EUR avec contrôle budget XOF, DA 1k USD avec limite caisse XOF, DA 10k XOF sans conversion (régression baseline), DA EUR sur budget USD croisé, DA fonds propres trace, afin de valider le sprint. | 8 | ADR-005 |

**Critères d'acceptation Sprint S2** :
```gherkin
Given une convention USAID en USD avec ligne budgétaire de 10 000 USD (~6,56M XOF)
And une DA de 5 000 EUR (~3,28M XOF)
When le contrôle budgétaire s'exécute
Then la consommation déclarée est de 3 279 785 XOF
And le reste budgétaire est de 3 280 215 XOF
And l'utilisateur voit le solde affiché en USD (devise de ligne) avec équivalent XOF en infobulle
```

### Sprint S3 — Comptabilité d'engagement classe 8 multidevise

**Objectif** : faire stocker l'équivalent XOF et le taux dans les écritures d'engagement de classe 8.

| ID | Story | Pts | ADR/Finding |
|---|---|---|---|
| US-020 | En tant que développeur, je veux étendre `createCommitmentEntry` dans `posting.service.ts` pour stocker `debit_amount_xof`, `credit_amount_xof`, `fx_rate`, `fx_rate_date` sur les écritures classe 8, afin de corriger F18. | 5 | F18 |
| US-021 | En tant que développeur, je veux étendre la vue `gl.v_general_balance` pour exposer les soldes en XOF comme source de vérité, en gardant la devise originale en information secondaire, afin d'aligner les états SYSCEBNL. | 3 | ADR-005 |
| US-022 | En tant que développeur, je veux modifier le test `posting.service.spec.ts` pour valider les nouveaux champs XOF sur classe 8, afin de couvrir le sprint. | 3 | F18 |
| US-023 | En tant que développeur, je veux documenter dans `docs/uemoa-exchange-rate.md` les règles BCEAO, le fallback indicatif, le processus de mise à jour des taux par le CG, afin que la documentation utilisateur soit complète. | 3 | — |

### Sprint S4 — Modélisation Note Technique et eligibility rules (DDL + entités)

**Objectif** : poser les fondations de l'eligibility engine en introduisant la Note Technique et les tables `expense_nature`, `eligibility_rule`, `overhead_rule`.

| ID | Story | Pts | ADR/Finding |
|---|---|---|---|
| US-030 | En tant que développeur, je veux étendre le DDL avec le schéma `grant_office`, contenant les tables `note_technique`, `note_technique_budget_line`, `overhead_rule`, `expense_nature`, `eligibility_rule`, afin de poser la base de l'eligibility engine. | 8 | ADR-006, ADR-007 |
| US-031 | En tant que développeur, je veux ajouter les contraintes UNIQUE PARTIELLES (`WHERE status = 'active'`) sur `note_technique.grant_id`, afin de garantir qu'une seule Note Technique active par grant à un instant donné. | 2 | ADR-006 |
| US-032 | En tant que développeur, je veux préparer le seed `seed/expense-natures.json` avec ~25 natures standards (consommables labo, équipement, mission, formation, etc.), afin d'avoir un catalogue initial. | 3 | ADR-007 |
| US-033 | En tant que développeur, je veux créer le module NestJS `grant_office/` avec sous-modules `note-technique/`, `eligibility/`, `overhead/`, afin de structurer le code. | 2 | ADR-003 |
| US-034 | En tant que développeur, je veux exposer les nouvelles entités via Prisma generate, afin que le client typé soit disponible. | 1 | ADR-001 |

### Sprint S5 — Eligibility engine MVP et règles

**Objectif** : implémenter le moteur d'éligibilité avec les 7 règles core dérivées du PPT IPD.

| ID | Story | Pts | ADR/Finding |
|---|---|---|---|
| US-040 | En tant que développeur, je veux créer l'interface `EligibilityRule` avec contrat `check(context) → Verdict`, afin de standardiser l'extension. | 2 | ADR-007 |
| US-041 | En tant que développeur, je veux implémenter `NatureAllowedRule` : la nature de dépense doit appartenir aux `eligibility_rule` de la Note Technique active. | 3 | ADR-007 |
| US-042 | En tant que développeur, je veux implémenter `DateWindowRule` : la date d'engagement doit être dans `[grant.start_date, grant.end_date]`. | 2 | ADR-007 |
| US-043 | En tant que développeur, je veux implémenter `LineNotExceededRule` : `amount_xof + consumed_xof ≤ budgeted_xof` de la ligne ciblée. | 3 | ADR-007 |
| US-044 | En tant que développeur, je veux implémenter `LineNatureCoherentRule` : la nature doit être cohérente avec la catégorie de la ligne (équipement vs fonctionnement). | 3 | ADR-007 |
| US-045 | En tant que développeur, je veux implémenter `NotPasteurParisReimbursedRule` : alerte si la facture porte le flag `pasteur_paris_reimbursed = TRUE`. | 2 | ADR-007 |
| US-046 | En tant que développeur, je veux implémenter `NoCrossProjectDuplicateRule` : warning si une facture identique est déjà imputée sur un autre projet. | 5 | ADR-007 |
| US-047 | En tant que développeur, je veux implémenter `PeriodNotClosedRule` : la période fiscale de la date d'engagement doit être ouverte. | 1 | ADR-007 |
| US-048 | En tant que développeur, je veux créer le service `EligibilityEngine` qui orchestre les règles, retourne un `Verdict` agrégé, et logge chaque vérification. | 5 | ADR-007 |
| US-049 | ~~En tant que développeur, je veux intégrer `EligibilityEngine.validate` dans `purchase-request.service.ts` `create`, `update`, `submit`, afin que toute DA soit validée à chaque étape.~~ **CLOSED** — livrée sur `submit()` (S5) ; dette « proxy catégorie de ligne » résolue par US-055 + US-056 (S6, cf. ADR-007 §Dette US-049). | 3 | ADR-007 |
| US-050 | En tant que développeur, je veux écrire un test d'intégration par règle (7 tests), plus 3 tests de combinaison, afin de garantir la couverture du PPT IPD slide 7. | 8 | ADR-007 |

**Critères d'acceptation Sprint S5** :
```gherkin
Given une convention USAID active
And une Note Technique active avec eligibility_rule excluant 'PERSONNEL_NATIONAL'
When un demandeur soumet une DA de 1000 USD pour 'PERSONNEL_NATIONAL'
Then la soumission est rejetée avec verdict { blocked: true, code: 'ELIG_NATURE_NOT_ALLOWED' }
And aucune DA n'est persistée
And le log Pino contient { ruleCode, verdict, prDraftPayload }
```

### Sprint S7 (cadence réelle 2026-07) — Effectivité Eligibility Engine côté utilisateurs + dettes courtes

> **Numérotation** : US-057 (audit PPT) et US-058 (référencée close-s6) ont été
> consommées par le S6 réel hors backlog ; le S7 réel démarre donc à **US-064**
> (US-064/065 résolvent la dette « US-058 » de `docs/sprints/close-s6.md`).
> Ne pas confondre avec le « Sprint S7 — Audit log domain + pentest » du
> planning thématique initial (§4), non encore exécuté.

| ID | Story | Pts | ADR/Finding |
|---|---|---|---|
| US-064 | En tant que demandeur, je veux saisir dans le formulaire DA la nature de dépense (select alimenté par `GET /expense-natures`, libellé + catégorie, recherche), le flag « Dépense refacturée à Pasteur Paris » et le n° de facture fournisseur (optionnel), afin que l'EligibilityEngine statue sur des données réelles (chaîne form → DTO Zod structure-only → service → colonnes US-054 → `runEligibilityGate`) et que le détail DA les affiche. | 5 | ADR-007, close-s6 §dettes |
| US-065 | En tant que Grant Office, je veux un rôle GO (realm Keycloak dev + note prod, ROLE_PRIORITY, `@Roles` note-technique/eligibility/overhead, sidebar gantée, user seed `go.demo@…`) qui crée/édite les Notes Techniques en draft/pending_daf sans pouvoir les valider (SoD DAF intacte), afin d'incarner le circuit ADR-006. | 5 | ADR-006, ADR-009 |
| US-066 | En tant qu'utilisateur du dashboard, je veux un endpoint agrégé `GET /api/v1/dashboard/summary` (DA par statut via groupBy, factures à matcher, conventions actives, paiements du mois) consommé en UNE requête par le front (staleTime 30 s), afin de supprimer le fan-out actuel (jusqu'à 13 requêtes). | 3 | audit refonte UI |
| US-067 | En tant que CG, je veux le backfill prod de `budget_line.category` (dry-run rapporté, APPLY sur GO explicite) et un seed idempotent `ref.exchange_rate` USD→XOF daté (procédure `uemoa-exchange-rate.md`), afin d'éteindre les WARN `us049_proxy_fallback_used` et `fx_indicative_fallback_used`. | 2 | US-055/056, ADR-005 |
| US-068 | En tant qu'utilisateur, je veux des sous-titres Poppins Light systématiques et l'équivalent XOF en infobulle sur tout montant affiché en devise ≠ XOF (source `*_amount_xof`, format français, aucun recalcul front), afin de finaliser la charte 2025. | 2 | charte 2025, ADR-005 |
| US-069 | En tant qu'utilisateur, je veux un aperçu PDF fiable (flux blob authentifié, 404 `DOCUMENT_NOT_FOUND` / 503 `DOCUMENT_STORE_UNAVAILABLE` propres, état vide charte) et un panneau Documents généralisé (facture, BC, GR, DA — listing dérivé des `pdfObjectKey` existants, visionneuse plein écran, téléchargement), afin de ne plus jamais voir d'aperçu cassé. **Dette notée** : PDF archivé de DA et de bon de livraison (GR) à générer plus tard si souhaité. **Contexte prod** : US-143 (S3_*) FERMÉE le 2026-07-17 (restauration vérifiée, cf. `docs/deploy/prod-restoration-2026-07-13.md` §5) — le 503 reste un garde pour les futures recréations de service ; le 404 « Aucun document archivé » est le comportement attendu et définitif pour les factures/BC capturés pendant la fenêtre sans stockage (dont FAC-SIM-BC-2026-0002-1). | 5 | retour user, pattern projet frère |

**Critères d'acceptation Sprint S7** :
```gherkin
# US-064 — gate d'éligibilité effective depuis l'UI
Given le catalogue expense-natures seedé (US-032) et une NT active excluant la nature 'EQUIPEMENT'
When un demandeur crée une DA en sélectionnant 'EQUIPEMENT' dans le formulaire et la soumet
Then l'API rejette la soumission avec le code PPT 'ELIG_NATURE_NOT_ALLOWED'
And le formulaire affiche un message d'erreur lisible dédié (pas un toast générique)
And le détail DA affiche nature, flag Pasteur Paris et n° facture fournisseur

# US-065 — SoD du circuit Note Technique
Given un utilisateur porteur du rôle GO
When il crée une Note Technique (draft) puis la passe en pending_daf
Then les deux opérations réussissent
But quand il tente validateAsDaf Then 403 (rôle DAF requis)
And un PI qui tente de créer une NT reçoit 403

# US-066 — dashboard en une requête
Given un utilisateur authentifié sur le dashboard
When la page se charge
Then une seule requête GET /api/v1/dashboard/summary alimente les compteurs
And les 5 requêtes DA mono-statut du fan-out n'existent plus

# US-067 — données prod assainies
Given le dry-run du backfill rapporté ligne à ligne et le GO explicite de l'user
When le backfill et le seed exchange_rate sont appliqués sur Neon
Then plus aucun WARN us049_proxy_fallback_used ni fx_indicative_fallback_used au parcours DA

# US-068 — équivalent XOF
Given une DA en USD
When son montant s'affiche (détail, liste, dashboard)
Then une infobulle montre l'équivalent XOF depuis *_amount_xof au format français
```

### Sprint S8 (cadence réelle 2026-07) — Résorption audit v2 : lots L1 → L5 → L2 → L3 (~27,5 pts)

> **Source** : `docs/audit-codebase-2026-07-17.md` (findings F-S8-01…24).
> **Numérotation** : blocs 070-074 et 080-090 déjà pris → US-075→079 puis
> US-091→094. **L4 (dette montants ADR-005 : convertisseur Decimal, triplets
> XOF, backfills) reporté en Sprint S9 dédié** — trop structurant pour
> cohabiter avec les fixes. Le fix U+202F des générateurs reporting
> (F-S8-15/16), indépendant de L4, est rattaché à L1 (pattern `f9053b0`).

| ID | Lot | Story | Pts | Findings |
|---|---|---|---|---|
| US-075 | L1 | En tant qu'utilisateur, je veux que les 4 actions cassées soient réparées : (a) aperçu PDF (retrait du `sandbox` de l'iframe — Chromium n'y instancie pas son viewer), (b) « Confirmer réception fournisseur » (dialog avec saisie `ackRef` alignée sur le DTO), (c) édition d'une ligne GR (enveloppe `{lines:[…]}`), (d) montants des PDF rapports bailleurs/états SYSCEBNL + emails BC via `formatMoneyFr` (U+202F→U+00A0). | 4 | F-S8-01, 21, 22, 15, 16 |
| US-076 | L5 | En tant qu'utilisateur, je veux des entrées sidebar « Bons de commande » et « Réceptions » (groupe Opérations, gating `canListPurchaseOrders`/`canListGoodsReceipts`) et « Analytique » (groupe Pilotage, gating `canViewAnalytics`), afin qu'aucune page de liste ne soit orpheline. | 2 | F-S8-05, 24 |
| US-077 | L2 | En tant que comptable, je veux un OCR pdfparse fiable : TVA jamais confondue avec le taux (regex excluant les `%`, préférence « Total TVA »/bloc totaux), contrôle de cohérence HT+TVA≈TTC (tolérance ; sinon confidence dégradée + capture « à vérifier »), ligne de repli « Import global » imputable quand aucune ligne n'est extraite, devise cherchée près des totaux. | 5 | F-S8-04 |
| US-078 | L2 | En tant que comptable, je veux que le matching refuse une facture sans lignes ou à totaux nuls (exception `MATCHING_EMPTY_INVOICE` 409 + gardes des préconditions documentées), afin qu'aucune facture ne soit « Rapprochée » par vacuité. | 3 | F-S8-02, 06 |
| US-079 | L2 | En tant que comptable, je veux un refus de comptabilisation explicite (`INVOICE_NO_LINES_NOT_POSTABLE` 409 au lieu du 404) et un bouton « Comptabiliser » désactivé avec message quand la facture n'a pas de lignes, afin de comprendre le blocage sans erreur trompeuse. | 2 | F-S8-03 |
| US-091 | L3 | En tant que DAF, je veux les lectures sensibles gardées : détail/paiements/écritures des payment-runs (mêmes @Roles que la liste), téléchargements PDF/Excel des états financiers (@Roles + acteur au service, règles `isBailleurOnly`/`locked`), comptes bancaires (lectures TRESORIER/COMPTABLE/DAF/SA), templates reporting alignés. | 4,5 | F-S8-17, 18, 19, 20 |
| US-092 | L3 | En tant que comptable, je veux qu'une facture `posted`/`partially_paid` soit non-rejetable (chemin légitime : `cancelPosting` d'abord), afin de ne jamais laisser d'écritures orphelines. | 2 | F-S8-07 |
| US-093 | L3 | En tant que magasinier, je veux que `GoodsReceipt.complete` vérifie l'état courant du BC (∈ sent/acknowledged/partially_received), afin qu'un GR draft ancien ne rouvre jamais un BC annulé ou facturé. | 2 | F-S8-08 |
| US-094 | L3 | En tant que trésorier, je veux l'approbation d'un payment run résiliente : marquage par paiement (écriture BQ ↔ statut payment cohérents même en cas d'échec en série) et re-validation du statut des factures entre prepare et approve. | 3 | F-S8-09 |

**Critères d'acceptation Sprint S8** :
```gherkin
# US-075 — actions réparées
Given un BC envoyé avec PDF archivé
When j'ouvre son panneau Documents Then l'aperçu s'affiche (iframe sans sandbox)
When je confirme la réception fournisseur avec la référence 'ACK-2026-01' Then le BC passe acknowledged (200)
Given un GR draft When je sauve une ligne depuis la fiche Then 200 (corps {lines:[…]})
Given un état financier PDF Then aucun U+202F dans les montants rendus

# US-077/078 — import fiable
Given un PDF facture affichant « TVA (18%) : 2 952,00 »
When l'OCR capture Then totalVat = 2952 (jamais 18)
Given une capture où HT+TVA ≠ TTC (tolérance dépassée) Then confidence dégradée et capture signalée « à vérifier »
Given une facture sans lignes When submitForMatching Then 409 MATCHING_EMPTY_INVOICE (jamais « Rapprochée »)

# US-079 — refus explicite
Given une facture matched sans lignes (donnée legacy)
Then le bouton Comptabiliser est désactivé avec message ; l'API renvoie 409 INVOICE_NO_LINES_NOT_POSTABLE

# US-091 — fuites fermées
Given un utilisateur BAILLEUR Then GET payment-runs/:id → 403 et GET statements/:id/pdf sur un brouillon → 403

# US-092/093/094 — intégrité
Given une facture posted When reject Then 409 (cancelPosting requis d'abord)
Given un BC cancelled When complete d'un GR draft ancien Then 409 (BC non réceptionnable)
Given un postPayment qui échoue en milieu de série When approve Then aucun paiement 'prepared' avec écriture BQ postée
```

---

## 3. Phase 2 — Santé de la suite de tests (en parallèle Phase 1)

**Période** : semaines 7-10 (mi-juillet → mi-août 2026)
**Sprints** : S2bis et S3bis (parallèles à S2 et S3)
**Capacité totale estimée** : 60-80 story points

### Sprint S2bis — Mocks Prisma et mock horloge

| ID | Story | Pts | ADR/Finding |
|---|---|---|---|
| US-060 | En tant que développeur, je veux installer `jest-mock-extended` et créer un helper `createPrismaMock()` retournant `mockDeep<PrismaService>()`, afin d'auto-stuber toute méthode Prisma. | 3 | F2 |
| US-061 | En tant que développeur, je veux migrer les 7 specs identifiées dans F2 (`purchase-request.service.spec.ts`, `dedicated-funds.service.spec.ts`, `posting-payment.service.spec.ts`, `posting.service.spec.ts`, `goods-receipt.service.spec.ts`, `payment-run.service.spec.ts`, `purchase-order.service.spec.ts`) vers `createPrismaMock()`, afin de débloquer la CI. | 8 | F2 |
| US-062 | En tant que développeur, je veux mettre en place `jest.useFakeTimers()` + `jest.setSystemTime(new Date('2026-06-15'))` dans les 10 specs identifiées (F22), afin de stabiliser les tests temporels. | 5 | F22 |
| US-063 | En tant que développeur, je veux ajouter un test sentinelle qui fail si `new Date()` est utilisé directement dans un service producteur de numéro de séquence, afin de prévenir la régression. | 2 | F22 |

### Sprint S3bis — Couverture, e2e Playwright et CI

| ID | Story | Pts | ADR/Finding |
|---|---|---|---|
| US-070 | En tant que développeur, je veux activer la mesure de couverture Istanbul/jest sur API et Web avec rapport HTML + rapport CI, afin de mesurer l'état actuel. | 3 | — |
| US-071 | En tant que développeur, je veux ajouter dans la CI un gate `coverage_threshold` : 70 % API, 50 % Web, afin de bloquer les régressions. | 2 | — |
| US-072 | En tant que développeur, je veux écrire 5 parcours e2e Playwright : login multi-rôle, création DA standard, circuit approbation PI→CG→DAF, création BC + envoi mail, réception facture + posting, afin de couvrir les flows critiques. | 13 | — |
| US-073 | En tant que développeur, je veux créer ou retirer `jest-int.config.js` (script `test:int` cassé selon F28), afin que la commande npm soit propre. | 1 | F28 |
| US-074 | En tant que développeur, je veux réactiver `auth.e2e-spec.ts` (actuellement `describe.skip`) ou documenter la raison du skip dans un commentaire et une ADR, afin de ne pas dissimuler un trou de sécurité. | 5 | F20 |

---

## 4. Phase 3 — Sécurité, gouvernance et séparation des tâches

**Période** : semaines 15-18 (10 septembre → 7 octobre 2026)
**Sprints** : S6, S7 (2 sprints)
**Capacité totale estimée** : 80-100 story points

### Sprint S6 — RBAC central + SegregationOfDuties

| ID | Story | Pts | ADR/Finding |
|---|---|---|---|
| US-080 | En tant que développeur, je veux créer le module `rbac/` central avec une matrice de permissions JSON-config (`config/permissions.json`), afin d'avoir une source unique. | 5 | F8 |
| US-081 | En tant que développeur, je veux exposer un endpoint `/me/permissions` qui retourne la liste des permissions de l'utilisateur connecté, afin que le frontend en dépende. | 3 | F4 |
| US-082 | En tant que développeur, je veux modifier `use-permissions.ts` côté frontend pour appeler `/me/permissions` au lieu de redéclarer la matrice, afin d'éliminer le drift front/back. | 5 | F4, F8 |
| US-083 | En tant que développeur, je veux ajouter les items sidebar manquants au gating `visible` (Achats, Comptabilité/Invoices, Trésorerie), afin de corriger F6. | 2 | F6 |
| US-084 | En tant que développeur, je veux créer `canListPurchaseRequests()`, `canListInvoices()`, `canListPaymentRuns()` côté frontend dérivés de `/me/permissions`, afin de compléter F6. | 3 | F6 |
| US-085 | En tant que développeur, je veux créer la classe `SegregationOfDutiesException` dans le catalogue d'exceptions métier, afin d'avoir un code d'erreur dédié. | 1 | ADR-009, F3 |
| US-086 | En tant que développeur, je veux créer le décorateur `@RequireDifferentActor(creatorField)` et le guard `SegregationOfDutiesGuard` NestJS, afin d'enforcer la SoD par identité. | 5 | ADR-009 |
| US-087 | En tant que développeur, je veux appliquer le décorateur sur les 6 endpoints d'approbation identifiés (DA, BC, GR, facture, payment run, écriture), afin de couvrir le périmètre. | 3 | ADR-009 |
| US-088 | En tant que développeur, je veux implémenter le mécanisme de break-glass `X-Bypass-SoD-Reason` avec validation `reason.length >= 20` et log audit explicite, afin de permettre l'exception documentée. | 5 | ADR-009 |
| US-089 | En tant que développeur, je veux ajouter le champ `single_actor_authorized` + `single_actor_justification` au DDL `grant_office.note_technique`, afin de supporter le mode dérogation conventionnel. | 3 | ADR-009 |
| US-090 | En tant que développeur, je veux écrire 4 tests par endpoint protégé (cas nominal, créateur cherche à approuver, convention autorisée, break-glass), afin de couvrir SoD. | 8 | ADR-009 |

### Sprint S7 — Audit log domain + pentest

| ID | Story | Pts | ADR/Finding |
|---|---|---|---|
| US-100 | En tant que développeur, je veux créer un `AuditEventBus` (EventEmitter NestJS ou pattern direct) qui permet aux services métier de publier des événements, afin de migrer l'audit-trail au niveau domaine. | 5 | F9 |
| US-101 | En tant que développeur, je veux modifier le `AuditLogService` pour consommer du bus et écrire dans `audit.event_log` en transaction métier (donc rollback si l'audit échoue), afin de garantir la cohérence. | 5 | F9 |
| US-102 | En tant que développeur, je veux migrer 6-8 services métier critiques (purchase-request, posting, payment-run, period-close, eligibility, RBAC) pour émettre leurs événements via le bus, afin de remplacer la dérivation depuis l'URL. | 8 | F9 |
| US-103 | En tant que développeur, je veux créer le tableau de bord DAF « Bypass SoD du mois » avec liste des bypass + KPI count, afin de tracer la dérogation. | 5 | ADR-009 |
| US-104 | En tant que développeur, je veux lancer un pentest OWASP ZAP automatisé sur l'instance Render, afin d'identifier les failles OWASP Top 10. | 5 | — |
| US-105 | En tant que développeur, je veux corriger les failles bloquantes du pentest et documenter les non-bloquantes dans `docs/security/pentest-report-YYYYMMDD.md`, afin d'avoir une trace. | 5-13 | — |
| US-106 | En tant que développeur, je veux documenter dans une ADR le placeholder Keycloak `grantflow-api-dev-secret-2026` et garantir l'override prod via env Render, afin de répondre à F27. | 2 | F27 |

---

## 5. Phase 4 — Refactoring architectural

**Période** : semaines 19-24 (8 octobre → 18 novembre 2026)
**Sprints** : S8, S9, S10 (3 sprints)
**Capacité totale estimée** : 110-140 story points

### Sprint S8 — AppUserResolver + sortie Prisma des controllers

| ID | Story | Pts | ADR/Finding |
|---|---|---|---|
| US-110 | En tant que développeur, je veux créer un service `AppUserResolver` injectable qui expose `resolveAppUserId(actor)` à partir de la `JwtStrategy` (ou via lookup `email → app_user`), afin de centraliser la résolution. | 5 | F7 |
| US-111 | En tant que développeur, je veux remplacer les 10 duplications `resolveAppUserId` dans les services par l'injection du resolver, afin d'éliminer la duplication. | 5 | F7 |
| US-112 | En tant que développeur, je veux extraire la logique Prisma des 3 controllers identifiés (payment-run, reporting, accounting) vers leurs services respectifs, afin de respecter Controller→Service→Repository. | 5 | F7 |
| US-113 | En tant que développeur, je veux unifier les 4 définitions divergentes de `FULL_VIEW_ROLES` dans le module RBAC central créé en sprint S6, afin d'avoir une sémantique cohérente. | 3 | F8 |

### Sprint S9 — Hooks sur use-api + helpers Zod factorisés

| ID | Story | Pts | ADR/Finding |
|---|---|---|---|
| US-120 | En tant que développeur, je veux migrer les hooks métier frontend (`use-procurement.ts`, `use-accounting.ts`, etc.) pour utiliser `useApiQuery`/`useApiMutation` de `lib/use-api.ts`, afin d'éliminer la duplication. | 8 | F12 |
| US-121 | En tant que développeur, je veux créer `common/dto/query.helpers.ts` exportant `coerceInt`, `coerceBool`, `ISO_DATE`, et un builder `paginationSchema({sortFields, maxPageSize})`, afin de factoriser les 35 copies. | 5 | F14 |
| US-122 | En tant que développeur, je veux migrer les ~35 fichiers DTO vers ces helpers, afin d'éliminer la duplication. | 8 | F14 |
| US-123 | En tant que développeur, je veux isoler la feature de démo `F-INVOICE-SIM` dans un module dédié `procurement/demo/` séparé de `purchase-order.service`, afin de retirer le couplage cross-context. | 3 | F15 |

### Sprint S10 — Codegen shared + enums + ADRs rétrospectives

| ID | Story | Pts | ADR/Finding |
|---|---|---|---|
| US-130 | En tant que développeur, je veux créer un script `apps/api/scripts/codegen-shared-enums.ts` qui lit `schema.prisma` et génère `packages/shared/src/enums.generated.ts`, afin que les enums soient synchronisés. | 5 | F5 |
| US-131 | En tant que développeur, je veux ajouter un gate CI qui exécute le script et compare au tracked output, afin de fail si dérive. | 2 | F5 |
| US-132 | En tant que développeur, je veux migrer les 5 enums Zod tuples (`DONOR_TYPES`, `GRANT_STATUSES`, `PR_REQUEST_TYPES`, `PaymentMethodEnum`) vers `z.nativeEnum(PrismaEnum)`, afin de prévenir les drifts. | 5 | F13 |
| US-133 | En tant que développeur, je veux centraliser les 3 listes dupliquées de devises (`SUPPORTED_CURRENCIES`, `SUPPLIER_CURRENCIES`, `Currency`) dans `packages/shared/currency.ts`, afin d'unifier. | 2 | F24 |
| US-134 | En tant que développeur, je veux harmoniser les bornes `pageSize` à 100 par défaut (sauf justification documentée), afin de retirer F24. | 2 | F24 |
| US-135 | En tant que rédacteur, je veux formaliser rétrospectivement 8-10 ADRs supplémentaires correspondant aux décisions implicites prises depuis le début, afin de compléter le catalogue ADR (ADR-002, 004, 008, 010, 012, 013, 014, 015). | 13 | — |
| US-139 | En tant que comptable, je veux que `v_general_balance` n'agrège QUE les écritures `posted`, afin que la balance ignore les brouillons. Le `LEFT JOIN … AND je.status='posted'` actuel laisse remonter les lignes `draft` (filtre inopérant en LEFT JOIN). Refactorer en `WHERE EXISTS` ou sous-requête. (S3bis ou S4) | 2 | US-021 |
| US-140 | En tant qu'auditeur, je veux enforcer les invariants multidevise I1-I5 au niveau DB. Compléter `postInvoice` (lignes main/TVA/fournisseur/extournes) avec `fx_rate`/`fx_rate_date` ; backfiller les 4 lignes USD seed au `fx_rate` NULL ; ajouter le `CHECK chk_fx_consistency` (I1/I3/I4) à `gl.journal_line` ; enforcer I5 cross-row via constraint trigger. (S3bis ou S4) | 5 | F18, US-022 |

---

## 6. Phase 5A — Modules métier IPD-critiques (synthèse sprintée)

**Période** : semaines 25-38 (19 novembre 2026 → 24 février 2027)
**Sprints** : S11 à S17 (7 sprints)
**Capacité totale estimée** : 250-300 story points

### Sprint S11 — Workflow Note Technique (GO → DAF → activation)

Stories principales : création UI Note Technique pour le GO, workflow état (draft → pending_daf → validated_daf → active → superseded), validation DAF avec signature, activation automatique des lignes budgétaires, gestion superseded, tests d'intégration workflow.

### Sprint S12 — Module Rôle GO et matrice de visibilité

Stories : création rôle Keycloak `GO`, ajout aux permissions JSON, scope « projets dont je suis GO assigné », attribution GO par convention, tests RBAC GO.

### Sprint S13 — Maquettes bailleur configurables

Stories : entité `ReportTemplate`, UI upload de maquette par bailleur, mapping ligne template → expense nature, validation cohérence, seeds initiaux pour USAID FFR / Wellcome / EU H2020.

### Sprint S14 — Génération de rapports multi-format

Stories : génération PDF via puppeteer ou pdf-lib, génération Excel via exceljs (remplaçant xlsx, finding F17), signature électronique simple via insertion d'image + métadonnées PDF, génération du cover note PDF, tests E2E sur 3 maquettes.

### Sprint S15 — Versioning rapport + colonne ajustement

Stories : entité `ReportVersion`, workflow draft → signed_daf → signed_director → transmitted → superseded, trigger DDL immutabilité, calcul de la colonne d'ajustement v2 vs v1, tests d'invariance.

### Sprint S16 — Module Audit conventionnel

Stories : entités `AuditClause` + `AuditMission`, UI gestion auditeurs externes, génération mission letter PDF, upload rapport d'audit signé, signature DAF + Directeur, attachement au compte rendu final, tests workflow.

### Sprint S17 — Refacturation inter-pôles + Fonds propres + Justificatifs typés + États SYSCEBNL

Stories (sprint chargé, possiblement à découper en S17a/S17b) :
- Refacturation inter-pôles : entité `InterCenterTransfer`, écritures miroirs, vue consolidée.
- Contribution sur fonds propres : entité `FundContribution`, marquage `funded_by_own_funds`, reporting dédié.
- Justificatifs typés par nature : configuration par `ExpenseNature`, alerte au compte rendu.
- États SYSCEBNL : TER, état des fonds dédiés, bilan formaté SYSCEBNL.

---

## 7. Phase 5B — Modules complémentaires (synthèse)

**Période** : semaines 39-42 (mars 2027)
**Sprints** : S18, S19

Stories synthétiques :
- OCR Vision en prod : promotion factory provider, fine-tuning prompts, mesures précision/coût.
- Mobile-responsive : audit des pages avec UI mobile, ajustements Tailwind, tests Playwright mobile.
- Notifications : module mail (Nodemailer + Mailtrap dev / SMTP IPD prod), triggers sur transitions critiques.
- Dashboard PI : vue dédiée Principal Investigator avec consommation budget, prévisionnel cash, alertes.
- Rapprochement bancaire : import CSV/MT940, matching, GUI reconciliation.

---

## 8. Phase 6 — Étude comparative ERP (synthèse)

**Période** : semaines 43-46 (mars-avril 2027)
**Sprints** : S20, S21

Activités principales (rédaction-dominante, pas d'implémentation lourde) :
- Documentation comparative SAP PSM, Oracle Grants, Sage Intacct, Serenic Navigator, FundEZ, EBP, Sage X3 — recherche documentaire, demos publiques, fiches techniques.
- Construction du tableau 80-100 critères.
- Positionnement GRANTFLOW.
- Argumentaire d'adoption IPD (TCO, time-to-deploy, customization).
- Chapitre mémoire associé (50-60 pages).

---

## 9. Phase 7 — Artefacts de persuasion adoption IPD (synthèse)

**Période** : semaines 47-50 (avril-mai 2027)
**Sprints** : S22, S23

Livrables :
- Executive Summary IPD (2 pages).
- Business case ROI (calculs Excel + narratif).
- Plan de change management.
- Simulation réponse RFP.
- Documentation utilisateur PDF (40-60 pages).
- Vidéos formation (6-8 capsules de 5-10 min).
- Manuel d'installation IPD.
- Présentation comité de direction IPD (30 slides).

---

## 10. Phase 8 — Finalisation mémoire et soutenance (synthèse)

**Période** : semaines 51-52 (fin mai 2027)
**Sprint** : S24

Activités :
- Révision globale du mémoire.
- Schémas finaux + diagrammes UML consolidés.
- Annexes consolidées (audit, ADRs, captures, KPIs, comparatif).
- Bibliographie finalisée.
- Slides de soutenance.
- Vidéo de démo backup (8-12 min).
- 3 répétitions devant public.

---

## 11. Récapitulatif des story points par phase

| Phase | Sprints | Story points |
|---|---|---|
| Phase 1 — Multidevise + Eligibility | S1-S5 | 150-200 |
| Phase 2 — Santé tests | S2bis-S3bis | 60-80 |
| Phase 3 — Sécurité + gouvernance | S6-S7 | 80-100 |
| Phase 4 — Refactoring archi | S8-S10 | 110-140 |
| Phase 5A — Modules métier IPD | S11-S17 | 250-300 |
| Phase 5B — Modules complémentaires | S18-S19 | 80-100 |
| Phase 6 — Étude comparative | S20-S21 | 40-60 (rédaction-dominante) |
| Phase 7 — Persuasion | S22-S23 | 60-80 |
| Phase 8 — Finalisation mémoire | S24 | 40-60 |
| **Total** | **24 sprints** | **870-1120 pts** |

Sur 12 mois à raison de 24 sprints, la vélocité moyenne ciblée est de **36-47 pts/sprint**, cohérente avec une vélocité solo assistée Claude Code.

---

## 12. Conventions opérationnelles

### Lien GitHub Issues / GitHub Projects

Chaque user story `US-XXX` est créée comme **issue GitHub** taggée `phase-N`, `sprint-SX`, `priority-{high|medium|low}`, avec liens vers ADRs et findings d'audit. Un GitHub Project Kanban suit le statut.

### Definition of Ready (DoR)

Une story est `ready` quand : (1) le besoin est exprimé en `En tant que / je veux / afin de`, (2) les critères d'acceptation Gherkin sont rédigés, (3) les dépendances techniques sont identifiées, (4) l'estimation en points est posée, (5) les ADRs et findings impactés sont listés.

### Definition of Done (DoD)

Une story est `done` quand : (1) le code est mergé sur `main` après revue, (2) les tests unitaires/intégration passent, (3) la couverture ne régresse pas, (4) la documentation est mise à jour si nécessaire (ADR, README de module, CLAUDE.md), (5) un snapshot écran ou un test E2E illustre le fonctionnement quand pertinent, (6) le mémoire est mis à jour si la story modifie un chapitre.

### Rituel sprint

- **Lundi semaine 1** : sprint planning. Sélection des stories par priorité, total ≤ vélocité cible. Mise à jour de TASKS.md.
- **Vendredi semaine 2 — matin** : démo personnelle (s'enregistrer en vidéo si rien à montrer à un humain).
- **Vendredi semaine 2 — après-midi** : rétro courte (3 choses : ce qui a marché, ce qui a frotté, ce que je change).
- **Lundi suivant** : planning sprint N+1.

### Convention de commits

`<type>(<scope>): <message court>` avec :
- `feat(procurement)`: nouvelle feature côté procurement.
- `fix(api)`: correctif technique.
- `chore(deps)`: maintenance dépendances.
- `docs(adr)`: ajout/modification ADR.
- `test(eligibility)`: ajout test sur eligibility.
- `refactor(rbac)`: refactor sans changement comportement.
- `perf(reporting)`: amélioration performance reporting.

### Branches

- `main` : protégée, déploiement auto cloud.
- `feature/sprint-SX-US-XXX-slug` : branche par story.
- `fix/finding-FNN-slug` : branche par finding d'audit.
- `chore/depbump-X` : maintenance dépendances.

### Format PR

- Titre : `[US-XXX] <action concrète et résultat>`.
- Corps structuré : **Contexte / Changement / Tests / Captures / ADR ou Finding impacté**.
- Cibles : `main`, revue obligatoire (auto-revue documentée si solo).
- Merge : `squash` pour les features, `merge commit` pour les sprints.

---

*Backlog initial sprintable — Version 1.0 — 02 juin 2026*
*Auteur : El Hadj Amadou NIANG — GRANTFLOW IPD*

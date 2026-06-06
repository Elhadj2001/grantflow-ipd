# Prompt Pack — Sprint S2 (Conversion XOF sur contrôle budgétaire et limites caisse)

**Sprint** : S2 (semaines 7-8, juillet 2026)
**Objectif** : faire bénéficier les contrôles budgétaires, les limites de caisse et les agrégats comptables de la conversion XOF + précision Decimal. Résoudre le finding F1 de l'audit (cause racine du bug multidevise) et entamer F10.
**Stories couvertes** : US-010 à US-014 (29 story points)
**ADRs concernées** : ADR-005 (Multidevise tripartite), ADR-007 (indirect via budget rules)
**Audit findings adressés** : F1 (résolution complète), F10 (partiel — Phase 1 globale)
**Prérequis** : Sprint S1 mergé (DDL multidevise + `ExchangeRateService.convertToXof` opérationnel).

---

## Mode d'emploi

Même que Sprint S1 — tu colles un prompt à la fois dans Claude Code, dans l'ordre, et tu valides chaque rapport avant d'enchaîner.

**Si Sprint S1 n'est pas terminé**, ne commence pas S2 : les stories S2 dépendent de `convertToXof` (US-004) et des colonnes XOF DDL (US-001).

---

## Prompt 1 — US-010 : Contrôle budgétaire en XOF

```
TÂCHE — Sprint S2 / US-010 / fix F1 contrôle budgétaire multidevise

CONTEXTE
Audit GRANTFLOW du 02 juin 2026 — finding F1 (cf. docs/audit-codebase-2026-06-02.md) :
le contrôle budgétaire dans purchase-request.service.ts compare actuellement
des montants bruts (Number(l.lineTotal)) à des plafonds budgétaires en XOF,
sans conversion préalable. Conséquence : une DA en EUR (ex 100 000 EUR ≈
65,6M XOF) est traitée comme « 100 000 » contre une ligne budgétaire de
500 000 XOF, ce qui fausse complètement le contrôle d'engagement.

Le Sprint S1 a livré ExchangeRateService.convertToXof(amount, currency, date?)
comme source unique de conversion. Il faut maintenant l'utiliser dans le
contrôle budgétaire.

Règle d'or CLAUDE.md §2 et ADR-005 : tout contrôle métier opère en XOF.

CORRECTION DEMANDÉE
Dans apps/api/src/procurement/services/purchase-request.service.ts :

1. Identifier les méthodes concernées :
   - computeBudgetUsageByLine (autour ligne 606-621 selon l'audit) — agrégat
     PR + PO sur la ligne ciblée.
   - checkBudget (autour 441-443) — comparaison agrégat vs budget.
   - submit (autour 483-490) — appel au contrôle pré-soumission.

2. Injecter `ExchangeRateService` dans le constructeur du
   PurchaseRequestService si pas déjà fait.

3. Modifier computeBudgetUsageByLine pour convertir chaque montant en XOF
   avant agrégation :
       const lineXof = await this.fx.convertToXof(
         new Prisma.Decimal(l.lineTotal),
         pr.currency,
         pr.engagementDate ?? pr.createdAt,
       );
       totalConsumedXof += lineXof.xofAmount;
   (idem pour les agrégats PR open et PO open)

4. Modifier checkBudget pour comparer en XOF :
       const requestedXof = await this.fx.convertToXof(
         new Prisma.Decimal(amount), currency, date,
       );
       if (consumedXof + requestedXof.xofAmount > budgetLine.budgetedAmountXof) {
         throw new BudgetExceededException(...);
       }

5. La BudgetLine doit être lue avec son budgetedAmountXof (déjà disponible
   depuis Sprint S1 DDL). Si la BudgetLine est en devise étrangère, c'est son
   budgetedAmountXof qui sert de référence.

6. L'exception BudgetExceededException doit mentionner les montants XOF
   ET les montants devise originale dans le message d'erreur, pour que
   l'utilisateur comprenne le calcul.

CONTRAINTES
- Aucune écriture sur les colonnes GENERATED (line_total, overhead_amount).
- Conversion via convertToXof, pas de calcul direct.
- Tests d'intégration : à venir en US-014.
- Commit unique sur branche `feature/sprint-s2-us-010-budget-control-xof`.

LIVRABLE
- purchase-request.service.ts modifié.
- Rapport : méthodes modifiées, exception enrichie, vérification que tous les
  agrégats sont en XOF de bout en bout, SHA poussé.

RAPPORT en moins de 300 mots.
```

**Critère d'acceptation US-010** : `checkBudget` et `computeBudgetUsageByLine` opèrent en XOF, BudgetExceededException porte les deux unités (devise originale + XOF), aucun `Number()` direct sur Decimal.

---

## Prompt 2 — US-011 : Limites caisse en XOF

```
TÂCHE — Sprint S2 / US-011 / fix F1 limites caisse multidevise

CONTEXTE
Même finding F1 que US-010, mais sur les limites de caisse (perRequestMax,
perDayUserMax). Aujourd'hui assertCashInvariants compare des montants bruts
à des plafonds XOF, ce qui fausse les limites pour les DA cash en devise
étrangère (cas rare mais qui peut arriver pour une avance espèces lors d'une
mission à l'étranger).

CORRECTION DEMANDÉE
Dans apps/api/src/procurement/services/purchase-request.service.ts :

1. Identifier assertCashInvariants (autour 264-300 selon l'audit).

2. Injecter `ExchangeRateService` si pas déjà fait (US-010 l'aura fait).

3. Pour chaque comparaison à un plafond XOF, convertir d'abord :
       const totalXof = await this.fx.convertToXof(
         new Prisma.Decimal(pr.totalAmount),
         pr.currency,
         pr.createdAt,
       );
       if (totalXof.xofAmount > cashBox.perRequestMax) {
         throw new CashPerRequestLimitExceededException(...);
       }

4. Pour perDayUserMax, agréger les DA du jour de l'utilisateur en XOF :
       const dailyTotalXof = await this.computeUserDailyCashXof(actor, today);
       if (dailyTotalXof + totalXof.xofAmount > cashBox.perDayUserMax) {
         throw new CashPerDayUserLimitExceededException(...);
       }

5. Les exceptions doivent porter les montants devise + XOF dans leur message.

CONTRAINTES
- Mêmes que US-010.
- Préserver le comportement actuel pour les caisses XOF (régression baseline).
- Commit unique sur branche `feature/sprint-s2-us-011-cash-limits-xof`.

LIVRABLE
- purchase-request.service.ts modifié.
- Rapport : méthodes modifiées, exceptions enrichies, SHA poussé.

RAPPORT en moins de 250 mots.
```

**Critère d'acceptation US-011** : `assertCashInvariants` opère en XOF, exceptions enrichies, comportement XOF baseline préservé.

---

## Prompt 3 — US-012 : Décrément solde caisse en XOF

```
TÂCHE — Sprint S2 / US-012 / fix F1 décrément cashBox.currentBalance en XOF

CONTEXTE
Même finding F1. Le décrément du solde caisse à la dernière étape
d'approbation d'une DA cash (approval-workflow.service.ts ligne 152, 194
selon l'audit) soustrait actuellement le totalAmount brut, ce qui mélange
les devises sur le solde si la caisse contient des montants déjà décrémentés
par des DA en devises différentes.

Convention métier : cashBox.currentBalance est exprimé dans la devise de la
caisse (cashBox.currency, typiquement XOF). On doit donc convertir le montant
DA dans la devise de la caisse avant décrément.

CORRECTION DEMANDÉE
Dans apps/api/src/procurement/services/approval-workflow.service.ts :

1. Identifier l'endroit du décrément (autour ligne 152 et/ou 194).

2. Si pr.currency === cashBox.currency, pas de conversion nécessaire.

3. Sinon, convertir le pr.totalAmount dans la devise de la caisse. Pour
   simplifier (et conformément à ADR-005 « tout contrôle en XOF »), on
   convertit d'abord en XOF puis (si cashBox.currency != XOF) on reconvertit
   dans la devise caisse. Pratiquement, comme cashBox.currency est presque
   toujours XOF, on peut juste utiliser convertToXof.

4. Vérifier que le pré-check du solde caisse (autour ligne 116-128) utilise
   la même logique de conversion.

CONTRAINTES
- Préserver le rollback transactionnel : si le décrément échoue, la
  transaction Prisma rollback.
- Commit unique sur branche `feature/sprint-s2-us-012-cash-decrement-xof`.

LIVRABLE
- approval-workflow.service.ts modifié.
- Rapport : emplacements modifiés, vérification du pré-check + décrément en
  cohérence, SHA poussé.

RAPPORT en moins de 200 mots.
```

**Critère d'acceptation US-012** : décrément solde caisse en cohérence avec la devise caisse ; rollback préservé.

---

## Prompt 4 — US-013 : Migration Number() → Prisma.Decimal sur agrégats critiques

```
TÂCHE — Sprint S2 / US-013 / fix F10 précision Decimal sur agrégats comptables

CONTEXTE
Audit finding F10 : 44 occurrences de `Number(decimal)` ou conversion implicite
sur des Prisma.Decimal dans des calculs comptables. La conversion en float64
peut entraîner des pertes de précision (ex 0.1 + 0.2 = 0.30000000000000004),
inacceptables pour des montants comptables.

Liste des fichiers concernés par l'audit :
- posting.service.ts (débit/crédit × taux)
- purchase-request.service.ts (totalAmount, agrégats)
- approval-workflow.service.ts (variance)
- payment-run.service.ts (fullyPaid)
- co/services/budget-tracking.service.ts
- dedicated-funds.service.ts

CORRECTION DEMANDÉE
1. Pour chacun des 6 fichiers listés, identifier les occurrences de
   `Number(...)` appliquées à un Prisma.Decimal (champs montant en base).

2. Remplacer par :
   - Pour agrégats : utiliser les opérations Decimal natives :
       const sum = items.reduce(
         (acc, item) => acc.plus(item.amount),
         new Prisma.Decimal(0),
       );
   - Pour comparaisons : `decimal.cmp(other)`, `decimal.gt(other)`, etc.
   - Pour multiplications : `decimal.times(other)`.
   - Pour divisions : `decimal.div(other)`.
   - Pour conversion finale en number (UI ou JSON sortie) : conserver
     `decimal.toNumber()` MAIS uniquement à la frontière sortante (DTO de
     réponse, pas dans les calculs intermédiaires).

3. Si un calcul nécessite obligatoirement un float (ex pour passer à une lib
   externe qui n'accepte que des number), documenter en commentaire le
   pourquoi.

4. Ne PAS toucher aux logs (les `Number(...)` dans les logs Pino sont OK).

CONTRAINTES
- Préserver le comportement métier (pas de changement de valeurs attendues).
- Commit unique sur branche `feature/sprint-s2-us-013-decimal-precision`.
- Tests existants doivent rester verts.

LIVRABLE
- 6 fichiers services modifiés.
- Rapport : décompte des Number() retirés par fichier, exemples avant/après,
  tests passés en vert, SHA poussé.

RAPPORT en moins de 400 mots.
```

**Critère d'acceptation US-013** : ~44 `Number(decimal)` réduits drastiquement sur les agrégats, tests verts, opérations Decimal natives utilisées.

---

## Prompt 5 — US-014 : Tests d'intégration multidevise

```
TÂCHE — Sprint S2 / US-014 / 5 tests d'intégration combinaisons devise × seuil

CONTEXTE
Pour valider que toute la chaîne de contrôle multidevise (US-010 à US-013)
fonctionne de bout en bout, on écrit 5 tests d'intégration couvrant les
combinaisons critiques.

CORRECTION DEMANDÉE
Dans apps/api/src/procurement/__tests__/multicurrency.integration.spec.ts
(à créer) :

Configuration commune : utiliser le pattern jest-mock-extended mockDeep<PrismaService>()
pour mocker la DB, et un ExchangeRateService stubbé qui retourne des
conversions déterministes (EUR → 655.957, USD → 605, XOF → 1).

Test 1 — DA 100k EUR avec contrôle budget XOF :
  Given une ligne budgétaire de 100M XOF avec 0 consommé
  When une DA est créée en 100 000 EUR (= 65 595 700 XOF)
  Then checkBudget passe (65,6M < 100M)
  And la consommation déclarée est 65 595 700 XOF
  And totalAmountXof est stocké en base
  And fx_rate stocké = 655.957

Test 2 — DA 1k USD avec limite caisse XOF :
  Given une caisse en XOF avec perRequestMax = 700 000 XOF
  When une DA cash est créée en 1 000 USD (= 605 000 XOF avec taux stub)
  Then assertCashInvariants passe (605k < 700k)

Test 3 — DA 10k XOF sans conversion (régression baseline) :
  Given une ligne budgétaire de 50M XOF, 0 consommé
  When une DA est créée en 10 000 XOF
  Then checkBudget passe sans conversion (cas XOF passe-through)
  And aucune ligne de log fx_conversion n'est émise pour XOF

Test 4 — DA EUR dépassant ligne budgétaire XOF :
  Given une ligne budgétaire de 50M XOF, 30M XOF consommé
  When une DA est créée en 50 000 EUR (= 32 797 850 XOF)
  Then checkBudget rejette avec BudgetExceededException
  And l'exception porte le montant brut EUR ET l'équivalent XOF

Test 5 — Agrégat Decimal préservé sur 3 DA :
  Given 3 DA approuvées totalisant 100.10 + 100.20 + 100.30 XOF (Decimal)
  When on calcule la somme via reduce Decimal natif
  Then la somme est exactement 300.60 XOF (sans float drift)

CONTRAINTES
- Tests d'intégration (pas pure unit) — utiliser TestingModule NestJS.
- Tests verts à la première exécution.
- Commit unique sur branche `feature/sprint-s2-us-014-multicurrency-tests`.

LIVRABLE
- Fichier multicurrency.integration.spec.ts avec 5 tests verts.
- Rapport : 5 tests passent, SHA poussé.

RAPPORT en moins de 300 mots.
```

**Critère d'acceptation US-014** : 5 tests d'intégration verts couvrant les combinaisons devise × seuil.

---

## Prompt VERIFY-S2 — Vérification globale de fin de sprint

```
TÂCHE — Sprint S2 / VERIFY / vérification globale

VÉRIFICATIONS DEMANDÉES
1. computeBudgetUsageByLine et checkBudget — confirmer qu'ils opèrent en XOF
   avec convertToXof. Lister les 3-4 endroits du code modifiés.

2. assertCashInvariants et décrément cashBox.currentBalance — confirmer la
   cohérence XOF. Lister les emplacements.

3. Number(decimal) — décompte avant/après par fichier ; idéalement < 10
   occurrences restantes (uniquement aux frontières sortantes type DTO).

4. Tests : lancer `npm test` côté API et reporter le résultat. Couverture
   ne doit pas régresser. Spécifiquement, lancer
   `npm test -- multicurrency.integration.spec.ts` et confirmer 5/5.

5. Lint + typecheck verts.

6. Audit finding F1 — confirmer qu'il est résorbé (DA EUR/USD passe le
   contrôle budget en XOF). Si possible, ajouter une note dans
   docs/audit-codebase-2026-06-02.md en marge du F1 : « Résolu Sprint S2 SHA xxx ».

7. Anti-leak.

LIVRABLE
Rapport structuré (Budget / Caisse / Decimal / Tests / Lint / Audit / Anti-leak)
avec ✅ ou ❌ par item, et liste des écarts éventuels.

RAPPORT en moins de 500 mots.
```

---

## Résumé Sprint S2

| Story | Pts | Critère d'acceptation | Statut |
|---|---|---|---|
| US-010 | 5 | Contrôle budgétaire en XOF, BudgetExceededException enrichie | `todo` |
| US-011 | 5 | Limites caisse en XOF, exceptions enrichies | `todo` |
| US-012 | 3 | Décrément caisse en cohérence devise | `todo` |
| US-013 | 8 | ~44 Number(decimal) éliminés sur agrégats | `todo` |
| US-014 | 8 | 5 tests d'intégration verts | `todo` |
| **VERIFY-S2** | — | F1 résorbé, tests verts, lint vert | `todo` |

**Effort total** : 29 points.

**Audit finding F1 — résolution finale attendue en fin de S2.**

**Prochain sprint** : S3 — Engagement classe 8 multidevise + alignement vue v_general_balance + documentation FX (US-020 à US-023).

---

*Prompt Pack Sprint S2 — Version 1.0 — 02 juin 2026*

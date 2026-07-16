# ADR-007 — Eligibility engine centralisé vs validation éparpillée

**Statut** : accepted
**Date** : 2026-06-02
**Auteur** : El Hadj Amadou NIANG
**Dépend de** : ADR-006

## Contexte

Le PPT IPD énonce en slide 7 un catalogue de **comportements interdits** que le système doit techniquement empêcher :

- Déclarer des dépenses engagées non facturées dans un rapport bailleur.
- Imputer les mêmes dépenses sur plusieurs projets.
- Imputer des dépenses inéligibles selon la convention.
- Dépasser les lignes budgétaires.
- Imputer des dépenses sur la mauvaise ligne (incohérence nature ↔ ligne).
- Imputer des dépenses remboursées par Institut Pasteur Paris.
- Imputer des dépenses antérieures ou postérieures à la convention.

Ces interdictions sont en réalité des **règles de contrôle interne** qui doivent être enforced à chaque création de DA, à chaque émission de BC, à chaque comptabilisation de facture. Aujourd'hui, certaines sont implémentées dispersément :

- Le contrôle de dépassement de ligne est dans `purchase-request.service.ts` `computeBudgetUsageByLine` (Lot 1 audit identifie F1 comme bug de conversion).
- La vérification de période ouverte est dans le trigger PostgreSQL `gl.check_period_open`.
- Les autres règles ne sont pas systématiquement vérifiées.

Quatre approches étaient possibles : (a) **validation éparpillée** dans chaque service (le statu quo), (b) **moteur de règles externe** type Drools ou JSON Rules Engine, (c) **gestionnaire métier centralisé** sous forme de service NestJS dédié avec règles déclaratives, (d) **règles directement dans la DB** via triggers et CHECK contraintes.

## Décision

GRANTFLOW IPD introduit en Phase 1 un **EligibilityEngine** centralisé sous forme de service NestJS, qui s'appuie sur les données portées par la **Note Technique active** (cf. ADR-006) comme source de vérité des contraintes.

**Architecture** :

```
src/grant_office/
├── eligibility/
│   ├── eligibility.module.ts
│   ├── eligibility.service.ts          ← le moteur
│   ├── rules/
│   │   ├── nature-allowed.rule.ts      ← nature ∈ natures_autorisées
│   │   ├── date-window.rule.ts         ← date_engagement ∈ [start, end]
│   │   ├── line-not-exceeded.rule.ts   ← amount_xof + consumed ≤ budgeted
│   │   ├── line-nature-coherent.rule.ts ← nature compatible ligne
│   │   ├── not-pasteur-paris-reimbursed.rule.ts
│   │   ├── no-cross-project-duplicate.rule.ts
│   │   ├── period-not-closed.rule.ts
│   │   └── rule.interface.ts           ← contrat commun Rule.check(context) → Verdict
│   └── verdict.ts                       ← OK | Blocked(reason) | Warning(reason)
```

**Contrat de règle** :

```typescript
interface EligibilityRule {
  readonly code: string;          // ex: 'ELIG_NATURE_NOT_ALLOWED'
  readonly severity: 'blocking' | 'warning';
  check(context: EligibilityContext): Promise<Verdict>;
}

type Verdict =
  | { kind: 'ok' }
  | { kind: 'blocked'; code: string; message: string; details?: object }
  | { kind: 'warning'; code: string; message: string; details?: object };
```

**Point d'invocation** : `EligibilityEngine.validate(context)` est appelé **systématiquement** :

- À la création d'une DA (validation préalable à la persistance).
- À la modification d'une DA existante.
- À la transformation DA → BC (re-validation : les règles peuvent avoir évolué).
- À l'imputation d'une facture sur une ligne.
- À la génération d'un rapport bailleur (validation que les dépenses sortent dans les bonnes lignes).

**Centralisation** : aucune validation d'éligibilité ne doit exister hors du moteur. Si un service métier a besoin d'une règle, il la déclare et l'ajoute au moteur — il ne la code pas en inline. Une revue de PR systématique vérifie l'absence de logique d'éligibilité hors moteur.

**Performance** : les règles sont **caches-friendly** (les données Note Technique sont immuables tant que la Note est active). Un cache Redis avec TTL court (5 min) absorbe la charge.

**Audit** : chaque appel au moteur est loggé Pino structuré, avec les règles évaluées et leur verdict. Pratique pour le pentest et l'audit ISA 315.

## Conséquences

### Positives

- **Source unique de vérité** pour le contrôle interne — facile à auditer, à tester, à étendre.
- **Tests d'intégration des règles** indépendants des controllers et services, accélèrent la CI.
- **Évolution rapide** : ajouter une règle métier = créer une classe `*.rule.ts` + l'enregistrer dans le moteur. Pas de touche aux services.
- **Cohérence comportementale** : la même DA validée par le moteur en POST l'est aussi par le moteur en PATCH ou en transformation BC. Pas de divergence par oubli.
- **Documentation vivante** : la liste des règles dans le dossier `eligibility/rules/` est le **catalogue de contrôle interne** du système, directement utilisable comme annexe d'audit.
- **Mémoire** : pattern reconnu (Strategy pattern + Chain of Responsibility), défendable académiquement.

### Négatives

- **Latence supplémentaire** sur chaque validation : N appels async (cachables) pour N règles. Mitigée par le cache Redis et par l'exécution en parallèle des règles indépendantes.
- **Risque de règle manquante** : si une règle métier est implémentée hors moteur par oubli, la centralisation est trahie. Mitigation : convention de revue de PR + lint custom qui détecte les patterns d'éligibilité hors `EligibilityEngine`.
- **Compromis verdict warning vs blocking** : certaines règles (anti-splitting) émettent des warnings non bloquants. Le système doit savoir afficher les warnings à l'utilisateur sans bloquer le flux. UI à concevoir.
- **Couplage Note Technique active** : si aucune Note Technique n'est active, le moteur ne peut pas valider. Période transitoire entre conventions ou avant activation doit être gérée explicitement.

## Dette US-049 — proxy catégorie de ligne (RÉSOLUE par US-055 + US-056)

À la livraison de l'intégration submit (US-049, Sprint S5), `ref.budget_line`
ne portait pas de colonne `category` : l'`EligibilityContextBuilder` posait
`budgetLine.category = expenseNature.category` (proxy documenté). Conséquence :
`LineNatureCoherentRule` (PPT-4 « imputer sur la mauvaise ligne ») comparait
toujours des catégories identiques → **jamais bloquante via `submit()`**.

**Résolution (Sprint S6)** :
- **US-055** — DDL-first : `ref.budget_line.category VARCHAR(32)` + CHECK
  (même domaine que `expense_nature.category`), nullable pour rétrocompat.
- **US-056** — le builder lit `budget_line.category` en **direct**. Fallback
  documenté : si NULL (ligne créée avant US-055), retour au proxy nature avec
  WARN Pino structuré `us049_proxy_fallback_used` (backfill du référentiel à
  planifier) — jamais bloquant, comportement identique à l'antérieur.

**Exemple (PPT-4 désormais actif)** : ligne budgétaire « Équipement labo »
(`category='equipment'`) + DA sur nature `OFFICE_SUPPLIES`
(`category='functioning'`) → `submit()` rejette avec
`ELIG_LINE_NATURE_INCOHERENT` (403 `EligibilityValidationException`).
Couvert par `eligibility-end-to-end.integration.spec.ts` (PPT-4 / PPT-4bis)
et `eligibility-context-builder.service.spec.ts`.

## Dette PPT-5/PPT-6 — champs non transportés par submit() (OUVERTE, constat US-057)

Les règles `NotPasteurParisReimbursedRule` (PPT-5, US-045) et
`NoCrossProjectDuplicateRule` (PPT-6, US-046) sont **enregistrées et exécutées**
par l'`EligibilityEngine` à chaque `submit()` (token `ELIGIBILITY_RULES`).
Elles lisent toutefois leurs champs source **défensivement** sur `ctx.pr`
(`pasteurParisReimbursed`, `supplierInvoiceNumber`) et sont **no-op via
`submit()`** tant que :

1. les colonnes matérialisées par **US-054**
   (`procurement.purchase_request.pasteur_paris_reimbursed` /
   `supplier_invoice_number`, DDL + Prisma) ne sont pas fusionnées dans la
   lignée courante ; et
2. `runEligibilityGate` (`purchase-request.service.ts`) ne transporte pas ces
   champs dans l'`EligibilityPrInput` du builder.

**Résolution prévue** : au merge de la stack S6 (US-054 inclus), ajouter le
transport des 2 champs dans `runEligibilityGate` → bascule automatique
(PPT-5 = blocage, PPT-6 = warning) sans toucher aux règles. La mécanique
réelle est déjà **prouvée** par les tests « preuve moteur » actifs
(`eligibility-end-to-end.integration.spec.ts`, PPT-5/PPT-6) — aucune
activation artificielle n'a été forcée (US-057).

## Alternatives considérées

- **Validation éparpillée** (statu quo) — rejetée. Multipliation des règles dans les services, maintenance dégradée, risque d'oubli sur les nouveaux endpoints.
- **Moteur de règles externe** (Drools, JSON Rules Engine, json-logic-js) — rejeté. Courbe d'apprentissage hors TypeScript, surdimensionné pour le nombre de règles attendu (~15-25), perte de type-safety, dépendance JVM pour Drools.
- **Triggers et CHECK contraintes PostgreSQL** — rejeté. Le DDL-first (ADR-001) protège déjà certains invariants critiques (équilibre, période close, chaînage), mais les règles métier d'éligibilité dépendent de jointures complexes (Note Technique active, eligibility rules, refacturation Pasteur Paris) mal exprimables en CHECK et qui produiraient des erreurs SQL peu lisibles côté frontend.
- **Validation sous forme de Zod refinements** — rejeté. Zod valide la structure des DTO, pas la cohérence métier en lien avec la base. Mélange des responsabilités.

## Références

- PPT IPD *Présentation Gestion de Projet et Conventions de Recherche*, slide 7 (« à ne pas faire »).
- ISA 315 — Control Activities (principle 10 of COSO Framework).
- Oracle Grants Accounting — Burden Schedule, Validation Rules.
- Sage Intacct — Transaction Allocations validation.
- Strategy pattern, Chain of Responsibility — *Design Patterns* (Gamma et al.).
- Note de cadrage Phase 0, §5 et §13.3.
- ADR-006 — Grant Office et Note Technique (source des données).

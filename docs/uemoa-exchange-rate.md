# Taux de change UEMOA & politique multidevise — Note de référence

> Référence opérationnelle du module `exchange-rate` et de la conversion XOF
> dans GRANTFLOW IPD. Pour la **décision d'architecture** (modèle tripartite
> devise transactionnelle / fonctionnelle XOF / reporting), voir
> [`ADR-005`](adr/adr-005-multidevise-tripartite.md) — non recopiée ici.
> Pour les règles d'or projet, voir `CLAUDE.md` §2.

## Sommaire

1. [Objet et périmètre](#1-objet-et-périmètre)
2. [Parité fixe EUR ↔ XOF](#2-parité-fixe-eur--xof)
3. [Devises à taux variable](#3-devises-à-taux-variable)
4. [Le service `convertToXof`](#4-le-service-converttoxof)
5. [Fallback indicatif et journalisation](#5-fallback-indicatif-et-journalisation)
6. [Matérialisation XOF dans les entités](#6-matérialisation-xof-dans-les-entités)
7. [Invariants multidevise](#7-invariants-multidevise-5)
8. [Vue `v_general_balance`](#8-vue-v_general_balance-sprint-s3-us-021)
9. [Politique opérationnelle](#9-politique-opérationnelle)
10. [Migration et backfill](#10-migration-et-backfill)
11. [Erreurs courantes à éviter](#11-erreurs-courantes-à-éviter)
12. [Références](#12-références)

---

## 1. Objet et périmètre

La devise de **tenue comptable** de l'IPD est le **XOF** (franc CFA UEMOA),
conformément au référentiel SYSCEBNL/OHADA. Toute opération saisie dans une
autre devise (EUR, USD…) est convertie en XOF pour les contrôles internes et
les écritures. Cette note décrit **comment** cette conversion est faite, **où**
l'équivalent XOF est figé, et **quels invariants** garantissent la cohérence.

Le module concerné est `apps/api/src/referential/exchange-rate/`.

## 2. Parité fixe EUR ↔ XOF

Le XOF est lié à l'euro par une **parité fixe** garantie par la **BCEAO** et le
**Trésor français** depuis le **4 janvier 1999** :

```
1 EUR = 655,957 XOF   (exactement, inchangé depuis 1999)
```

Conséquences système :

* Toute conversion EUR↔XOF utilise cette **constante**, jamais un taux
  historique — sinon les écritures divergeraient des relevés des banques
  sénégalaises (qui appliquent toutes 655,957).
* La valeur littérale vit à **un seul endroit** :
  `uemoa.constants.ts` → `FX_BCEAO_EUR_XOF = 655.957`.
* Elle est **indépendante de la date** demandée.

| Cas | Comportement |
|---|---|
| `lookup` ou `convertToXof` EUR→XOF, n'importe quelle date | **655,957** |
| `POST /exchange-rates` EUR→XOF avec `isFixed=false` (DAF) | 409 `BUSINESS.FIXED_RATE_EXISTS` |
| `PATCH`/`DELETE` sur la ligne `is_fixed=true` (DAF) | 409 `BUSINESS.IMMUTABLE_FIXED_RATE` |
| Idem en `SUPER_ADMIN` | Autorisé (correction de saisie exceptionnelle) |

> ❌ Ne jamais modifier `FX_BCEAO_EUR_XOF` — cela supposerait une révision du
> traité monétaire UEMOA/France.

## 3. Devises à taux variable

Les devises sans parité fixe (USD, GBP, CHF, ZAR…) sont valorisées par les
**taux journaliers BCEAO**, historisés dans `ref.exchange_rate` :

```sql
-- ref.exchange_rate (extrait)
from_currency CHAR(3) NOT NULL,
to_currency   CHAR(3) NOT NULL,
rate          NUMERIC(18,8) NOT NULL CHECK (rate > 0),
rate_date     DATE NOT NULL,
source        TEXT,
is_fixed      BOOLEAN NOT NULL DEFAULT false,
UNIQUE (from_currency, to_currency, rate_date)
```

Le lookup retourne le taux le plus récent **antérieur ou égal** à la date
demandée. L'alimentation de cette table est sous la responsabilité du
**Contrôle de Gestion (CG)** (cf. §9) — c'est la **source de vérité comptable**.

## 4. Le service `convertToXof`

Toute conversion opérationnelle vers XOF passe par `ExchangeRateService` :

```ts
convertToXof(
  amount: number | Prisma.Decimal,
  currency: string,
  date?: Date,        // date de valorisation (défaut : aujourd'hui)
): Promise<XofConversionResult>;

interface XofConversionResult {
  xofAmount: number;            // montant converti (XOF, arrondi)
  fxRate: number;               // taux appliqué (> 0)
  fxRateDate: Date;             // date du taux (pour audit)
  isIndicativeFallback: boolean; // true si taux indicatif non validé CG
}
```

Comportement par devise :

| Devise | Taux appliqué | `isIndicativeFallback` |
|---|---|---|
| `XOF` | identité (`fxRate = 1`, `xofAmount = round(amount)`) | `false` |
| `EUR` | `FX_BCEAO_EUR_XOF` (655,957), indépendant de la date | `false` |
| `USD`/`GBP`/`CHF`/… | `ref.exchange_rate` (≤ date) si présent | `false` |
| idem, table non alimentée | fallback indicatif (§5) | **`true`** |
| devise inconnue | lève `UnknownCurrencyException` | — |

### Politique d'arrondi (US-095 — ADR-005 §Politique d'arrondi)

Depuis le Sprint S9, `convertToXof` calcule en **`Prisma.Decimal` exact**
(montant × taux) et arrondit **half-up à l'unité XOF, une seule fois, à la
frontière** (`ExchangeRateService.roundXofHalfUp`). Jamais d'arrondi en chaîne
sur des intermédiaires. Justification : le XOF n'a pas de subdivision en
circulation (tenue SYSCEBNL à l'unité) et la parité 655,957 génère des
fractions. Half-up était déjà la règle de fait (`Math.round`) — seul le
mécanisme float64 a été remplacé. Le `xofAmount` retourné est un **entier
exact** (< 2^53), donc sûr en `number` ; les agrégats et comparaisons
budgétaires en aval restent en `Prisma.Decimal` (F-S8-13).

`convertToXof` (opérationnel) se distingue de `lookup` (comptable strict) :

| | `lookup` | `convertToXof` |
|---|---|---|
| Devise absente | **lève** `ExchangeRateNotFoundException` | fallback tracé, ou `UnknownCurrencyException` |
| Usage | vues SYSCEBNL strictes | seuils, contrôle budgétaire, colonnes `*_xof` |

## 5. Fallback indicatif et journalisation

Tant que le CG n'a pas seedé `ref.exchange_rate` pour une devise, `convertToXof`
retombe sur `FALLBACK_INDICATIVE_TO_XOF` — ordres de grandeur 2026 :

```ts
FALLBACK_INDICATIVE_TO_XOF = { USD: 600, GBP: 800, CHF: 700 };
```

* Chaque conversion émet un log Pino structuré `event: 'fx_conversion'`.
* Si fallback indicatif : log **warn** supplémentaire `fx_indicative_fallback_used`.
* ⚠️ **À ne pas utiliser pour une décision comptable en production** : le CG doit
  valider et seeder `ref.exchange_rate` avant la mise en prod.

## 6. Matérialisation XOF dans les entités

Pour les contrôles internes, l'équivalent XOF est figé à l'écriture sur :

- `ref.budget_line` (Sprint S3 US-024) : `budgetedAmountXof`, `fxRate`,
  `fxRateDate`, `currency`.
- `gl.journal_line` (Sprint S1 US-001 puis S3 US-020) : `debit_amount`,
  `credit_amount` déjà en XOF, `fxRate`, `fxRateDate` ajoutés ; ventilation
  transactionnelle dans `debit_currency`, `credit_currency`.
- **Sprint S9 US-097 (F-S8-14)** — triplets écrits À LA CRÉATION via
  `convertToXof` sur : `procurement.purchase_request` (+ lignes),
  `procurement.purchase_order` (+ lignes), `ap.invoice` (+ lignes),
  `ap.payment`. Dates de valorisation : DA = jour de création (requested_at,
  re-figé au PATCH si montant/devise change), BC = order_date, facture =
  invoice_date (date de la pièce), paiement = payment_date.

## 7. Invariants multidevise (5)

- **I1** : `currency ≠ XOF` ⟹ `fx_rate` + `fx_rate_date` renseignés.
- **I2** : `debit/credit` toujours en XOF, brut dans `debit_currency` / `credit_currency`.
- **I3** : `fx_rate > 0`.
- **I4** : `fx_rate` ⟹ `fx_rate_date`.
- **I5** : lignes d'un `journal_entry` = même devise.

Aujourd'hui couverts au niveau application via `convertToXof` et les
sentinelles `posting-multicurrency-invariants.spec.ts`. CHECK DB
`chk_fx_consistency` planifié **US-140** (Sprint S3bis ou S4).

## 8. Vue `v_general_balance` (Sprint S3 US-021)

Exposition des soldes XOF :

- `balance_xof`, `total_debit_xof`, `total_credit_xof` (source de vérité SYSCEBNL).
- `transaction_currencies` : `array_agg DISTINCT` des devises étrangères
  (XOF exclu par construction).
- Colonnes historiques (`total_debit`, `total_credit`, `balance`) conservées
  rétrocompat.

## 9. Politique opérationnelle

- Le CG IPD est responsable de la mise à jour mensuelle de
  `ref.exchange_rate` pour USD, GBP, CHF (procédure à définir).
- Tout taux non validé par le CG produit le warn fallback.
- L'audit interne mensuel doit traiter les warns fallback (tableau de
  bord à concevoir Phase 7).

## 10. Migration et backfill

- Nouvelle convention : `convertToXof` appelé au paramétrage.
- Données legacy : script `apps/api/scripts/backfill-budget-line-xof.ts`
  fige les `budget_line` existantes au taux du jour d'exécution. Pattern
  réutilisable pour d'autres entités.
- **US-097** : `apps/api/scripts/backfill-xof-triplets.ts` — matérialise les
  triplets sur DA/BC/facture/paiement (+ lignes) où ils sont NULL.
  **Dry-run par défaut** (rapport ligne à ligne JSON), APPLY via
  `BACKFILL_APPLY=on` (marqueur `grantflow.backfill_apply`, convention
  US-067). Taux à la date métier de l'entité ; si aucun taux BD n'existe à
  cette date, repli sur le taux du jour d'exécution (flag `usedTodayRate`) ;
  l'indicatif 600/800/700 ne reste qu'en dernier recours (flag
  `isIndicativeFallback`). Exécution Neon soumise à GO explicite.

## 11. Erreurs courantes à éviter

- ❌ `Number(decimal)` sur un montant utilisé dans un agrégat → perte précision.
- ❌ Arrondi en chaîne (arrondir un intermédiaire puis re-calculer) — l'arrondi
  half-up unité XOF s'applique UNE fois, à la frontière (ADR-005 addendum).
- ❌ Comparaison de montant brut à un seuil XOF sans conversion.
- ❌ Validation d'éligibilité ou de plafond hors XOF.
- ❌ Modification de `FX_BCEAO_EUR_XOF`.
- ❌ Utilisation du fallback indicatif en production sans validation CG.

## 12. Références

- [`ADR-005`](adr/adr-005-multidevise-tripartite.md) — multidevise tripartite.
- [`audit-codebase-2026-06-02.md`](audit-codebase-2026-06-02.md) — findings F1, F10, F18.
- Sprints S1–S3 (US-001, US-005, US-010 à US-014, US-020 à US-024).
- BCEAO : <https://www.bceao.int/> · SYSCEBNL (Acte uniforme OHADA) : <https://www.uemoa.int/>
- Code : `referential/exchange-rate/uemoa.constants.ts`, `ExchangeRateService`.

---

_Dernière mise à jour : 17/07/2026 — Sprint S9 / US-095, politique d'arrondi (El Hadj Amadou NIANG)._

# Taux de change UEMOA — Note de référence

> Document de cadrage métier pour le module `exchange-rate` (sprint 1.4).
> Vocation : référence rapide pour développeurs et mémoire MIAGE 2025/2026.

## 1. Parité fixe EUR ↔ XOF

Le franc CFA (XOF, ISO 4217) est lié à l'**euro** par une **parité fixe** garantie
par la **BCEAO** (Banque Centrale des États de l'Afrique de l'Ouest) depuis le
**04 janvier 1999** :

```
1 EUR = 655,957 XOF            (exactement)
1 XOF ≈ 0,001 524 49 EUR        (1 / 655,957)
```

Cette parité n'a **jamais changé** depuis 1999. La BCEAO n'a pas autorité pour
la modifier unilatéralement : tout réajustement passerait par un acte du Conseil
des Ministres de l'UEMOA et un avis de la Banque de France (Trésor public).

### Implication système

* Toute conversion EUR↔XOF doit **utiliser cette constante** plutôt qu'un taux
  historique. Sinon les écritures comptables divergeraient des relevés bancaires
  émis par les banques sénégalaises (qui appliquent toutes 655,957).
* Le module `exchange-rate` matérialise la parité en BD via une ligne avec
  `is_fixed = true`. Le service la retourne **sans considérer la date** demandée.

### Garde-fous applicatifs

| Cas | Comportement |
|---|---|
| `GET /exchange-rates/lookup?from=EUR&to=XOF` | Retourne **655.957** quelle que soit la date. |
| `GET /exchange-rates/lookup?from=EUR&to=XOF&date=1995-01-01` | Idem (la parité est rétroactive métier). |
| `POST /exchange-rates` (DAF) avec `from=EUR, to=XOF, isFixed=false` | **409 `BUSINESS.FIXED_RATE_EXISTS`** — impossible d'écraser. |
| `PATCH` ou `DELETE` sur la ligne `is_fixed=true` (DAF) | **409 `BUSINESS.IMMUTABLE_FIXED_RATE`** — refusé. |
| Idem mais utilisateur `SUPER_ADMIN` | **Autorisé** — cas exceptionnel d'erreur de saisie. |

## 2. Autres devises (taux variables)

Les couples sans parité fixe sont alimentés par les taux journaliers BCEAO :

| Devise | ISO 4217 | Source taux | Mise à jour |
|---|---|---|---|
| Dollar US | USD | BCEAO daily fix | Tous les jours ouvrables |
| Livre sterling | GBP | BCEAO daily fix | Tous les jours ouvrables |
| Franc suisse | CHF | BCEAO daily fix | Tous les jours ouvrables |
| Rand sud-africain | ZAR | BCEAO daily fix | Tous les jours ouvrables |

Le module expose un endpoint `/exchange-rates/lookup` qui retourne le taux le
plus récent **antérieur ou égal** à la date demandée (champ `isFallback`
indique si on a dû reculer faute de taux du jour exact).

## 3. Procédure de mise à jour quotidienne

En production, un job BullMQ (`treasury.exchange-rate-sync`, planifié à 09 h 00
Africa/Dakar) :

1. Télécharge le fichier CSV de la BCEAO (URL stable, format `YYYYMMDD.csv`).
2. Parse les colonnes `from_currency, to_currency, rate`.
3. Pour chaque ligne :
   * Si `(from, to)` a une parité fixe → **ignoré** (sécurité).
   * Sinon → upsert dans `ref.exchange_rate` avec `rateDate = today` et
     `source = 'BCEAO_DAILY'`.
4. Journalise dans `audit.event_log`.

En développement / mémoire, on peut alimenter à la main :

```bash
curl -X POST http://localhost:4000/api/v1/exchange-rates \
  -H "Authorization: Bearer $TOKEN_DAF" \
  -H "Content-Type: application/json" \
  -d '{
    "fromCurrency": "USD",
    "toCurrency":   "XOF",
    "rate":          598.10,
    "rateDate":     "2026-05-14",
    "source":       "manual"
  }'
```

## 4. Schéma BD

Table `ref.exchange_rate` :

```sql
id            UUID PRIMARY KEY,
from_currency CHAR(3) NOT NULL,
to_currency   CHAR(3) NOT NULL,
rate          NUMERIC(18,8) NOT NULL CHECK (rate > 0),
rate_date     DATE NOT NULL,
source        TEXT,
is_fixed      BOOLEAN NOT NULL DEFAULT false,
UNIQUE (from_currency, to_currency, rate_date)
```

Index partiel sur les parités fixes (au plus un couple par paire) :

```sql
CREATE INDEX idx_exchange_rate_fixed
  ON ref.exchange_rate(from_currency, to_currency)
  WHERE is_fixed = true;
```

## 5. Politique FX GRANTFLOW IPD (Sprint S1 / US-005, ADR-005)

La conversion vers **XOF** (devise fonctionnelle SYSCEBNL) suit une politique
unique, centralisée dans `apps/api/src/referential/exchange-rate/uemoa.constants.ts`
et appliquée par `ExchangeRateService`.

### 5.1 Parité immuable EUR/XOF

`1 EUR = 655,957 XOF`, fixée par les accords successifs de Bretton Woods et
garantie par le **Trésor français** depuis 1999. Constante unique
`FX_BCEAO_EUR_XOF` (valeur littérale présente à **un seul endroit** du code API).
Indépendante de la date : toute conversion EUR↔XOF l'utilise telle quelle.
**NE PAS MODIFIER** sauf modification du traité international.

### 5.2 Taux historisés en BD pour USD / GBP / CHF / autres

Les devises non rattachées sont valorisées via la table `ref.exchange_rate`
(taux quotidiens BCEAO, le plus récent ≤ date demandée). Le contrôle de
gestion (CG) alimente cette table. C'est la **source de vérité comptable**.

### 5.3 Fallback indicatif (en attendant l'alimentation par le CG)

Tant que `ref.exchange_rate` n'est pas seedée pour une devise, `convertToXof`
retombe sur `FALLBACK_INDICATIVE_TO_XOF` (`Object.freeze({ USD: 600, GBP: 800,
CHF: 700 })`) — valeurs « ordre de grandeur 2026 ».

* ⚠️ **À NE PAS UTILISER pour des décisions comptables** en production.
* Chaque usage est marqué `isIndicativeFallback = true` dans le résultat et
  sera **loggé loud** (log Pino, audit ajouté en US-006).
* Le CG doit **valider et seeder** `ref.exchange_rate` avant la mise en prod.

### 5.4 `lookup` (comptable strict) vs `convertToXof` (opérationnel)

| | `lookup` | `convertToXof` |
|---|---|---|
| Vocation | Primitive comptable STRICTE | Conversion OPÉRATIONNELLE (source unique) |
| Devise absente | **Lève** `ExchangeRateNotFoundException` | Fallback indicatif tracé, ou `UnknownCurrencyException` |
| Usage | Vues SYSCEBNL strictes, écritures | Seuils d'approbation, contrôle budgétaire, colonnes `*_xof` |
| EUR | via ligne `is_fixed=true` en BD | parité `FX_BCEAO_EUR_XOF` en dur |

`convertToXof` ne doit JAMAIS alimenter une écriture comptable sur la base d'un
fallback indicatif sans validation CG.

### 5.5 Références code

* Constantes : `apps/api/src/referential/exchange-rate/uemoa.constants.ts`
  (`FX_BCEAO_EUR_XOF`, `FIXED_XOF_EUR`, `FALLBACK_INDICATIVE_TO_XOF`).
* Service : `ExchangeRateService.convertToXof` / `.lookup`.
* Décision d'architecture : **ADR-005** (`docs/adr/adr-005-multidevise-tripartite.md`).

## 6. Références officielles

* BCEAO — Banque Centrale des États de l'Afrique de l'Ouest : <https://www.bceao.int/>
* Article 1 du règlement UEMOA N° 09/2010/CM/UEMOA portant statuts de la BCEAO.
* Note de change EUR↔XOF du 04/01/1999 (Banque de France, accord de coopération
  monétaire France-UEMOA).
* Plan SYSCEBNL : <https://www.uemoa.int/> (référentiel comptable OBNL).

---

_Dernière mise à jour : 06/06/2026 — Sprint S1 / US-005 (El Hadj Amadou NIANG)._

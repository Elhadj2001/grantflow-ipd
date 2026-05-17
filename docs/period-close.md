# Clôture mensuelle + États financiers SYSCEBNL — Sprint 6.2

> Runbook DAF / Contrôleur de gestion / Comptable
> Source de vérité DDL : [`grantflow_ddl_postgresql.sql`](./grantflow_ddl_postgresql.sql) (sections sprint 6.2).
> Migration idempotente standalone : [`migrations/sprint-6.2-period-close.sql`](./migrations/sprint-6.2-period-close.sql).

## 1. Concepts

Une **période fiscale** (`gl.fiscal_period`) est mensuelle, trimestrielle ou
annuelle (`period_type`). La clôture matérialise le moment où **aucune
nouvelle écriture comptable** ne peut être passée sur la période — y
compris correction (le trigger `gl.check_period_open` refuse tout
INSERT/UPDATE d'un `journal_entry` sur une période `is_closed=true`).

Trois opérations métier sont disponibles :

| Verbe | Acteurs | Effet |
|---|---|---|
| **precheck** | COMPTABLE, CONTROLEUR, DAF, SUPER_ADMIN | Calcule tous les checks (BLOCKING/WARNING) et persiste les findings dans `gl.period_close_check`. Toujours sûr — n'écrit pas dans `gl.journal_*`. |
| **dedicated-funds** | CONTROLEUR, DAF, SUPER_ADMIN | Pour chaque grant actif : écriture OD 689 D/19 C (dotation) ou 19 D/789 C (reprise). Idempotent. |
| **close** | CONTROLEUR, DAF, SUPER_ADMIN | Bascule `is_closed=true`. Refusé si BLOCKING findings sans override DAF. |
| **reopen** | **DAF uniquement** (ou SUPER_ADMIN) | Bascule `is_closed=false`. `reason` obligatoire, journalisé. |

Toutes ces opérations sont journalisées dans `gl.period_close_event`
(append-only) avec `action`, `user_id`, `reason`, `payload JSONB`,
`occurred_at` — auditable bailleur N+1.

## 2. Checks de pré-clôture

| Code | Severity | Description |
|---|---|---|
| **C001** | BLOCKING | DA dans un statut d'approbation (submitted, pending_*) datée dans la période. |
| **C002** | BLOCKING | BC actifs (draft/sent/acknowledged) dont la date d'ordre tombe dans la période — pas encore reçus/facturés. |
| **C003** | BLOCKING | Facture `matched` (3-way OK) dont la facture date dans la période mais non comptabilisée. |
| **C004** | BLOCKING | Écriture `posted` déséquilibrée. Devrait être impossible (trigger `gl.check_entry_balance`) — check défensif. |
| **C005** | BLOCKING | Grant actif ayant reçu des ressources 75x sur la période **sans** mouvement `co.dedicated_fund_movement` — il faut lancer `dedicated-funds` avant `close`. |
| **C006** | BLOCKING | GR `complete` sur la période dont le PO n'a aucune facture `posted/partially_paid/paid` (FNP manquante). |
| **W001** | WARNING | Au moins 1 budget_line avec variance > 10% (consommation vs budget). |
| **W002** | WARNING | Au moins 1 fournisseur dont l'IBAN a changé < 30j avant `period.endDate`. Silencieux si la table `ref.supplier_iban_history` n'existe pas. |
| **W003** | WARNING | Période N-1 du même type (`month`/`quarter`/`year`) pas encore close. |

Les WARNING **n'empêchent pas** le close. Les BLOCKING le bloquent, sauf
override DAF (cf. §3).

## 3. Workflow nominal

```bash
# 0. Authentification (token DAF)
TOKEN=$(curl -s -X POST http://localhost:8080/realms/grantflow/protocol/openid-connect/token \
  -d "client_id=grantflow-web" -d "grant_type=password" \
  -d "username=daf@pasteur.sn" -d "password=Daf#2026-IPD" \
  | jq -r .access_token)

# 1. Identifier la période (ex. février 2026)
PERIOD_ID=$(curl -s -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/v1/accounting/periods | jq -r '.[] | select(.code=="2026-02").id')

# 2. Precheck (réécrit les findings)
curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/v1/accounting/periods/$PERIOD_ID/precheck" | jq

# 3. Si C005 → lancer dedicated-funds
curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/v1/accounting/periods/$PERIOD_ID/dedicated-funds" | jq

# 4. Re-precheck → canClose=true ?
curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/v1/accounting/periods/$PERIOD_ID/precheck" | jq .canClose

# 5. Close
curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/v1/accounting/periods/$PERIOD_ID/close" \
  -H "Content-Type: application/json" -d '{}' | jq

# 6. Générer les états financiers
for TYPE in TER BILAN RESULTAT; do
  curl -s -X POST -H "Authorization: Bearer $TOKEN" \
    "http://localhost:3000/api/v1/reporting/statements" \
    -H "Content-Type: application/json" \
    -d "{\"periodId\":\"$PERIOD_ID\",\"type\":\"$TYPE\"}" | jq .id
done

# 7. Lock + télécharger (DAF uniquement)
SID=$(curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/v1/reporting/statements?periodId=$PERIOD_ID&type=TER" \
  | jq -r '.[0].id')
curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/v1/reporting/statements/$SID/lock"
curl -sO -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/v1/reporting/statements/$SID/pdf"
curl -sO -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/v1/reporting/statements/$SID/excel"
```

## 4. Override DAF (BLOCKING findings)

Si le DAF accepte de clôturer malgré des findings BLOCKING (cas
exceptionnel : DA en retard d'instruction, BC à reporter sur N+1,
etc.), il doit passer :

```bash
curl -X POST .../close -d '{
  "acknowledgeWarnings": true,
  "reason": "DA #PR-2026-0234 reportée sur 2026-03 — accord PI signé le 28/02"
}'
```

Le `reason` (≥ 5 caractères) est journalisé dans `gl.period_close_event`
et restera consultable même après reopen.

## 5. Réouverture (DAF only)

```bash
curl -X POST .../reopen -d '{"reason":"Correction écriture OD-2026-0042"}'
```

Effets :
- `is_closed = false`
- `reopened_at`, `reopened_by`, `reopen_reason` renseignés
- Event `action='reopen'` ajouté
- L'historique du `closed_at`/`closed_by` est préservé dans le payload de
  l'event (`previouslyClosedAt`, `previouslyClosedBy`).

## 6. Fonds dédiés (689 / 789)

Pour chaque grant actif sur la période :
1. **Ressources reçues N** = `SUM(crédit - débit)` sur comptes commençant
   par `75` imputés au grant.
2. **Dépenses N** = `SUM(débit - crédit)` sur comptes commençant par `6`.
3. **Solde 19 d'ouverture** = `SUM(crédit - débit)` sur compte `19`
   imputé au grant, pour toutes les écritures `posted` antérieures à
   `period.start_date`.

| Cas | Écriture OD | Montant |
|---|---|---|
| Ressources > Dépenses | 689 D / 19 C | `ressources - dépenses` |
| Dépenses > Ressources **ET** solde 19 > 0 | 19 D / 789 C | `min(solde19, |déficit|)` |
| Autres (équilibré ou pas de solde) | aucune | 0 |

Tous les montants sont en XOF (livres tenus en XOF). Le grant_id est
posé sur les 2 lignes (analytique).

L'opération est **idempotente** : un appel répété supprime le
`co.dedicated_fund_movement` précédent (mais l'écriture comptable est
conservée et marquée — pas de delete d'une `posted`). Pour rejouer
proprement, ré-ouvrir + nettoyer manuellement.

## 7. États financiers SYSCEBNL

3 types disponibles :

### TER — Tableau Emplois / Ressources
- **EMPLOIS** = charges 6x (hors 689 isolé) + reprises 789
- **RESSOURCES** = produits 7x (hors 789) + dotations 689

### BILAN
- **ACTIF** = classes 2 (immobilisations), 3 (stocks), 5 (financier),
  classe 4 hors 40x avec solde débiteur > 0
- **PASSIF** = classe 1 (capitaux propres + 19 fonds dédiés), 40x
  (fournisseurs) avec solde créditeur > 0, **plus** le résultat net
  de l'exercice (calculé `produits - charges`).
- **Tolérance équilibre** : ±1 XOF (arrondis cumulés). Au-delà, le
  service refuse de produire le statement et lève
  `FINANCIAL_STATEMENT_NOT_BALANCED`.

### RESULTAT (Compte de Résultat)
- **CHARGES** = tous comptes 6x (incl. 689)
- **PRODUITS** = tous comptes 7x (incl. 789)
- Résultat = `produits - charges`. **Toujours équilibré** par construction.

### Workflow
- `POST /reporting/statements` (COMPTABLE+) génère et persiste. Idempotent
  tant que pas `locked` → écrase la version précédente.
- `POST /reporting/statements/:id/lock` (DAF only) verrouille — devient
  immuable si la période est elle aussi close (trigger DB
  `reporting.protect_locked_statement`).
- `GET /reporting/statements/:id/{pdf,excel}` télécharge.

Fichiers stockés dans MinIO bucket `grantflow-reports` sous
`statements/YYYY/MM/`.

## 8. Codes d'erreur

| Code | HTTP | Description |
|---|---|---|
| `BUSINESS.PERIOD_NOT_FOUND` | 404 | Période inconnue |
| `BUSINESS.PERIOD_ALREADY_CLOSED` | 409 | Tentative de close sur déjà close |
| `BUSINESS.PERIOD_ALREADY_OPEN` | 409 | Tentative de reopen sur ouverte |
| `BUSINESS.PERIOD_CLOSE_BLOCKED` | 409 | Findings BLOCKING + pas d'override |
| `BUSINESS.PERIOD_CLOSE_REASON_REQUIRED` | 400 | Override DAF sans reason |
| `BUSINESS.PERIOD_REOPEN_REASON_REQUIRED` | 400 | Reopen sans reason |
| `BUSINESS.FINANCIAL_STATEMENT_NOT_FOUND` | 404 | Statement inconnu |
| `BUSINESS.FINANCIAL_STATEMENT_LOCKED` | 409 | Régénération d'un statement locked |
| `BUSINESS.FINANCIAL_STATEMENT_NOT_BALANCED` | 409 | Écart > 1 XOF entre les colonnes |
| `BUSINESS.FINANCIAL_STATEMENT_FILE_NOT_GENERATED` | 404 | Download avant génération |

## 9. Fixtures

- [`tests/fixtures/sprint-6.2-TER-2026-01.pdf`](../tests/fixtures/sprint-6.2-TER-2026-01.pdf) — TER PDF synthétique (charges + produits + fonds dédiés équilibrés)
- [`tests/fixtures/sprint-6.2-TER-2026-01.xlsx`](../tests/fixtures/sprint-6.2-TER-2026-01.xlsx) — Excel 2 onglets

## 10. À implémenter dans les sprints suivants

- **Sprint 6.3** : Comparaison N vs N-1 (variance YTD), bilan détaillé
  par rubrique SYSCEBNL avec exigibilité court/long terme.
- **Sprint 6.4** : Annexes obligatoires SYSCEBNL (état de variation
  des fonds dédiés, état des engagements hors bilan).
- **Sprint 7.x** : Signature PAdES sur les PDF lockés.

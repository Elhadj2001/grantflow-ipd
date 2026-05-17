# Reporting bailleur — Sprint 6.1

Ce document décrit le module Reporting (sprint 6.1) qui automatise la
production des rapports financiers contractuels envoyés aux bailleurs
(USAID, OMS, Wellcome Trust, AFD, etc.).

> **Objectif** : à partir des écritures comptables SYSCEBNL, produire un
> rapport agrégé par catégories imposées par le bailleur (Personnel,
> Travel, Equipment, …), au format PDF et Excel signables, avec calcul
> automatique de l'overhead consommé, de la variance budgétaire et des
> fonds reportés.

## 1. Modèle de données

5 nouvelles tables dans le schéma `reporting` :

| Table | Rôle |
|-------|------|
| `donor_report_template` | Template par bailleur (USAID FFR-425, OMS, Wellcome…) |
| `donor_category` | Catégories imposées par le bailleur (Personnel, Travel, …) |
| `account_mapping` | Mapping compte SYSCEBNL → catégorie bailleur (+ sign) |
| `donor_report` | Rapport produit pour 1 grant × 1 période |
| `donor_report_line` | 1 ligne agrégée par catégorie |

**Trigger BD** : `reporting.protect_sent_report` interdit toute
modification d'un rapport `status='sent'` (sauf transitions vers
toujours `sent` qui sont des no-op).

## 2. Cycle de vie d'un rapport

```
   POST /donor-reports             POST /:id/lock             POST /:id/send
        │                                │                          │
        ▼                                ▼                          ▼
   ┌────────┐  aggregate journal_lines  ┌────────┐ generate PDF + xlsx ┌──────┐
   │  draft │ ─────────────────────────►│ locked │ ──────────────────► │ sent │
   └────────┘                           └────────┘                     └──────┘
                                                                          ▲
                                                          immutable (trigger BD)
```

| Transition | Acteur | Effet |
|------------|--------|-------|
| → `draft`  | CONTROLEUR / DAF / SUPER_ADMIN | Agrège (snapshot) + crée lignes |
| `lock`     | CONTROLEUR / DAF / SUPER_ADMIN | Génère PDF + Excel → MinIO |
| `send`     | **DAF / SUPER_ADMIN** | status=sent + sentBy/sentAt |

## 3. Logique d'agrégation

Pour chaque rapport, `ReportAggregationService.aggregate` :

1. **Mapping** : SUM signée `(debit - credit) × mapping.sign` par compte
   sur la période, filtré sur `grant_id = report.grantId`,
   `entry.status='posted'`, `entry.entryDate BETWEEN periodStart AND
   periodEnd`. Lecture via `prisma.journalLine.groupBy`.
2. **Conversion FX** : `XOF → target_currency` au dernier jour de la
   période (taux le plus récent ≤). Si absent → `409
   REPORTING_FX_RATE_MISSING`. Fallback inverse (`target → XOF`) géré
   via `1 / rate`.
3. **Overhead** : SUM `overhead_calculation.overhead_amount` pour la
   grant sur la période (table `co.overhead_calculation` — generated
   column `overhead_amount = eligible_base × overhead_rate`).
4. **Budget** : SUM `budget_line.budgeted_amount` (devise grant)
   distribué sur la catégorie via `budget_line.default_account` ↔
   `account_mapping.glAccountCode`. Conversion grant.currency → XOF →
   target_currency.
5. **Funds carried over** : `max(0, grant.amount(converted) − totalSpent)`.
6. **Variance** : `(spent - budget) / budget * 100`. Flag `alert=true`
   si `|variance| > 10%` (seuil `VARIANCE_ALERT_THRESHOLD_PCT`).

## 4. Endpoints

Sous `/api/v1/reporting/`, JWT Bearer.

### Templates
| Méthode | Path | Rôles |
|---------|------|-------|
| GET | `/templates` | auth |
| GET | `/templates/:id` | auth |
| POST | `/templates` | CONTROLEUR, DAF, SUPER_ADMIN |
| POST | `/templates/:id/mappings` | CONTROLEUR, DAF, SUPER_ADMIN |

### Reports
| Méthode | Path | Rôles |
|---------|------|-------|
| GET | `/donor-reports` | auth |
| GET | `/donor-reports/:id` | auth |
| POST | `/donor-reports` | CONTROLEUR, DAF, SUPER_ADMIN |
| POST | `/donor-reports/:id/lock` | CONTROLEUR, DAF, SUPER_ADMIN |
| POST | `/donor-reports/:id/send` | **DAF, SUPER_ADMIN** |
| GET | `/donor-reports/:id/pdf` | auth (stream PDF) |
| GET | `/donor-reports/:id/excel` | auth (stream xlsx) |

## 5. Codes d'erreur (`BUSINESS.*`)

| Code | HTTP | Quand |
|------|------|-------|
| `DONOR_TEMPLATE_NOT_FOUND` | 404 | templateId inconnu |
| `DONOR_REPORT_NOT_FOUND` | 404 | reportId inconnu |
| `DONOR_REPORT_NOT_DRAFT` | 409 | lock sur rapport pas en draft/locked |
| `DONOR_REPORT_NOT_LOCKED` | 409 | send sur rapport pas en locked |
| `DONOR_REPORT_ALREADY_SENT` | 409 | toute mutation sur rapport sent |
| `DONOR_REPORT_FILE_NOT_GENERATED` | 404 | download avant lock |
| `DONOR_TEMPLATE_HAS_NO_MAPPINGS` | 409 | aggregate sur template vide |
| `REPORTING_PERIOD_INVALID` | 400 | période invalide ou hors grant |
| `REPORTING_FX_RATE_MISSING` | 409 | taux de change manquant |

## 6. Templates seedés

Le fichier `seed/donor-templates.json` est la source unique des
templates par bailleur :

- **USAID FFR-425** (USD) : 8 catégories (Personnel, Fringe, Travel,
  Equipment, Supplies, Contractual, Other, Indirect Costs) + 10 mappings
- **WHO standard** (CHF) : 5 catégories (Staff, Activities, Travel,
  Equipment, Admin) + 10 mappings
- **Wellcome Trust** (GBP) : 5 catégories (Research, Personnel, Estates,
  Indirect, Travel) + 9 mappings

L'idempotence est garantie par `upsert` sur `(templateId, code)` pour
les catégories et `(templateId, glAccountCode)` pour les mappings.

## 7. PDF — structure

Le `PdfRenderService` produit un PDF A4 mono-page avec :

- **Entête** : "INSTITUT PASTEUR DE DAKAR" + adresse + référence rapport
  (`DR-YYYY-<8 first chars of UUID>`)
- **Métadonnées** : convention, projet, période, devise + taux, généré
  par/le
- **Tableau** : catégorie / budget / spent / variance % (rouge si alert)
- **Totaux** : total budget, total spent (dont overhead), funds carried
- **Pied** : signature DAF + référence

Pas de logo image (pdfkit pur, pas de dépendance fs supplémentaire). La
mise en page peut être étendue avec un logo via `doc.image(buffer, …)`
dans un sprint ultérieur.

## 8. Excel — 3 onglets

Le `ExcelRenderService` produit un fichier .xlsx avec :

1. **Summary** : 18 lignes clé→valeur (report number, donor, grant,
   période, totaux)
2. **Detail by category** : header + 1 ligne par catégorie (Code, Label,
   Budget, Spent, Variance, Variance %, Alert)
3. **Detail by account** : header + 1 ligne par compte SYSCEBNL imputé
   sur la grant pendant la période (Code, Label, Total debit XOF, Total
   credit XOF, Net XOF). Utile aux auditeurs bailleurs.

## 9. Exemples curl

Variables :
```bash
export TOKEN_CG="..."   # CONTROLEUR
export TOKEN_DAF="..."  # DAF
export GRANT_ID="..."
export TEMPLATE_ID="..."
export REPORT_ID="..."
```

### Lister les templates
```bash
curl -X GET "http://localhost:4000/api/v1/reporting/templates" \
  -H "Authorization: Bearer $TOKEN_CG"
```

### Créer un template + catégories + mappings
```bash
TEMPLATE_ID=$(curl -s -X POST "http://localhost:4000/api/v1/reporting/templates" \
  -H "Authorization: Bearer $TOKEN_CG" -H "Content-Type: application/json" \
  -d '{
    "code": "CUSTOM-DONOR",
    "name": "Custom Donor template",
    "currency": "EUR",
    "format": { "layout": "custom" },
    "categories": [
      { "code": "STAFF", "label": "Staff", "sortOrder": 1 },
      { "code": "OPS",   "label": "Operations", "sortOrder": 2 }
    ]
  }' | jq -r .id)

curl -X POST "http://localhost:4000/api/v1/reporting/templates/$TEMPLATE_ID/mappings" \
  -H "Authorization: Bearer $TOKEN_CG" -H "Content-Type: application/json" \
  -d '{
    "mappings": [
      { "glAccountCode": "661", "categoryCode": "STAFF", "sign": 1 },
      { "glAccountCode": "604", "categoryCode": "OPS",   "sign": 1 }
    ]
  }'
```

### Créer un rapport (draft)
```bash
REPORT_ID=$(curl -s -X POST "http://localhost:4000/api/v1/reporting/donor-reports" \
  -H "Authorization: Bearer $TOKEN_CG" -H "Content-Type: application/json" \
  -d "{
    \"grantId\":     \"$GRANT_ID\",
    \"templateId\":  \"$TEMPLATE_ID\",
    \"periodStart\": \"2026-01-01\",
    \"periodEnd\":   \"2026-03-31\",
    \"notes\": \"Q1 2026 — premier reporting\"
  }" | jq -r .id)
```

### Lock (génère PDF + Excel)
```bash
curl -X POST "http://localhost:4000/api/v1/reporting/donor-reports/$REPORT_ID/lock" \
  -H "Authorization: Bearer $TOKEN_CG"
```

### Télécharger PDF / Excel
```bash
curl -X GET "http://localhost:4000/api/v1/reporting/donor-reports/$REPORT_ID/pdf" \
  -H "Authorization: Bearer $TOKEN_CG" -o report.pdf

curl -X GET "http://localhost:4000/api/v1/reporting/donor-reports/$REPORT_ID/excel" \
  -H "Authorization: Bearer $TOKEN_CG" -o report.xlsx
```

### Envoyer (DAF — immutable après)
```bash
curl -X POST "http://localhost:4000/api/v1/reporting/donor-reports/$REPORT_ID/send" \
  -H "Authorization: Bearer $TOKEN_DAF" -H "Content-Type: application/json" \
  -d '{ "externalReference": "USAID-Q1-2026", "notes": "Envoyé par email à grants@usaid.gov" }'
```

## 10. Tests

Couverture :

- **Unit** (51 nouveaux) :
  - `report-aggregation.service.spec.ts` (14) — mapping, FX,
    variance, overhead, funds, sign +/-
  - `pdf-render.service.spec.ts` (6) — magic header, trailer, taille
    croissante, gestion notes/0 catégories
  - `excel-render.service.spec.ts` (6) — 3 onglets exacts, header
    correct, données par ligne
  - `donor-template.service.spec.ts` (9) — CRUD + P2002 + parentCode
    resolution + EntityNotFound
  - `donor-report.service.spec.ts` (16) — workflow create/lock/send +
    rejets (NotDraft, AlreadySent, NotLocked, FileNotGenerated)
- **Integration** (e2e, opt-in `STACK_UP=1`, 4 cas) :
  - Workflow complet draft → lock → PDF/Excel → send → trigger BD
    refuse mutation
  - RBAC : BAILLEUR cannot lock (403)
  - Période hors range → 400 REPORTING_PERIOD_INVALID
  - GET /templates retourne ≥ 1 template

## 11. Limitations connues

- Le rapport est un **snapshot** : les `donor_report_line` sont figées
  à la création. Une mutation postérieure des `journal_line` (sur la
  période rapportée) ne reflète PAS dans les rapports déjà créés. Pour
  re-générer, créer un nouveau rapport draft.
- Les fixtures bailleur (`donor-templates.json`) seedent automatiquement
  les templates ; si Wellcome Trust n'est pas dans `donors.json`, le
  template est créé avec `donor_id=null` (seed tolérant).
- Le PDF n'embarque pas de logo IPD image — extension simple via
  `doc.image()` dans un sprint ultérieur.
- L'historique des `donor_report` reste accessible mais aucune `view`
  budget tracking dédiée par bailleur n'est exposée — le DAF peut faire
  `SUM` côté Excel à partir du 3ème onglet.

## 12. Prochaines étapes (Sprint 6.2+)

- **Multi-rapports** sur une même période (USAID vs OMS sur le même
  trimestre) — déjà supporté par la table mais pas d'UI.
- **Snapshot d'évolution** : comparer rapport N vs N-1 (variance YTD).
- **Signature électronique** PAdES sur le PDF.
- **Logo IPD embarqué** dans le PDF.
- **Templates personnalisables** via UI (constructeur drag-and-drop
  catégories).
- **Notification email** au DAF quand un rapport est généré.

---

_Dernière mise à jour : 2026-05-17 — Sprint 6.1 / El Hadj Amadou NIANG_

# Réception facture + OCR + Rapprochement 3-way — Sprint 4.2a

Ce document décrit le cycle de capture d'une facture fournisseur (upload PDF
+ OCR ou saisie manuelle) et son rapprochement automatique avec le BC et la
réception.

> **Hors-scope** : la comptabilisation n'est pas réalisée ici. Le passage en
> statut `matched` rendra simplement la facture prête pour le **Sprint 4.2b**
> qui produira les écritures classe 4/6 et extournera l'engagement classe 8.

## 1. Cycle de vie

```
   uploadAndCapture / createManual                submit                force-match (DAF)
              ▼                                     ▼                          ▼
   (Invoice) ─► captured ──(update PATCH)──► (matching 3-way)
                                                  │
                                                  ├─► matched
                                                  ├─► exception_price ──► matched (forcé)
                                                  └─► exception_qty   ──► matched (forcé)

                                                  reject ─► rejected (depuis n'importe quel statut sauf paid/archived)
```

Statuts de l'enum `ap.invoice_status` utilisés ici :

| Statut             | Description                                                         |
|--------------------|---------------------------------------------------------------------|
| `captured`         | Facture capturée (PDF OCR ou saisie manuelle), en attente de submit  |
| `exception_price`  | Au moins une ligne dépasse la tolérance prix                         |
| `exception_qty`    | Au moins une ligne dépasse la tolérance qty / sous-réception         |
| `matched`          | Rapprochement OK (toutes lignes dans la tolérance) ou forcé          |
| `rejected`         | Refus définitif (motif obligatoire)                                  |
| (`pending_validation`, `posted`, `paid`, `archived`) | Phases ultérieures (sprints 4.2b et au-delà) |

## 2. Capture OCR (niveau 1)

Le service `OcrService` utilise `pdf-parse` pour extraire le texte natif du
PDF. Si le PDF est une image scannée, le texte extrait est vide → `isImageScan: true`,
`confidence: 0`, le comptable saisit alors les champs manuellement via `PATCH`.

Heuristiques d'extraction (par priorité) :

| Champ           | Stratégie                                                                                  |
|-----------------|---------------------------------------------------------------------------------------------|
| `invoiceNumber` | "Facture n° X" / "Invoice Number: X" / direct `FAC-2026-001` / `INV2026-99`                |
| `invoiceDate`   | "Date facture : DD/MM/YYYY" ; sinon 1ʳᵉ date trouvée                                       |
| `dueDate`       | "Échéance / Due date" + date                                                               |
| `totalHt`       | "Total HT / Subtotal" + montant                                                            |
| `totalVat`      | "TVA / VAT" + montant ; sinon calculé = TTC − HT                                           |
| `totalTtc`      | "Total TTC / Net à payer / Grand Total" + montant                                          |
| `currency`      | ISO `XOF / EUR / USD / CFA→XOF` ou symboles `€` / `$`                                      |
| `poReference`   | `BC-2026-0001` / `PO2026-99` / "Bon de commande X"                                         |

Formats numériques tolérés : `100 000,00`, `100,000.00`, `100000.00`, `100000`.

**Confiance** : 0-100 par champ, moyenne pondérée globale. Si `confidence < 30`,
le front affiche une alerte (l'API ne bloque pas — c'est `OCR_LOW_CONFIDENCE`
informatif).

> **Niveau 2 (sprint F-OCR-VISION)** : provider OCR Claude Vision optionnel
> pour les PDF scannés / sans couche texte. Architecture multi-provider
> (`pdfparse` défaut | `vision` opt-in | `auto`) — voir
> [ocr.md](./ocr.md) pour la sélection via env, la stratégie de fallback
> et les règles de confidentialité.

## 3. Matching 3-way

Le `MatchingService` rapproche chaque ligne facture aux po_lines et au
cumul des GR `complete`.

**Tolérances paramétrables** (env vars) :

| Variable                                | Défaut | Description                       |
|-----------------------------------------|--------|-----------------------------------|
| `INVOICE_MATCH_PRICE_TOLERANCE_PCT`     | `2.0`  | Écart prix unitaire toléré (%)    |
| `INVOICE_MATCH_QTY_TOLERANCE_PCT`       | `5.0`  | Écart quantité toléré (%)         |

**Algorithme** (par ligne facture) :

1. **Trouver la po_line** : par `po_line_id` si renseigné, sinon fuzzy
   match sur la description (intersection de tokens ≥ 3 caractères).
2. **Calculer les écarts** :
   - `price_variance_pct = |price_invoiced − price_ordered| / price_ordered × 100`
   - `qty_variance_pct = |qty_invoiced − qty_received_cumul| / qty_received_cumul × 100`
3. **Classer le résultat** (priorité prix > qty) :
   - Prix hors tolérance → `EXCEPTION_PRICE`
   - Sous-réception (`qty_invoiced > qty_received`) → `EXCEPTION_QTY`
   - Qty hors tolérance → `EXCEPTION_QTY`
   - Sinon → `OK`
4. **Persister `ap.invoice_match`** (1 ligne par invoice_line) avec
   `qty_matched`, `price_variance`, `qty_variance`, `match_result`.

**Statut global** : `matched` si toutes les lignes sont `OK`, sinon
`exception_price` (si au moins une exception prix) ou `exception_qty`.
Le récap est persisté dans `ap.invoice.match_summary` (JSONB) :

```json
{
  "totalLinesMatched": 2,
  "totalLinesException": 1,
  "priceVarianceMax": 8.4,
  "qtyVarianceMax": 0,
  "priceTolerancePct": 2,
  "qtyTolerancePct": 5,
  "details": [...]
}
```

Le matching est **idempotent** : un re-run supprime d'abord les `invoice_match`
précédents, puis ré-insère.

## 4. Force-match (DAF / SUPER_ADMIN)

Cas exceptionnel : remise commerciale validée hors-contrat, écart de
stock acceptable après vérification physique, etc. Le DAF peut forcer le
statut `matched` malgré une exception.

Le motif (`reason ≥ 5 chars`) est **obligatoire** et tracé dans
`match_summary.forcedMatch` :

```json
{
  ...,
  "forcedMatch": {
    "forcedBy": "daf@pasteur.sn",
    "forcedAt": "2026-05-16T20:42:30.123Z",
    "reason": "remise commerciale -10% validée par mail du fournisseur",
    "previousStatus": "exception_price"
  }
}
```

L'`AuditLogInterceptor` capture l'événement avec le log warning `FORCED_MATCH`
dans le journal applicatif. Cet usage doit rester rare et **toujours**
documenté.

## 5. Endpoints

Tous protégés par JWT Bearer. Sous `/api/v1/`.

| Méthode | Path                                       | Rôles                              |
|---------|--------------------------------------------|------------------------------------|
| POST    | `/invoices/upload`                         | COMPTABLE, SUPER_ADMIN              |
| POST    | `/invoices`                                | COMPTABLE, SUPER_ADMIN              |
| GET     | `/invoices`                                | tous (RBAC scope)                   |
| GET     | `/invoices/:id`                            | tous (RBAC scope)                   |
| PATCH   | `/invoices/:id`                            | COMPTABLE, SUPER_ADMIN              |
| POST    | `/invoices/:id/submit`                     | COMPTABLE, SUPER_ADMIN              |
| POST    | `/invoices/:id/force-match`                | DAF, SUPER_ADMIN                    |
| POST    | `/invoices/:id/reject`                     | COMPTABLE, DAF, SUPER_ADMIN         |
| GET     | `/invoices/:id/match-details`              | tous (RBAC scope)                   |
| GET     | `/invoices/:id/pdf`                        | tous (RBAC scope)                   |
| GET     | `/purchase-orders/:poId/invoices`          | tous (RBAC scope)                   |

**RBAC scope** :
- COMPTABLE / TRESORIER / CONTROLEUR / DAF / BAILLEUR / SUPER_ADMIN → **tout**.
- ACHETEUR → factures de **ses BC** (via `po.buyer_id`).
- DEMANDEUR / PI → factures liées à **leurs DAs** (via `po.prLinks`).

## 6. Codes d'erreur (`BUSINESS.*`)

| Code                              | HTTP | Quand                                                           |
|-----------------------------------|------|------------------------------------------------------------------|
| `INVOICE_NOT_CAPTURABLE`          | 409  | Submit hors `captured` (ou force-match hors `exception_*`)      |
| `INVOICE_NOT_EDITABLE`            | 409  | PATCH d'une facture figée (matched / posted / paid / archived)  |
| `INVOICE_NO_PO_LINKED`            | 409  | Submit sans `poId`                                              |
| `INVOICE_DUPLICATE_NUMBER`        | 409  | Couple (supplierId, invoiceNumber) déjà présent                 |
| `OCR_EXTRACTION_FAILED`           | 500  | pdf-parse a planté (PDF corrompu)                               |
| `OCR_LOW_CONFIDENCE`              | n/a  | Informatif uniquement (alerte UI, non levée par l'API)          |
| `MATCHING_NO_RECEIPT`             | 409  | Aucun GR `complete` sur le PO référencé                         |
| `MATCHING_FORCE_REASON_REQUIRED`  | 400  | Force-match sans motif                                          |
| `INVOICE_NOT_REJECTABLE`          | 409  | Reject sur facture payée / archivée                             |

## 7. Exemples curl

Variables :
```bash
export TOKEN_SA="..."
export SUPPLIER_ID="..."
export PO_ID="..."
```

### Upload PDF facture

```bash
curl -X POST "http://localhost:4000/api/v1/invoices/upload" \
  -H "Authorization: Bearer $TOKEN_SA" \
  -F "file=@./facture-ACME-001.pdf" \
  -F "supplierId=$SUPPLIER_ID"
```

Réponse :
```json
{
  "invoiceId": "...",
  "invoiceNumber": "FAC-2026-0042",
  "status": "captured",
  "pdfObjectKey": "invoices/2026/05/abc.pdf",
  "ocr": {
    "confidence": 87,
    "isImageScan": false,
    "fields": {
      "invoiceNumber": "FAC-2026-0042",
      "totalHt": 100000, "totalVat": 18000, "totalTtc": 118000,
      "currency": "XOF", "poReference": "BC-2026-0017"
    }
  }
}
```

### Création manuelle

```bash
curl -X POST "http://localhost:4000/api/v1/invoices" \
  -H "Authorization: Bearer $TOKEN_SA" \
  -H "Content-Type: application/json" \
  -d '{
    "invoiceNumber": "FAC-MAN-001",
    "supplierId": "'$SUPPLIER_ID'",
    "invoiceDate": "2026-05-14",
    "dueDate": "2026-06-13",
    "currency": "XOF",
    "poId": "'$PO_ID'",
    "totalHt": 50000,
    "totalVat": 0,
    "totalTtc": 50000,
    "lines": [
      { "lineNumber": 1, "description": "Gants nitrile", "quantity": 10, "unitPrice": 5000, "lineTotal": 50000 }
    ]
  }'
```

### Soumettre au matching

```bash
curl -X POST "http://localhost:4000/api/v1/invoices/$INV_ID/submit" \
  -H "Authorization: Bearer $TOKEN_SA"
```

Réponse :
```json
{
  "invoice": { "status": "matched", "matchedAt": "...", ... },
  "outcome": {
    "newStatus": "matched",
    "summary": { "totalLinesMatched": 1, "totalLinesException": 0, ... }
  }
}
```

### Force-match (DAF)

```bash
curl -X POST "http://localhost:4000/api/v1/invoices/$INV_ID/force-match" \
  -H "Authorization: Bearer $TOKEN_DAF" \
  -H "Content-Type: application/json" \
  -d '{ "reason": "remise commerciale -10% validée par mail" }'
```

### Voir les détails du rapprochement

```bash
curl -X GET "http://localhost:4000/api/v1/invoices/$INV_ID/match-details" \
  -H "Authorization: Bearer $TOKEN_SA"
```

## 8. Effets sur l'audit log

Toute mutation est captée par l'`AuditLogInterceptor` (sprint 1.x) :
- `success` : `invoices.upload`, `invoices.create_manual`, `invoices.submit`,
  `invoices.force_match`, `invoices.reject`, `invoices.update`.
- `denied` : tentative d'un rôle non habilité (ex : DEMANDEUR sur `/upload`).
- `failed_validation` : toute `BusinessException` listée plus haut.

Le `FORCED_MATCH` apparaît dans le log applicatif (niveau warning) en
plus du `success` standard sur l'événement.

## 9. Prochaines étapes (Sprint 4.2b)

À l'invoice `matched` :
- Création d'une écriture comptable **classe 4/6** :
  - Crédit **401** (Fournisseurs) au TTC
  - Débit **6xx** (charge) au HT, ligne par budget_line
  - Débit **445x** (TVA déductible) au montant TVA
- **Extournement** de l'écriture d'engagement classe 8 (801/802) postée à
  l'émission du BC, pour la fraction facturée — cf. `accounting/posting.service.ts`.
- Statut invoice → `posted` puis `pending_validation` (workflow comptable).

---

_Dernière mise à jour : 2026-05-16 — Sprint 4.2a / El Hadj Amadou NIANG_

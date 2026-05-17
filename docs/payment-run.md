# PaymentRun + Paiements classe 5 — Sprint 5.1

Ce document décrit le module Treasury (sprint 5.1) qui automatise le
décaissement des factures `posted` : création d'un `PaymentRun` regroupant
des factures, contrôle IBAN, approbation DAF, et production d'écritures
comptables de banque (BQ — classe 5).

> **Hors-scope** : la génération du fichier SEPA `pain.001`, l'écart de
> change au règlement multidevises et le rapprochement bancaire (camt.054)
> arrivent au **Sprint 5.2**. Voir §11.

## 1. Modèle de données

### `ref.bank_account` (nouveau, sprint 5.1)
Référentiel des comptes bancaires IPD.

| Colonne            | Type        | Notes                                      |
|--------------------|-------------|--------------------------------------------|
| `code`             | TEXT UNIQUE | Ex: `CBAO-XOF`, `CBAO-EUR`                 |
| `label`            | TEXT        | Libellé affichable                         |
| `account_number`   | TEXT        | IBAN (validé mod 97) ou n° interne BCEAO   |
| `bic`              | TEXT?       | ISO 9362                                   |
| `bank_name`        | TEXT        | Ex: "CBAO Sénégal"                         |
| `currency`         | CHAR(3)     | XOF / EUR / USD                            |
| `gl_account`       | TEXT FK     | Doit être classe 5 (521, 522, 57)          |
| `is_active`        | BOOLEAN     | Soft delete                                |

Seeds : `CBAO-XOF` (521) et `CBAO-EUR` (522).

### `ap.payment_run` (étendu)
Colonnes ajoutées :
- `bank_account_id` FK → `ref.bank_account.id`
- `preparation_warnings` JSONB (warnings non bloquants — ex. cash sans IBAN)
- `rejection_reason` TEXT (motif si rejected / cancelled)
- `approved_at` / `executed_at` TIMESTAMPTZ

### `ap.payment` (inchangé, index ajouté sur `status`)

## 2. Cycle de vie d'un `PaymentRun`

```
              ┌──────────────┐  add/remove invoices, cancel
              │    draft     │ ──────────────────────────┐
              └──────┬───────┘                            │
                     │ prepare                            │ cancel(reason)
                     ▼                                    ▼
              ┌──────────────┐   reject(reason)    ┌──────────────┐
   ┌──────────│   prepared   │───────────────────► │  rejected /  │
   │ approve  └──────────────┘                     │  cancelled   │
   │ (DAF)                                         └──────────────┘
   ▼
┌──────────────┐
│   executed   │  ← BQ entries posted + invoices → paid / partially_paid
└──────────────┘
```

| Transition       | Acteur                            | Effet                                       |
|------------------|-----------------------------------|---------------------------------------------|
| → `draft`        | TRESORIER / DAF / SUPER_ADMIN     | Crée le run + 1 payment par facture         |
| `addInvoices`    | idem                              | Ajoute des paiements (status `queued`)      |
| `removeInvoices` | idem                              | Supprime des paiements + recalcule total    |
| `prepare`        | idem                              | Valide IBAN format, passe payments→prepared |
| `approve`        | **DAF / SUPER_ADMIN**             | Crée écritures BQ + factures→paid           |
| `reject`         | **DAF / SUPER_ADMIN**             | prepared→rejected, paiements→cancelled      |
| `cancel`         | TRESORIER / DAF / SUPER_ADMIN     | draft→cancelled (aucune écriture)           |

## 3. Schéma d'écriture BQ (classe 5)

À chaque `approve` d'un `PaymentRun`, pour **chaque paiement** un appel
`PostingService.postPayment` crée :

```
Débit  401 (Fournisseurs)         payment.amount  + auxiliary_code = supplier.code
Crédit bankAccount.gl_account     payment.amount   (ex: 521)
```

- Journal : `BQ`, label `Paiement <supplier.code> - <invoice.number>`
- `source_type='payment'`, `source_id=payment.id` — `GET
  /payment-runs/:id/journal-entries` retrouve toutes les écritures.
- Équilibre `Σdebit = Σcredit` validé par le trigger `gl.check_entry_balance`.
- Période fiscale = celle qui couvre `payment.payment_date`
  (priorité month > quarter > year, cf. PostingService).

## 4. Détermination du compte de banque (5xx)

Le compte 5xx est résolu via **`bankAccount.gl_account`** — fixé à la
création du bank account et validé en classe 5. Pas de fallback : si le
compte GL est de la mauvaise classe ou désactivé, l'API lève
`BUSINESS.BANK_ACCOUNT_WRONG_CLASS` à la création du bank account.

## 5. Cycle de vie d'une facture

```
posted ─approve(full)──► paid
   │
   └─approve(partial)──► partially_paid ─approve(remaining)──► paid
```

La transition est calculée à `approve` à partir du cumul
`SUM(payment.amount WHERE status='executed') vs invoice.total_ttc` :
- ≥ 99% du total (à 0,01 près) → `paid`
- sinon → `partially_paid`

## 6. Validation IBAN au `prepare`

Pour chaque paiement du run, le service vérifie :

- Si `method ∈ {sepa, swift, direct_debit}` :
  * IBAN du fournisseur requis (sinon `MISSING_IBAN`)
  * IBAN doit passer le checksum ISO 13616 (sinon `MISSING_IBAN`)
- Si `method ∈ {cash, check}` :
  * IBAN non requis ; absent → ajouté à `preparation_warnings[]`

Le payload `MISSING_IBAN` contient `details.suppliers[]` avec les
fournisseurs en défaut pour permettre une correction ciblée.

## 7. Multidevises (XOF seulement au sprint 5.1)

Au sprint 5.1, on **refuse** tout paiement en devise différente de XOF :
- À `createRun` : si une facture a une `currency ≠ bankAccount.currency`,
  réponse `409 PAYMENT_CURRENCY_MISMATCH`.
- Même check côté `postPayment` (défense en profondeur).

Le sprint 5.2 ajoutera :
- Conversion via `ref.exchange_rate`
- Capture de l'écart de change au règlement (`66 perte` / `76 gain`)
- Stockage `payment.fx_gain_loss`

## 8. Endpoints

Tous sous `/api/v1/`, protégés JWT Bearer.

### Bank accounts (référentiel)
| Méthode | Path                              | Rôles                              |
|---------|-----------------------------------|------------------------------------|
| GET     | `/bank-accounts`                  | auth                               |
| GET     | `/bank-accounts/:id`              | auth                               |
| POST    | `/bank-accounts`                  | TRESORIER, DAF, SUPER_ADMIN        |
| PATCH   | `/bank-accounts/:id`              | TRESORIER, DAF, SUPER_ADMIN        |
| DELETE  | `/bank-accounts/:id`              | DAF, SUPER_ADMIN                   |
| POST    | `/bank-accounts/:id/restore`      | DAF, SUPER_ADMIN                   |

### Payment runs
| Méthode | Path                                   | Rôles                              |
|---------|----------------------------------------|------------------------------------|
| GET     | `/payment-runs`                        | auth                               |
| GET     | `/payment-runs/:id`                    | auth                               |
| GET     | `/payment-runs/:id/payments`           | auth                               |
| GET     | `/payment-runs/:id/journal-entries`    | auth                               |
| POST    | `/payment-runs`                        | TRESORIER, DAF, SUPER_ADMIN        |
| POST    | `/payment-runs/:id/invoices`           | TRESORIER, DAF, SUPER_ADMIN        |
| DELETE  | `/payment-runs/:id/invoices`           | TRESORIER, DAF, SUPER_ADMIN        |
| POST    | `/payment-runs/:id/prepare`            | TRESORIER, DAF, SUPER_ADMIN        |
| POST    | `/payment-runs/:id/approve`            | **DAF, SUPER_ADMIN**               |
| POST    | `/payment-runs/:id/reject`             | **DAF, SUPER_ADMIN**               |
| POST    | `/payment-runs/:id/cancel`             | TRESORIER, DAF, SUPER_ADMIN        |

### Payments
| Méthode | Path                                   | Rôles    |
|---------|----------------------------------------|----------|
| GET     | `/payments/:id`                        | auth     |
| GET     | `/invoices/:invoiceId/payments`        | auth     |

## 9. Codes d'erreur (`BUSINESS.*`)

| Code                                | HTTP | Quand                                                          |
|-------------------------------------|------|-----------------------------------------------------------------|
| `INVOICE_NOT_PAYABLE`               | 409  | Facture pas en posted / partially_paid                          |
| `INVOICE_ALREADY_IN_RUN`            | 409  | Facture déjà liée à un run actif                                |
| `PAYMENT_CURRENCY_MISMATCH`         | 409  | Devise facture ≠ devise bank account                            |
| `PAYMENT_RUN_NOT_EDITABLE`          | 409  | add/remove sur run pas en draft                                 |
| `PAYMENT_RUN_NOT_PREPARABLE`        | 409  | prepare sur run pas en draft                                    |
| `PAYMENT_RUN_NOT_APPROVABLE`        | 409  | approve sur run pas en prepared                                 |
| `PAYMENT_RUN_NOT_REJECTABLE`        | 409  | reject sur run pas en prepared                                  |
| `PAYMENT_RUN_NOT_CANCELLABLE`       | 409  | cancel sur run pas en draft                                     |
| `PAYMENT_RUN_EMPTY`                 | 409  | prepare/approve sur run sans paiements                          |
| `PAYMENT_RUN_REJECT_REASON_REQUIRED`| 400  | reject sans motif (min 5 chars)                                 |
| `PAYMENT_RUN_CANCEL_REASON_REQUIRED`| 400  | cancel sans motif                                               |
| `MISSING_IBAN`                      | 409  | prepare avec IBAN absent ou invalide (méthodes électroniques)   |
| `BANK_ACCOUNT_NOT_FOUND`            | 404  | bankAccountId inconnu                                           |
| `BANK_ACCOUNT_WRONG_CLASS`          | 409  | gl_account du bank account pas en classe 5                      |
| `BANK_ACCOUNT_INACTIVE`             | 409  | bank account soft-deleted                                       |

## 10. Exemples curl

Variables :
```bash
export TOKEN_TRES="..."
export TOKEN_DAF="..."
export TOKEN_SA="..."
export BA_ID="..."   # GET /api/v1/bank-accounts → CBAO-XOF
export INV_IDS='["...","..."]'
```

### Créer un compte bancaire
```bash
curl -X POST "http://localhost:4000/api/v1/bank-accounts" \
  -H "Authorization: Bearer $TOKEN_TRES" \
  -H "Content-Type: application/json" \
  -d '{
    "code": "CBAO-XOF-2",
    "label": "Compte CBAO Secondaire",
    "accountNumber": "SN012010100000999999999999",
    "bankName": "CBAO Sénégal",
    "currency": "XOF",
    "glAccountCode": "521"
  }'
```

### Créer un PaymentRun
```bash
curl -X POST "http://localhost:4000/api/v1/payment-runs" \
  -H "Authorization: Bearer $TOKEN_TRES" \
  -H "Content-Type: application/json" \
  -d "{
    \"bankAccountId\": \"$BA_ID\",
    \"method\": \"sepa\",
    \"invoiceIds\": $INV_IDS
  }"
```

Réponse :
```json
{
  "id": "...",
  "runNumber": "PAY-2026-0001",
  "status": "draft",
  "currency": "XOF",
  "totalAmount": "118000.00",
  "payments": [
    { "id": "...", "invoiceId": "...", "amount": "118000.00", "status": "queued" }
  ]
}
```

### Préparer puis approuver
```bash
curl -X POST "http://localhost:4000/api/v1/payment-runs/$RUN_ID/prepare" \
  -H "Authorization: Bearer $TOKEN_TRES"

curl -X POST "http://localhost:4000/api/v1/payment-runs/$RUN_ID/approve" \
  -H "Authorization: Bearer $TOKEN_DAF" \
  -H "Content-Type: application/json" \
  -d '{ "comment": "Validation mensuelle" }'
```

### Voir les écritures BQ produites
```bash
curl -X GET "http://localhost:4000/api/v1/payment-runs/$RUN_ID/journal-entries" \
  -H "Authorization: Bearer $TOKEN_TRES"
```

### Rejeter un run (DAF)
```bash
curl -X POST "http://localhost:4000/api/v1/payment-runs/$RUN_ID/reject" \
  -H "Authorization: Bearer $TOKEN_DAF" \
  -H "Content-Type: application/json" \
  -d '{ "reason": "fichier rejeté par la banque pour anomalie BIC" }'
```

## 11. Prochaines étapes (Sprint 5.2)

- **Génération SEPA pain.001** : sérialisation XML ISO 20022 du run
  prepared, stockage MinIO, hash SHA-256 dans `payment_run.sepa_file_key`.
- **Multidevises** :
  * Conversion `payment.amount` en XOF via `ref.exchange_rate`
  * Capture de l'**écart de change** au règlement (`66/76`)
  * Stockage `payment.fx_gain_loss` (signé)
- **Rapprochement bancaire** : import camt.054, match auto par `bankReference`.
- **Workflow de retry** sur échec banque (`failed` → re-prepare).
- **`PaymentRunForecast`** : projection des décaissements à venir
  (date d'échéance → semaine de paiement).

---

_Dernière mise à jour : 2026-05-16 — Sprint 5.1 / El Hadj Amadou NIANG_

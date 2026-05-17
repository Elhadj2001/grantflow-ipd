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

## 7. Multidevises et écart de change (sprint 5.2)

À `createRun`, si une facture est dans une devise ≠ `bankAccount.currency`,
le service convertit automatiquement :

1. Lookup d'un taux dans `ref.exchange_rate` pour la paire `(invoice.currency
   → bankAccount.currency)` à `paymentDate` (ou plus récent ≤). Sinon →
   `409 EXCHANGE_RATE_FOR_PAYMENT_MISSING` (le contrôleur de gestion doit
   charger un taux BCEAO).
2. Persistance sur le paiement :
   - `payment.amount` = montant en devise du run (ce qui sortira de la banque)
   - `payment.original_amount` = montant en devise facture
   - `payment.original_currency` = devise facture
   - `payment.exchange_rate` = taux appliqué

À `approve` → `postPayment`, l'écart de change est capté dans l'écriture BQ :

```
D 401 (Fournisseur)   = original_amount × invoice.exchangeRate   (taux historique)
C bank (5xx)          = payment.amount                            (cash réel sorti)
+ si écart > 0 (gain) : C 766 (Gains de change)   = abs(écart)
+ si écart < 0 (perte): D 666 (Pertes de change)  = abs(écart)
```

L'écriture reste équilibrée (`Σdebit = Σcredit`) grâce à la ligne 666/766.

**Exemple — facture 100 EUR posted @ 655 XOF/EUR**, paiement aujourd'hui
@ 660 XOF/EUR :
- 401 débit = 65 500 XOF (au taux historique, solde le 401 crédité au post)
- 521 crédit = 66 000 XOF (cash réel sorti)
- 666 débit = 500 XOF (perte de change — XOF a dévalué)
- `payment.fx_gain_loss = -500` persisté

**Sanity check** : si `|fx_diff| > 10% × originalAmount × invoiceRate`
→ `409 FX_DIFF_TOO_LARGE` (probable erreur de saisie de taux). Seuil
configurable via `ACCOUNT_FX_DIFF_SAFETY_THRESHOLD_PCT`.

**Contrainte sprint 5.2** : on suppose `bankAccount.currency = devise des
livres = XOF`. Pour les comptes bancaires en devises (CBAO-EUR), la
conversion bank→XOF se fera au sprint 6+ (refonte du moteur de
multidevises avec 3-way conversion).

## 7bis. Génération SEPA pain.001.001.03 (sprint 5.2)

À `POST /payment-runs/:id/generate-sepa` (TRESORIER/DAF/SUPER_ADMIN), le
service `SepaService` :

1. Charge le run + payments + suppliers + bankAccount
2. Construit un XML conforme **ISO 20022 Customer Credit Transfer
   Initiation v3 (`pain.001.001.03`)** avec :
   - `<GrpHdr>` : MsgId = run_number, CreDtTm ISO 8601, NbOfTxs, CtrlSum
   - `<PmtInf>` : 1 batch, PmtMtd=TRF, BtchBookg=true, Dbtr=IPD, DbtrAcct
     (IBAN bank), DbtrAgt (BIC), `<PmtTpInf><SvcLvl><Cd>SEPA</Cd>`
   - `<CdtTrfTxInf>` × N : EndToEndId = invoice_number, InstdAmt (avec
     attribut `Ccy`), Cdtr (supplier name), CdtrAcct (IBAN), CdtrAgt
     (BIC supplier si présent), RmtInf > Ustrd (référence facture)
3. Stocke le fichier dans MinIO bucket `grantflow-sepa`, clé
   `sepa/YYYY/MM/{runNumber}-{uuid8}.xml`
4. Persiste `payment_run.sepa_file_key`

`GET /payment-runs/:id/sepa` stream le fichier XML
(content-type=application/xml).

Pré-conditions : run en `prepared` ou `executed`, bankAccount renseigné,
au moins 1 payment en `prepared`/`executed`. Idempotent : chaque appel
produit un nouveau fichier avec UUID frais.

## 7ter. Anti-fraude IBAN (sprint 5.2)

À chaque modification d'un fournisseur (`PATCH /suppliers/:id` ou `PUT`),
le `SupplierService` enregistre l'IBAN courant dans
`ref.supplier_iban_history` (clôture la ligne précédente avec `effective_to=now()`,
insère la nouvelle ligne courante).

À `prepare`, `IbanFraudService.checkPaymentRun` compare pour chaque
payment l'IBAN courant et le précédent. Une alerte est levée si le
changement remonte à moins de **90 jours** :

```json
{
  "supplierId": "...",
  "supplierCode": "ACME",
  "currentIban": "FR...NEW",
  "previousIban": "FR...OLD",
  "changedAt": "2026-05-15T10:00:00Z",
  "daysSinceChange": 2,
  "changedBy": "user-id",
  "changeReason": "PATCH"
}
```

Les alertes sont persistées dans `payment_run.iban_alerts` (JSONB). À
`approve`, le DAF doit explicitement les acquitter :

```json
POST /payment-runs/:id/approve
{
  "acknowledgeIbanAlerts": true,
  "acknowledgeReason": "Vérifié avec le fournisseur par téléphone le 17/05"
}
```

- Sans `acknowledgeIbanAlerts=true` → `409 IBAN_ALERTS_NOT_ACKNOWLEDGED`
- Sans `acknowledgeReason` (min 5 chars) → `400 PAYMENT_RUN_REJECT_REASON_REQUIRED`
- L'événement est tracé dans le log applicatif avec
  `event=ACKNOWLEDGED_IBAN_ALERT` pour audit ultérieur.

`GET /payment-runs/:id/iban-alerts` retourne les alertes courantes du run.

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
| GET     | `/payment-runs/:id/iban-alerts`        | auth (sprint 5.2)                  |
| POST    | `/payment-runs/:id/generate-sepa`      | TRESORIER, DAF, SUPER_ADMIN (5.2)  |
| GET     | `/payment-runs/:id/sepa`               | TRESORIER, DAF, SUPER_ADMIN (5.2)  |

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
| `SEPA_GENERATION_FAILED`            | 500  | Erreur technique XML/MinIO lors du generate-sepa                |
| `SEPA_NOT_GENERATED`                | 404  | Download SEPA avant generate                                    |
| `SEPA_RUN_NOT_READY`                | 409  | generate-sepa appelé sur run pas en prepared/executed           |
| `IBAN_ALERTS_NOT_ACKNOWLEDGED`      | 409  | approve sans acknowledgeIbanAlerts=true alors qu'alertes        |
| `EXCHANGE_RATE_FOR_PAYMENT_MISSING` | 409  | Pas de taux dispo invoice.currency → bank.currency à paymentDate|
| `FX_DIFF_TOO_LARGE`                 | 409  | Écart de change > 10% (sanity check, probable erreur de taux)   |

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

## 11. Exemples curl — sprint 5.2

### Generer le fichier SEPA

```bash
curl -X POST "http://localhost:4000/api/v1/payment-runs/$RUN_ID/generate-sepa" \
  -H "Authorization: Bearer $TOKEN_TRES"
```
Réponse :
```json
{
  "sepaFileKey": "sepa/2026/05/PAY-2026-0001-a1b2c3d4.xml",
  "xmlSummary": "<?xml version=\"1.0\"...",
  "nbOfTxs": 2,
  "ctrlSum": 75000
}
```

### Télécharger le fichier SEPA

```bash
curl -X GET "http://localhost:4000/api/v1/payment-runs/$RUN_ID/sepa" \
  -H "Authorization: Bearer $TOKEN_TRES" \
  -o PAY-2026-0001.xml
```

### Lister les alertes IBAN d'un run

```bash
curl -X GET "http://localhost:4000/api/v1/payment-runs/$RUN_ID/iban-alerts" \
  -H "Authorization: Bearer $TOKEN_DAF"
```

### Approuver malgré alertes IBAN

```bash
curl -X POST "http://localhost:4000/api/v1/payment-runs/$RUN_ID/approve" \
  -H "Authorization: Bearer $TOKEN_DAF" \
  -H "Content-Type: application/json" \
  -d '{
    "acknowledgeIbanAlerts": true,
    "acknowledgeReason": "Vérifié avec le fournisseur par téléphone le 17/05"
  }'
```

## 12. Prochaines étapes (Sprint 6+)

- **Rapprochement bancaire** : import camt.054, match auto sur
  `bankReference`, statut payment `executed → reconciled`.
- **Workflow de retry** sur échec banque (`failed → re-prepare`).
- **Multidevises 3-way** : compte bancaire EUR (CBAO-EUR/522) — conversion
  bank.currency → books_currency (XOF) en plus de invoice→bank.
- **`PaymentRunForecast`** : projection des décaissements à venir
  (date d'échéance → semaine de paiement, prévision trésorerie).
- **Hash SHA-256 du fichier SEPA** stocké dans `payment_run` pour
  détection altération.
- **Signature électronique** du fichier SEPA (cas banques européennes
  qui exigent un PKCS7).

---

_Dernière mise à jour : 2026-05-17 — Sprint 5.2 / El Hadj Amadou NIANG_

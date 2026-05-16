# Comptabilisation facture + Extournement classe 8 — Sprint 4.2b

Ce document décrit la comptabilisation d'une facture `matched` :
production d'une écriture **AC (Achats)** classe 4/6/445 et extournement
**partiel** de l'engagement classe 8 (801/802) produit au Sprint 3 lors de
l'émission du BC.

> **Hors-scope** : le paiement (écritures classe 5, gestion d'écart de change
> au règlement, génération SEPA) arrive au **Sprint 5**.

## 1. Schéma d'écriture (AC)

À chaque `POST /invoices/:id/post`, le `PostingService.postInvoice` génère
**une seule écriture AC équilibrée** :

```
Débit  6xx (charge)      HT par ligne         + imputation analytique  (héritée PR)
Débit  445 (TVA déduct.) total VAT            (sans imputation analytique, convention SYSCEBNL)
Crédit 401 (Fournisseurs) total TTC           + auxiliary_code = supplier.code
                          (cumul de tous les débits)
```

- Le journal est `AC`, le label `Facture <supplier.code> <invoice.number>`.
- `source_type = 'invoice'`, `source_id = invoice.id` — permet `GET
  /invoices/:id/journal-entries` de retrouver l'écriture.
- L'équilibre `Σdebit = Σcredit` est validé par le trigger
  `gl.check_entry_balance` à la transition `posted`.
- La période fiscale est celle qui couvre `invoice.invoice_date` (priorité
  month > quarter > year, cf. PostingService du Sprint 3).

## 2. Détermination du compte de charge (6xx)

Pour chaque `invoice_line`, le compte est résolu **dans cet ordre** :

1. `invoice_line.gl_account` si défini explicitement (saisie comptable
   spécifique, ex. dotation aux amortissements forcée).
2. `purchase_order_line.budget_line.default_account` si la ligne budgétaire
   a un compte par défaut (cas typique : "L01 Consommables labo → 601").
3. Fallback : **`605` Autres achats**.

Si même le fallback `605` n'existe pas dans `ref.gl_account`, l'API lève
`BUSINESS.GL_ACCOUNT_NOT_FOUND` avec `details.lines` détaillant chaque
ligne en défaut.

## 3. Imputation analytique

Les lignes 6xx portent :

- `project_id`, `grant_id` — issus de la PR liée au BC
- `budget_line_id` — issu de la PR (1ʳᵉ ligne pour l'instant)
- `cost_center_id`, `activity_id` — issus de la PR

Les lignes `445` (TVA) et `401` (Fournisseurs) **n'ont pas d'imputation
analytique** : la TVA et le tiers sont conventionnellement non analytiques
en SYSCEBNL.

## 4. Extournement de l'engagement classe 8

Au moment du `send` du BC (Sprint 3), une écriture OD a été produite :

```
Débit  801 (Engagement donné)        po.totalHt
Crédit 802 (Contre-engagement)       po.totalHt
```

À chaque `post` de facture sur ce BC, **une nouvelle OD d'extournement** est
créée au montant `invoice.totalHt` :

```
Crédit 801 (Extourne engagement)      invoice.totalHt
Débit  802 (Extourne contre-engagement) invoice.totalHt
```

**Cumul partiel** : si le BC fait 100 000 et que 2 factures de 60 000 et
40 000 sont postées séparément, on aura 2 OD d'extournement.
Quand la **fraction cumulée** des extournements atteint **≥ 99,9%** du
`po.totalHt`, l'écriture d'engagement d'origine est marquée `reversed` et
chaînée via `reversedById` au dernier extournement — la classe 8 est
soldée.

La liste des extournements est tracée dans `invoice.match_summary.commitmentReversedEntries[]`
(JSONB) pour permettre une annulation propre.

## 5. Multidevises

Si `invoice.currency ≠ 'XOF'` :

1. Le service cherche dans `ref.exchange_rate` un taux pour le couple
   `(invoice.currency, 'XOF')` à une date ≤ `invoice.invoice_date`
   (le plus récent — typiquement BCEAO journalier).
2. Si **aucun taux** n'est disponible → `BUSINESS.EXCHANGE_RATE_MISSING`.
   Le contrôleur de gestion doit alors charger un taux via
   `POST /api/v1/exchange-rates` avant de relancer.
3. Sur chaque `journal_line` :
   - `debit` / `credit` = montant **converti en XOF** (devise de tenue
     des livres)
   - `debit_currency` / `credit_currency` = montant **original en devise**
     (audit + reporting bailleur)
   - `currency` = devise originale (ex: `'EUR'`)
4. `invoice.exchange_rate` est persisté pour réutilisation au paiement.

> **Écart de change** : la différence entre le taux à la comptabilisation
> et le taux au paiement effectif sera capturée au Sprint 5 (écriture
> classe 76/66 — pertes/gains de change).

## 6. Annulation de comptabilisation

L'endpoint `POST /invoices/:id/cancel-posting` (réservé **DAF / SUPER_ADMIN**)
permet de revenir en `matched`. Pré-conditions :

- `invoice.status = 'posted'`
- Pas de paiement émis (status ∉ `partially_paid`, `paid`, `archived`)
- Période fiscale toujours ouverte
- Motif obligatoire (`reason ≥ 5 chars`) — tracé dans le log applicatif
  et dans `match_summary.postingCancelled`

Effets :
1. Création d'une **AC inverse symétrique** (`debit ↔ credit` ligne par ligne) ;
   l'AC d'origine est marquée `reversed` et chaînée via `reversedById`.
2. **Re-création de l'engagement classe 8** : par inversion de l'OD
   d'extournement la plus récente — le re-engagement est tracé en OD
   source `purchase_order`, label `"Re-engagement BC..."`.
3. `invoice.status = 'matched'`, `postedAt = null`, `match_summary.postingCancelled`
   trace `cancelledBy`, `cancelledAt`, `reason`, et les numéros des
   écritures produites.

## 7. Endpoints

Tous protégés par JWT Bearer. Sous `/api/v1/`.

| Méthode | Path                              | Rôles                              |
|---------|-----------------------------------|------------------------------------|
| POST    | `/invoices/:id/post`              | COMPTABLE, DAF, SUPER_ADMIN         |
| POST    | `/invoices/:id/cancel-posting`    | DAF, SUPER_ADMIN                    |
| GET     | `/invoices/:id/journal-entries`   | auth (RBAC scope hérité de invoice) |

## 8. Codes d'erreur (`BUSINESS.*`)

| Code                              | HTTP | Quand                                                           |
|-----------------------------------|------|------------------------------------------------------------------|
| `INVOICE_NOT_POSTABLE`            | 409  | Post hors `matched` (captured / exception_* / rejected)         |
| `INVOICE_ALREADY_POSTED`          | 409  | Double-post idempotence                                         |
| `PERIOD_CLOSED`                   | 409  | Période fiscale fermée                                          |
| `NO_OPEN_FISCAL_PERIOD`           | 409  | Aucune période ne couvre `invoice_date`                         |
| `EXCHANGE_RATE_MISSING`           | 409  | Facture multidevise sans taux                                   |
| `GL_ACCOUNT_NOT_FOUND`            | 409  | Aucun compte 6xx résolvable (avec `details.lines`)              |
| `POSTING_HAS_PAYMENT`             | 409  | cancel-posting bloqué si paiement émis                          |
| `POSTING_CANCEL_REASON_REQUIRED`  | 400  | cancel-posting sans motif                                       |

## 9. Exemples curl

Variables :
```bash
export TOKEN_SA="..."
export TOKEN_DAF="..."
export INV_ID="..."
```

### Comptabiliser

```bash
curl -X POST "http://localhost:4000/api/v1/invoices/$INV_ID/post" \
  -H "Authorization: Bearer $TOKEN_SA"
```

Réponse :
```json
{
  "invoice": { "status": "posted", "postedAt": "2026-05-16T22:30:00Z", ... },
  "acEntryId": "...",
  "acEntryNumber": "AC-2026-0042",
  "reversalEntryId": "...",
  "reversalEntryNumber": "OD-2026-0099",
  "exchangeRate": 1,
  "totalTtcXof": 118000
}
```

### Voir les écritures de la facture

```bash
curl -X GET "http://localhost:4000/api/v1/invoices/$INV_ID/journal-entries" \
  -H "Authorization: Bearer $TOKEN_SA"
```

Réponse :
```json
{
  "acEntries": [ { "entryNumber": "AC-2026-0042", "lines": [...] } ],
  "class8Reversals": [ { "entryNumber": "OD-2026-0099", "lines": [...] } ]
}
```

### Annuler une comptabilisation (DAF)

```bash
curl -X POST "http://localhost:4000/api/v1/invoices/$INV_ID/cancel-posting" \
  -H "Authorization: Bearer $TOKEN_DAF" \
  -H "Content-Type: application/json" \
  -d '{ "reason": "erreur de saisie comptable détectée en revue mensuelle" }'
```

## 10. Effets sur l'audit log

L'`AuditLogInterceptor` capture toutes les mutations :
- `success` : `invoices.post`, `invoices.cancel-posting`
- `denied` : tentative d'un rôle non habilité (ex : DEMANDEUR sur `/post`)
- `failed_validation` : toute `BusinessException` listée plus haut

Le `cancel-posting` apparaît avec un log warning `POSTING_CANCELLED` en plus
de l'événement `success`.

## 11. Prochaines étapes (Sprint 5 — Paiement)

- Génération d'un **PaymentRun** regroupant les factures `posted` à payer
- Écritures classe 5 : `Débit 401 / Crédit 5xx (Banque)` au TTC
- **Écart de change** au règlement : `66/76` selon le sens
- Génération du fichier **SEPA** (`pain.001`) pour transmission bancaire
- Statut facture : `posted → partially_paid → paid → archived`

---

_Dernière mise à jour : 2026-05-16 — Sprint 4.2b / El Hadj Amadou NIANG_

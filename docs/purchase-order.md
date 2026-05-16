# Bon de Commande (Purchase Order) — Sprint 3

## 1. Cycle de vie

```
   create                    send                       acknowledge
DA approuvée ─────► draft ─────────► sent ─────────────► acknowledged
                       │                │                       │
                       │ cancel         │ cancel (extourne 8)   │ cancel (extourne 8)
                       ▼                ▼                       ▼
                  cancelled        cancelled                cancelled
                                       │
                                       └─► (sprint 4) partially_received → received → invoiced → closed
```

- **draft** : BC créé, modifiable (`PATCH`). Le fournisseur n'est pas
  encore notifié, aucune écriture comptable. Annulation sans extourne.
- **sent** : le PDF est généré, stocké dans MinIO, l'écriture comptable
  d'engagement classe 8 est postée (801 debit / 802 credit), l'email
  est parti chez le fournisseur. Annulation → extourne.
- **acknowledged** : le fournisseur a confirmé. `acknowledged_at` et
  `acknowledged_by` (référence externe) sont remplis. Annulation → extourne.
- **partially_received / received / invoiced / closed** : *sprint 4+*
  (réception GR + facture + matching 3-way).
- **cancelled** : terminal. `cancellation_reason` ≥ 5 chars obligatoire.

## 2. Règles d'or appliquées

### 2.1 Une DA approved ↔ N BC actifs : interdit

À tout instant, une DA `approved` ne peut être rattachée qu'à **un seul**
BC dont le statut n'est pas dans `{cancelled, closed}`. Tentative de
créer un 2ᵉ BC sur la même DA → **409 `BUSINESS.PR_ALREADY_HAS_PO`**.
On encourage l'annulation explicite du 1ᵉʳ avant d'en émettre un autre.

### 2.2 N DA → 1 BC : consolidation autorisée

`POST /from-prs` accepte plusieurs DAs. Conditions cumulatives :
- toutes en statut `approved`
- aucune de type `petty_cash`
- même devise (sinon **409 `BUSINESS.PO_CURRENCY_MISMATCH`**)
- même fournisseur cible (vérifié implicitement : 1 seul `supplierId` dans le body)

Les lignes sont consolidées par signature
`(budgetLineId, description normalisée, unitPrice)` : si deux DAs
demandent "Gants L" sur la même budget line au même prix unitaire, on
fusionne les quantités. Sinon les lignes restent séparées (renumérotées).

### 2.3 petty_cash : pas de BC

Une DA `petty_cash` est payée directement en caisse à l'approbation
(cf. sprint 2.3). Tentative de créer un BC dessus → **409
`BUSINESS.PR_TYPE_PETTY_CASH_NO_PO`**.

Les DAs `cash_advance` peuvent théoriquement donner lieu à un BC (rare :
avance utilisée pour un achat à crédit régularisé ensuite). On l'autorise
sans alerte spécifique.

### 2.4 Comptabilité d'engagement classe 8

Au passage à `sent`, **une écriture comptable est créée
systématiquement** dans le journal `OD` (Opérations Diverses) :

| Compte | Libellé                        | Débit         | Crédit        |
|--------|--------------------------------|---------------|---------------|
| 801    | Engagements donnés (BC)        | `po.totalHt`  | 0             |
| 802    | Contre-engagement BC en cours  | 0             | `po.totalHt`  |

L'écriture est :
- équilibrée (`∑debit = ∑credit`) — le trigger `gl.check_entry_balance`
  vérifie ça automatiquement quand le status passe à `posted`
- imputée analytiquement (project, grant, budget line, cost center,
  activity) recopiés de la 1ʳᵉ DA liée — traçabilité directe BC ↔ projet
- numérotée `OD-YYYY-NNNN` séquentielle (verrou advisory par année)
- liée au BC via `source_type='purchase_order'` + `source_id = po.id`

À l'annulation d'un BC `sent` ou `acknowledged`, une **écriture inverse**
est créée (801 credit / 802 debit) pour solder. L'original est marqué
`reversed`, chaîné via `reversed_by_id`.

Référence SYSCEBNL : les comptes classe 8 sont des comptes spéciaux,
hors bilan (pas de présence au bilan synthétique mais traçabilité
exigée par l'auditeur sur les engagements en cours).

### 2.5 PDF + email : pipeline best-effort

L'ordre des étapes au `send` :
1. Génération PDF (pdfkit, en mémoire)
2. Upload MinIO bucket `grantflow-pos` (clé `pos/YYYY/MM/{po-id}.pdf`)
3. Écriture comptable classe 8 (transaction Prisma, atomique)
4. Envoi email via nodemailer (SMTP → MailHog en dev, Postfix en prod)
5. Persistance du `pdfObjectKey`, `sentAt`, `emailSentAt`, `emailSentTo`

Si l'email échoue, le BC passe quand même en `sent` (PDF + écriture sont
des sources de vérité, l'email est secondaire). On stocke `emailSentAt
= NULL`. Retry possible via **`POST /:id/resend`** (réutilise le PDF
stocké, ne recrée pas d'écriture).

### 2.6 Ownership-scoped read

- **ACHETEUR, CONTROLEUR, DAF, COMPTABLE, TRESORIER, BAILLEUR,
  SUPER_ADMIN** : voient tous les BCs.
- **DEMANDEUR, PI** : ne voient que les BCs liés à leurs DAs (via
  `purchase_order_pr.pr.requested_by = self`).
- Accès non autorisé → 404 (obscurité OWASP).

## 3. Endpoints

Tous sous `/api/v1/purchase-orders`.

| Verbe   | Route                       | Rôles                                                | Effet |
|---------|-----------------------------|-----------------------------------------------------|---|
| `POST`  | `/from-pr/:prId`            | ACHETEUR/CONTROLEUR/DAF/SUPER_ADMIN                  | Crée un BC depuis 1 DA |
| `POST`  | `/from-prs`                 | idem                                                 | Consolide N DAs en 1 BC |
| `GET`   | `/`                         | auth (scope ownership)                               | Liste paginée |
| `GET`   | `/:id`                      | auth                                                 | Détail + lignes + prIds |
| `PATCH` | `/:id`                      | ACHETEUR/CONTROLEUR/DAF/SUPER_ADMIN                  | Édite incoterm/expectedDate/deliveryAddress (draft) |
| `POST`  | `/:id/send`                 | idem                                                 | PDF + MinIO + écriture 8 + email |
| `POST`  | `/:id/resend`               | idem                                                 | Renvoie l'email sans recréer écriture |
| `POST`  | `/:id/acknowledge`          | idem                                                 | sent → acknowledged (ackRef) |
| `POST`  | `/:id/cancel`               | ACHETEUR/DAF/SUPER_ADMIN                             | + extourne classe 8 si sent/acknowledged |
| `GET`   | `/:id/pdf`                  | auth                                                 | Stream du PDF |
| `GET`   | `/:id/journal-entries`      | auth                                                 | Écritures liées (engagement + extournes) |

## 4. Exemples curl

```bash
# 1. Créer un BC depuis une DA approuvée
curl -X POST http://localhost:4000/api/v1/purchase-orders/from-pr/$PR_ID \
  -H "Authorization: Bearer $TOKEN_ACH" -H "Content-Type: application/json" \
  -d '{ "supplierId": "...", "incoterm": "DDP Dakar",
        "deliveryAddress": "Labo virologie, IPD Dakar",
        "expectedDate": "2026-06-15" }'
# → 201 { "id": "...", "poNumber": "BC-2026-0001", "status": "draft", ... }

# 2. Consolider 2 DAs en 1 BC
curl -X POST http://localhost:4000/api/v1/purchase-orders/from-prs \
  -H "Authorization: Bearer $TOKEN_ACH" -H "Content-Type: application/json" \
  -d '{ "prIds": ["...", "..."], "supplierId": "..." }'

# 3. Modifier en draft
curl -X PATCH http://localhost:4000/api/v1/purchase-orders/$PO_ID \
  -H "Authorization: Bearer $TOKEN_ACH" \
  -d '{ "incoterm": "CIF", "expectedDate": "2026-07-01" }'

# 4. Envoyer le BC
curl -X POST http://localhost:4000/api/v1/purchase-orders/$PO_ID/send \
  -H "Authorization: Bearer $TOKEN_ACH"
# → 201 { "poId": "...", "status": "sent",
#         "pdfObjectKey": "pos/2026/05/<uuid>.pdf",
#         "emailDelivered": true,
#         "commitmentEntryNumber": "OD-2026-0042" }

# 5. Télécharger le PDF
curl -OJ -H "Authorization: Bearer $TOKEN_ACH" \
  http://localhost:4000/api/v1/purchase-orders/$PO_ID/pdf
# → 200 application/pdf, fichier BC-2026-0001.pdf téléchargé

# 6. Accusé de réception fournisseur
curl -X POST http://localhost:4000/api/v1/purchase-orders/$PO_ID/acknowledge \
  -H "Authorization: Bearer $TOKEN_ACH" -H "Content-Type: application/json" \
  -d '{ "ackRef": "REF-FOURNISSEUR-12345" }'
# → 201 { "status": "acknowledged", "acknowledgedAt": "2026-05-20T08:42:00Z" }

# 7. Re-envoi de l'email (PDF déjà stocké)
curl -X POST http://localhost:4000/api/v1/purchase-orders/$PO_ID/resend \
  -H "Authorization: Bearer $TOKEN_ACH"
# → 201 { "delivered": true, "to": "sales@acme.example", ... }

# 8. Annuler avec extournement comptable
curl -X POST http://localhost:4000/api/v1/purchase-orders/$PO_ID/cancel \
  -H "Authorization: Bearer $TOKEN_ACH" -H "Content-Type: application/json" \
  -d '{ "reason": "Fournisseur en faillite, commande à reporter" }'
# → 201 { "po": { "status": "cancelled" },
#         "reverseEntryNumber": "OD-2026-0043" }

# 9. Voir les écritures comptables liées
curl -H "Authorization: Bearer $TOKEN_COMPTA" \
  http://localhost:4000/api/v1/purchase-orders/$PO_ID/journal-entries
# → [ { "entryNumber":"OD-2026-0042", "status":"reversed",
#       "lines":[{accountCode:"801",debit:425000,credit:0,...},
#                {accountCode:"802",debit:0,credit:425000,...}] },
#     { "entryNumber":"OD-2026-0043", "status":"posted",
#       "lines":[ ... extournement inversé ... ] } ]

# 10. Lister les BCs (filtres)
curl -H "Authorization: Bearer $TOKEN_ACH" \
  'http://localhost:4000/api/v1/purchase-orders?status=sent&supplierId=...&page=1&pageSize=20'
```

## 5. Numérotation

`BC-YYYY-NNNN`, séquentiel par année, verrou `pg_advisory_xact_lock`
indexé par l'année (idem PR — cf. `purchase-request.md`).

Pour les écritures comptables : `<JOURNAL>-YYYY-NNNN`. En sprint 3 on
n'utilise que `OD-YYYY-NNNN`. Les sprints suivants ajouteront `AC-`
(achats), `VE-` (ventes), `BQ-` (banque), etc.

## 6. Codes d'erreur

| Code                                    | HTTP | Sens                                                       |
|-----------------------------------------|------|------------------------------------------------------------|
| `BUSINESS.PO_NOT_EDITABLE`              | 409  | PATCH sur PO ≠ draft                                       |
| `BUSINESS.PO_NOT_SENDABLE`              | 409  | send sur PO ≠ draft                                        |
| `BUSINESS.PO_NOT_ACKNOWLEDGEABLE`       | 409  | acknowledge sur PO ≠ sent                                  |
| `BUSINESS.PO_NOT_CANCELLABLE`           | 409  | cancel sur PO ∈ {received, invoiced, closed, cancelled}    |
| `BUSINESS.PO_NO_PDF`                    | 404  | download/resend sur PO sans PDF (≠ sent)                   |
| `BUSINESS.PR_NOT_APPROVED`              | 409  | createFromPr sur DA non approuvée                          |
| `BUSINESS.PR_ALREADY_HAS_PO`            | 409  | DA déjà liée à un PO actif                                 |
| `BUSINESS.PR_TYPE_PETTY_CASH_NO_PO`     | 409  | DA petty_cash, pas de BC                                   |
| `BUSINESS.SUPPLIER_INACTIVE`            | 409  | supplier `is_active = false`                               |
| `BUSINESS.PO_CURRENCY_MISMATCH`         | 409  | from-prs avec devises hétérogènes                          |
| `BUSINESS.PR_LIST_EMPTY`                | 400  | from-prs avec `prIds = []`                                 |
| `BUSINESS.NO_OPEN_FISCAL_PERIOD`        | 409  | aucune période fiscale ouverte couvre la date d'écriture   |

## 7. Hors scope (renvoyé aux sprints suivants)

- **Sprint 4** — Réception (Goods Receipt, statuts
  `partially_received` / `received`), facturation (Invoice + matching
  3-way PR↔BC↔facture), comptabilisation classe 4/6 (extourne classe 8).
- **Sprint 5+** — Paiement (PaymentRun, SEPA), réapprovisionnement
  caisse, génération de rapports bailleur depuis les écritures classe 8.
- **Améliorations futures** — Template PDF Handlebars avec vrai logo IPD,
  envoi multi-destinataires, fallback PDF dans la base si MinIO down.

---

_Dernière mise à jour : 16/05/2026 — Sprint 3._

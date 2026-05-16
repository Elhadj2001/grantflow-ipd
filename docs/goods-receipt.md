# Réception de biens et services (Goods Receipt) — Sprint 4.1

Ce document décrit le cycle de vie d'un GR (Goods Receipt), ses effets sur
le BC parent, et les particularités biomédicales propres à l'IPD (chaîne
du froid, traçabilité lot/péremption).

> **Hors-scope** : la comptabilisation des achats n'est pas encore réalisée
> ici. Elle interviendra au **Sprint 4.2 (Facture + matching 3-way)** —
> classes 4/6 + extournement automatique des écritures classe 8 issues
> du BC. Pour l'instant, le GR ne fait que tracer la réception physique.

## 1. Cycle de vie

```
            createFromPo                  updateLines / update
                ▼                                  ▼
   PO sent  ──► GR draft  ─────────────────────► (boucle saisie)
                  │
                  ├─ complete  ──► GR complete
                  │                 │
                  │                 └─► PO.partially_received / received
                  │
                  ├─ cancel   ──► GR cancelled  (PO reste inchangé)
                  └─ reject   ──► GR rejected   (PO reste inchangé)
```

| Statut GR    | Description                                         | Transitions sortantes        |
|--------------|-----------------------------------------------------|-------------------------------|
| `draft`      | Magasinier en cours de saisie                       | complete / cancel / reject    |
| `complete`   | Réception validée, propagée au BC                   | (terminal)                    |
| `cancelled`  | Annulation du GR avant validation (erreur saisie)   | (terminal)                    |
| `rejected`   | Refus total de la livraison (qualité KO, mauvais produit) | (terminal)               |

Le GR `complete` est terminal — pour annuler une réception déjà validée,
il faudra passer par un **GR négatif** (sprint ultérieur, non couvert ici).

## 2. Pré-conditions pour créer un GR

Un GR ne peut être créé que si le BC est dans l'un de ces statuts :

- `sent`
- `acknowledged`
- `partially_received`

Sinon : `409 BUSINESS.PO_NOT_RECEIVABLE`.

À la création :
- Les lignes du GR sont **recopiées du BC avec `quantity = 0`** ;
- Le magasinier les met à jour au fur et à mesure de la vérification physique
  via `POST /goods-receipts/:id/lines`.

## 3. Validation au `complete`

Au moment de la validation finale :

1. **Au moins une ligne** doit avoir `quantity > 0` → sinon `GR_EMPTY_LINES`.
2. **Cumul reçu** (incluant l'historique des autres GR `complete` du même
   BC) ne peut **pas dépasser la quantité commandée** → sinon
   `GR_QTY_EXCEEDS_ORDER` avec `details.lines` détaillant chaque ligne en
   dépassement (`ordered`, `alreadyReceivedOnOtherGRs`, `requested`).
3. Si `cold_chain_required = true` :
   - Toute ligne avec `quantity > 0` doit porter **`batch_number` + `expiry_date`**
     → sinon `BATCH_INFO_REQUIRED`.
   - Aucune ligne reçue ne peut avoir `cold_chain_ok = false`
     → sinon `COLD_CHAIN_BROKEN` (alerte forte : réactifs biomédicaux
     potentiellement compromis).

Si toutes les vérifications passent, dans une **transaction unique** :

1. `po_line.quantity_received += gr_line.quantity` pour chaque ligne reçue ;
2. Recalcul du `po.status` :
   - `received` si **toutes** les po_lines vérifient `quantity_received ≥ quantity` ;
   - `partially_received` sinon si au moins une ligne a été reçue ;
3. `gr.status = complete`, `completed_at`, `completed_by` persistés.

## 4. Particularités IPD biomédical

Le flag `cold_chain_required` à la création du GR active le contrôle
réglementaire renforcé :

| Champ obligatoire     | Détail                                       |
|-----------------------|----------------------------------------------|
| `batch_number`        | Numéro de lot du fabricant                   |
| `expiry_date`         | Date de péremption (interdiction d'utilisation après) |
| `cold_chain_ok=true`  | Confirmation que la chaîne du froid n'a pas été rompue |
| `serial_numbers[]`    | Optionnel : tracker série par série (vaccins, kits) |
| `quality_check`       | Optionnel : commentaire libre du contrôle qualité |

L'agent magasinier doit refuser (`reject`) toute livraison dont la chaîne
du froid a été manifestement rompue, plutôt que de la consigner et
d'attendre que `complete` la rejette. Le rejet bloque définitivement ce
GR ; il faut créer un nouveau GR si la livraison est reprogrammée.

## 5. Endpoints

Tous protégés par JWT Bearer. Sous `/api/v1/`.

| Méthode | Path                                       | Rôles                                | Description                                  |
|---------|--------------------------------------------|--------------------------------------|----------------------------------------------|
| POST    | `/goods-receipts/from-po/:poId`            | MAGASINIER, ACHETEUR, SUPER_ADMIN    | Créer un GR draft depuis un BC réceptionnable |
| GET     | `/goods-receipts`                          | tous (RBAC scope)                    | Liste paginée                                |
| GET     | `/goods-receipts/:id`                      | tous (RBAC scope)                    | Détail GR + lignes                           |
| PATCH   | `/goods-receipts/:id`                      | MAGASINIER, SUPER_ADMIN              | Modifier en-tête (draft only)                |
| POST    | `/goods-receipts/:id/lines`                | MAGASINIER, SUPER_ADMIN              | Patch lignes (qty, lot, péremption, chaîne du froid) |
| POST    | `/goods-receipts/:id/complete`             | MAGASINIER, SUPER_ADMIN              | Valider → propage qty + recalcule PO status  |
| POST    | `/goods-receipts/:id/cancel`               | MAGASINIER, SUPER_ADMIN              | Annuler un GR draft                          |
| POST    | `/goods-receipts/:id/reject`               | MAGASINIER, SUPER_ADMIN              | Refuser la livraison (qualité KO)            |
| GET     | `/purchase-orders/:poId/receipts`          | tous (RBAC scope)                    | Historique des GR pour un PO                 |
| GET     | `/purchase-orders/:poId/remaining`         | tous (RBAC scope)                    | Restant à recevoir, ligne par ligne          |

**RBAC scope** :
- `MAGASINIER`, `ACHETEUR`, `CONTROLEUR`, `DAF`, `COMPTABLE`, `TRESORIER`,
  `BAILLEUR`, `SUPER_ADMIN` → voient **tout**.
- `DEMANDEUR`, `PI` → voient **uniquement** les GR liés aux DAs qu'ils ont
  rédigées (chemin via `purchase_order_pr`).

## 6. Codes d'erreur (`BUSINESS.*`)

| Code                          | HTTP | Quand                                                           |
|-------------------------------|------|------------------------------------------------------------------|
| `PO_NOT_RECEIVABLE`           | 409  | PO ≠ sent / acknowledged / partially_received                    |
| `GR_NOT_EDITABLE`             | 409  | PATCH / lines sur GR ≠ draft                                    |
| `GR_EMPTY_LINES`              | 409  | Complete sans aucune ligne `quantity > 0`                       |
| `GR_QTY_EXCEEDS_ORDER`        | 409  | Quantité reçue cumulée > quantité commandée                     |
| `COLD_CHAIN_BROKEN`           | 409  | Au moins une ligne reçue a `cold_chain_ok = false`              |
| `BATCH_INFO_REQUIRED`         | 409  | Cold-chain GR : ligne reçue sans `batch_number` ou `expiry_date` |
| `GR_ALREADY_COMPLETE`         | 409  | Second `complete` sur un GR déjà complete                       |
| `GR_NOT_CANCELLABLE`          | 409  | Annulation d'un GR ≠ draft                                       |
| `GR_NOT_REJECTABLE`           | 409  | Reject d'un GR ≠ draft                                          |
| `GR_LINE_NOT_FOUND`           | 404  | `lineId` du patch absent du GR                                  |
| `REJECTION_REASON_MISSING`    | 400  | Reject sans motif                                               |

## 7. Exemples curl

Variables d'environnement utilisées :
```bash
export TOKEN_SA="..."             # JWT SUPER_ADMIN
export PO_ID="po-uuid-..."        # BC déjà sent
export GR_ID=""                   # à remplir après création
```

### Créer un GR depuis un PO

```bash
curl -X POST "http://localhost:4000/api/v1/goods-receipts/from-po/$PO_ID" \
  -H "Authorization: Bearer $TOKEN_SA" \
  -H "Content-Type: application/json" \
  -d '{
    "deliveryNoteRef": "BL-2026-0042",
    "notes": "Livraison conforme — vérification visuelle OK",
    "coldChainRequired": false
  }'
```

Réponse :
```json
{
  "id": "gr-uuid-...",
  "grNumber": "GR-2026-0001",
  "status": "draft",
  "lines": [
    { "id": "grl-1", "poLineId": "pol-1", "quantity": "0", ... }
  ]
}
```

### Saisir les quantités reçues

```bash
curl -X POST "http://localhost:4000/api/v1/goods-receipts/$GR_ID/lines" \
  -H "Authorization: Bearer $TOKEN_SA" \
  -H "Content-Type: application/json" \
  -d '{
    "lines": [
      { "lineId": "grl-1", "quantity": 8, "batchNumber": "LOT-A2026", "expiryDate": "2027-12-31" },
      { "lineId": "grl-2", "quantity": 5 }
    ]
  }'
```

### Valider le GR

```bash
curl -X POST "http://localhost:4000/api/v1/goods-receipts/$GR_ID/complete" \
  -H "Authorization: Bearer $TOKEN_SA"
```

Réponse :
```json
{
  "gr": { "id": "...", "status": "complete", ... },
  "poStatus": "partially_received",
  "totalReceivedLines": 2
}
```

### Refuser une livraison

```bash
curl -X POST "http://localhost:4000/api/v1/goods-receipts/$GR_ID/reject" \
  -H "Authorization: Bearer $TOKEN_SA" \
  -H "Content-Type: application/json" \
  -d '{ "reason": "colis endommagé à la livraison, chaîne du froid rompue" }'
```

### Voir le restant à recevoir

```bash
curl -X GET "http://localhost:4000/api/v1/purchase-orders/$PO_ID/remaining" \
  -H "Authorization: Bearer $TOKEN_SA"
```

Réponse :
```json
[
  { "poLineId": "pol-1", "lineNumber": 1, "description": "Gants nitrile",
    "unit": "box", "ordered": 10, "received": 8, "remaining": 2 }
]
```

## 8. Effets sur l'audit log

Toute mutation est captée par l'intercepteur global existant (sprint 1.x) :
- `success` : `goods_receipts.create_from_po`, `goods_receipts.complete`,
  `goods_receipts.cancel`, `goods_receipts.reject`.
- `denied` : tentative d'un rôle non habilité (ex : DEMANDEUR sur `/complete`).
- `failed_validation` : toute exception `BusinessException` (codes ci-dessus).

Le chaînage hash SHA-256 sur `audit.event_log` garantit l'intégrité de la
trace (cf. CLAUDE.md §1).

## 9. Prochaines étapes (Sprint 4.2)

À la facture (Invoice + matching 3-way PR↔BC↔facture) :
- Création d'une écriture comptable **classe 4/6** (charge + dette
  fournisseur) ;
- **Extournement automatique** de l'engagement classe 8 (801/802) posté
  à l'émission du BC, pour la fraction facturée ;
- Contrôle 3-way : `quantity_invoiced ≤ quantity_received ≤ quantity` à
  chaque insert de ligne de facture.

---

_Dernière mise à jour : 2026-05-16 — Sprint 4.1 / El Hadj Amadou NIANG_

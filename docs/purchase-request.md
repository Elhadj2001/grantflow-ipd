# Demande d'Achat (Purchase Request) — Sprint 2.1

## 1. Cycle de vie (M1 — sprint 2.1 uniquement)

```
       create()                      submit()
draft ─────────────► draft ─────────────────► submitted
   │
   │  cancel()
   ▼
cancelled
```

- **draft** : statut initial. La DA est modifiable et annulable par son auteur.
- **submitted** : statut après `POST /:id/submit`. Le contrôle budgétaire est
  passé et une `approval_step` initiale est créée (le moteur d'approbation
  arrive au sprint 2.2).
- **cancelled** : annulation possible uniquement en draft. Aucune restauration
  prévue dans ce sprint.

## 2. Règles d'or appliquées

### 2.1 Imputation analytique obligatoire à la source

Toute DA doit fournir, dès la création :
- `projectId` *(obligatoire)*
- `grantId` *(obligatoire — doit appartenir au projet)*
- `lines[].budgetLineId` *(obligatoire par ligne — doit appartenir au grant)*
- `costCenterId`, `activityId` *(optionnels mais recommandés)*

Si `grant.projectId ≠ projectId` → **400 `BUSINESS.PROJECT_GRANT_MISMATCH`**.
Si `budgetLineId` n'appartient pas au grant → **400 `BUSINESS.BUDGET_LINE_NOT_IN_GRANT`**.

### 2.2 Contrôle budgétaire bloquant au *submit*, pas à la création

La création accepte une DA dont le total dépasse le budget — c'est le job du
demandeur de vérifier qu'il a assez. Le contrôle bloquant intervient au moment
du submit :

- somme des **DA pending** (status ∈ submitted/pending_*/approved) sur la même
  budget line
- somme des **BC ouverts** (status ∈ draft/sent/acknowledged/partially_received/
  received/invoiced)
- la nouvelle DA en cours de soumission

Si la somme dépasse `budgetLine.budgetedAmount` sur au moins une ligne :
**409 `BUSINESS.INSUFFICIENT_BUDGET`** avec `details.lines` listant les
budget lines en dépassement.

### 2.3 Ownership-scoped read

Les rôles **CONTROLEUR, DAF, COMPTABLE, TRESORIER, SUPER_ADMIN** voient toutes
les DA. Les autres (**DEMANDEUR, PI, ACHETEUR**, etc.) ne voient que leurs
propres DA. L'accès à la DA d'un autre utilisateur renvoie **404** (sécurité par
obscurité, pas 403).

## 3. Endpoints

| Verbe | Route | Rôles | Effet |
|---|---|---|---|
| `GET` | `/purchase-requests` | tous sauf BAILLEUR | liste paginée scoped owner |
| `GET` | `/purchase-requests/:id` | idem | détail + lignes |
| `GET` | `/purchase-requests/:id/check-budget` | idem | pré-vérification (lecture seule) |
| `POST` | `/purchase-requests` | DEMANDEUR/PI/SUPER_ADMIN | create en `draft` |
| `PATCH` | `/purchase-requests/:id` | idem | si `draft` ET (owner ∨ SUPER_ADMIN) |
| `DELETE` | `/purchase-requests/:id` | idem | annule (`draft` → `cancelled`) |
| `POST` | `/purchase-requests/:id/submit` | DEMANDEUR/PI/CONTROLEUR/DAF/SUPER_ADMIN | passe en `submitted` |

## 4. Exemples curl

```bash
# 1. Créer une DA (DEMANDEUR)
curl -X POST http://localhost:4000/api/v1/purchase-requests \
  -H "Authorization: Bearer $TOKEN_DEM" \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Pipettes 1000 µL pour labo virologie",
    "projectId": "...",
    "grantId":   "...",
    "currency":  "XOF",
    "lines": [
      { "description": "Pipette électronique", "quantity": 5,
        "unit": "unit", "unitPrice": 85000,
        "budgetLineId": "..." }
    ]
  }'
# → 201 { "id": "...", "prNumber": "DA-2026-0027", "status": "draft", ... }

# 2. Pré-vérification budgétaire (avant submit)
curl http://localhost:4000/api/v1/purchase-requests/$PR_ID/check-budget \
  -H "Authorization: Bearer $TOKEN_DEM"
# → { "currentTotal": 425000, "available": 312000, "willConsume": 425000,
#     "wouldExceed": true,
#     "byLine": [ { "code": "L01", "budgeted": 38000, "alreadyConsumed": 0,
#                   "willConsume": 425000, "available": -387000,
#                   "wouldExceed": true } ] }

# 3. Soumission (refusée car budget KO)
curl -X POST http://localhost:4000/api/v1/purchase-requests/$PR_ID/submit \
  -H "Authorization: Bearer $TOKEN_DEM"
# → 409 { "code": "BUSINESS.INSUFFICIENT_BUDGET", "details": { "lines": [...] } }

# 4. Lister ses DA
curl 'http://localhost:4000/api/v1/purchase-requests?status=draft&page=1&pageSize=20' \
  -H "Authorization: Bearer $TOKEN_DEM"

# 5. Annuler une DA brouillon
curl -X DELETE http://localhost:4000/api/v1/purchase-requests/$PR_ID \
  -H "Authorization: Bearer $TOKEN_DEM"
# → 204
```

## 5. Numérotation

`DA-YYYY-NNNN`, séquentiel par année. La génération prend un
`pg_advisory_xact_lock` indexé par l'année pour éviter les conflits sous
charge concurrente. Compteur basé sur `COUNT(*) + 1` (acceptable jusqu'à
~10 000 DA/an ; au-delà, basculer vers une SEQUENCE Postgres dédiée).

## 6. Hors scope (renvoyé au sprint 2.2+)

- Workflow d'approbation multi-niveaux (PI → CG → DAF).
- Création d'un Bon de Commande à partir d'une DA approuvée.
- Recettes (GR — Goods Receipt) et matching 3-way.

---

_Dernière mise à jour : 16/05/2026 — Sprint 2.1._

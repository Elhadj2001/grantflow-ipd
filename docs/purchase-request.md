# Demande d'Achat (Purchase Request) — Sprints 2.1 → 2.2

## 1. Cycle de vie

```
       create           submit       approve PI                              approve final
draft ─────────► draft ─────────► pending_pi ──────► [pending_cg ──► pending_daf] ──────► approved
   │                                  │
   │ cancel                           │ reject (with reason ≥ 5 chars)
   ▼                                  ▼
cancelled                          rejected
                                      ▲
                                      │ return-for-changes
                                      ▼
                                    draft
```

- **draft** : statut initial / après `return-for-changes`. La DA est éditable
  et annulable par son auteur (ou SUPER_ADMIN).
- **pending_pi / pending_cg / pending_daf** : étapes d'approbation. La DA
  est immuable côté demandeur. Le rôle attendu valide ou refuse.
- **approved** : workflow terminé, prête à passer en BC (sprint 2.3+).
- **rejected** : refus avec motif obligatoire enregistré dans
  `purchase_request.rejection_reason`. Pas de réouverture automatique.
- **cancelled** : annulation par l'auteur (draft uniquement).

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

## 6. Workflow d'approbation standard (sprint 2.2)

### 6.1 Routage par seuil

| Montant total (XOF) | Étapes successives |
|---|---|
| < 500 000 | PI seul |
| 500 000 ≤ total < 5 000 000 | PI puis CG |
| ≥ 5 000 000 | PI puis CG puis DAF |

À chaque approbation, le service crée la prochaine `approval_step` et passe
la DA en `pending_<role>`. À la dernière étape : `status = approved`.

### 6.2 Anti-fractionnement

Lors de chaque approbation, le service compte les autres DA actives du même
demandeur sur le même projet dans la fenêtre **30 jours glissants**. Si > 3,
on émet un **warning non bloquant** dans la réponse (`splittingWarning`) et
dans le log audit. Les approbateurs voient cette alerte en UI pour décider.

### 6.3 Endpoints workflow

| Verbe | Route | Rôles requis | Effet |
|---|---|---|---|
| `POST` | `/:id/approve` | rôle de l'étape (ou SUPER_ADMIN) | passe à l'étape suivante ou approved |
| `POST` | `/:id/reject` | rôle de l'étape | passe à rejected, motif obligatoire |
| `POST` | `/:id/return-for-changes` | rôle de l'étape | retour en draft, commentaire obligatoire |
| `GET` | `/pending-my-approval` | PI/CG/DAF/SUPER_ADMIN | DA en attente de MA décision |
| `GET` | `/:id/approval-history` | tous sauf BAILLEUR | historique des steps ordonnées |

### 6.4 Exemples curl

```bash
# Approuver — étape courante (rôle inféré par le service)
curl -X POST http://localhost:4000/api/v1/purchase-requests/$PR_ID/approve \
  -H "Authorization: Bearer $TOKEN_PI" \
  -H "Content-Type: application/json" \
  -d '{"comment":"Conforme au plan de recherche"}'
# → 201 { "status": "pending_cg", "nextStepRole": "CONTROLEUR", "splittingWarning": null }

# Refuser (motif obligatoire, min 5 chars)
curl -X POST http://localhost:4000/api/v1/purchase-requests/$PR_ID/reject \
  -H "Authorization: Bearer $TOKEN_DAF" \
  -H "Content-Type: application/json" \
  -d '{"reason":"Hors plan budgétaire trimestriel"}'
# → 201 { "status": "rejected", "rejectionReason": "Hors plan ..." }

# Renvoyer en draft pour modifications
curl -X POST http://localhost:4000/api/v1/purchase-requests/$PR_ID/return-for-changes \
  -H "Authorization: Bearer $TOKEN_PI" \
  -H "Content-Type: application/json" \
  -d '{"comment":"Préciser le fournisseur attendu et joindre 2 devis"}'
# → 201 { "status": "draft", ... }

# Lister mes décisions en attente
curl 'http://localhost:4000/api/v1/purchase-requests/pending-my-approval?urgent=true' \
  -H "Authorization: Bearer $TOKEN_CG"
# → { "data": [ { "id": "...", "currentStepRole": "CONTROLEUR", "isUrgent": true } ], ... }

# Historique complet
curl http://localhost:4000/api/v1/purchase-requests/$PR_ID/approval-history \
  -H "Authorization: Bearer $TOKEN_DEM"
# → [ { "stepOrder": 1, "approverRole": "PI", "status": "approved", "decisionNotes": "..." }, ... ]
```

### 6.5 Cas particuliers

- **SUPER_ADMIN bypass** : peut approuver/refuser n'importe quelle étape
  sans contrainte de rôle (utile pour débloquer un blocage).
- **PI ownership** : un PI ne peut approuver que les DA dont il est `piUserId`
  du projet. Autre projet → **403 `PI_NOT_OWNER_OF_PROJECT`**.
- **Double-clic** : si l'étape est déjà décidée, **409 `PR_ALREADY_DECIDED`**.
- **petty_cash / cash_advance** : tentative d'approve/reject/return renvoie
  **501 `CASH_WORKFLOW_NOT_YET_IMPLEMENTED`** — workflow dédié au sprint 2.3.
- **return-for-changes** : la DA repart au statut `draft`, le demandeur peut
  modifier puis re-soumettre. Une nouvelle approval_step #N+1 sera créée
  à la prochaine submit (l'historique est cumulatif).

## 7. Hors scope (renvoyé aux sprints suivants)

- Sprint 2.3 — workflow petty_cash / cash_advance (champs DDL déjà posés).
- Sprint 2.4+ — création d'un Bon de Commande à partir d'une DA approuvée,
  réception (GR — Goods Receipt) et matching 3-way (PR↔BC↔facture).

---

_Dernière mise à jour : 16/05/2026 — Sprint 2.2._

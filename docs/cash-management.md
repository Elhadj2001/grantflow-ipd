# Gestion de la petite caisse — Référence métier

> Sprint 2.3. Pour les workflows API, voir
> [`purchase-request.md`](./purchase-request.md) §7.

## 1. Concept : petite caisse et régie d'avance

La **petite caisse** (en anglais *petty cash*) est un fonds en espèces que
l'institut maintient pour régler de petites dépenses immédiates et
inattendues : taxi laboratoire, consommables d'urgence, frais protocolaires,
etc. Elle évite d'avoir à passer par un BC + facture + paiement bancaire
pour des montants faibles.

La **régie d'avance** (en anglais *cash advance*) est une avance ponctuelle
remise à un agent pour qu'il puisse engager des dépenses en son nom propre
sur le terrain (mission, achat à l'étranger), à charge pour lui de
régulariser ensuite en justifiant l'usage effectif des fonds.

Différence avec un paiement bancaire classique :

| Critère | Caisse | Banque |
|---|---|---|
| Délai | immédiat | 1 à 5 jours (SEPA) |
| Plafond unitaire | faible (50–100 k XOF typique) | aucun |
| Traçabilité | ticket de caisse manuel + DA | extrait bancaire automatique |
| Risque | élevé (vol, erreur) | faible |
| Usage | urgence, frais menus | normal |

Le système GRANTFLOW IPD encadre les deux flux via les workflows
`petty_cash` et `cash_advance`, en imposant systématiquement une DA
imputée analytiquement (projet + grant + ligne budgétaire), à la
différence d'un usage manuel "tiroir-caisse".

## 2. Acteurs

### 2.1 Caissier (`CAISSIER`)
- Détient la caisse physique (clé du coffre / tiroir).
- Approuve ou refuse les DA `petty_cash` (1 étape).
- Co-approuve les DA `cash_advance` après le PI.
- Régularise (`settle`) les avances de mission.

### 2.2 Trésorier (`TRESORIER`)
- Gère les comptes bancaires (paiement fournisseurs, virements SEPA).
- N'intervient PAS sur la caisse — séparation des tâches.

### 2.3 PI / Demandeur
- Initie une DA `cash_advance` pour une mission ou un déplacement.
- Le PI valide la première étape (justification scientifique / projet).

### 2.4 DAF
- Définit les plafonds (`ceiling`, `per_request_max`, `per_day_user_max`)
  par caisse via `PATCH /cash-boxes/:id`.
- Peut bypasser n'importe quelle étape via `SUPER_ADMIN` (rare, audité).

## 3. Plafonds typiques (IPD)

| Caisse | Solde max | Par requête | Par jour/agent |
|---|---|---|---|
| Caisse principale (XOF) | 500 000 | 100 000 | 200 000 |
| Caisse devises (USD/EUR) | 2 000 USD eq. | 500 USD eq. | 1 000 USD eq. |

Les plafonds sont stockés en `ref.cash_box` et appliqués au runtime :
- `current_balance` : solde réel après opérations approuvées
- `ceiling` : montant maximal qu'on peut ré-approvisionner
- `per_request_max` : plafond d'une seule DA
- `per_day_user_max` : somme des `petty_cash` du jour pour UN demandeur
  (anti-fractionnement : empêche un agent de tronçonner ses dépenses)

## 4. Référentiel comptable SYSCEBNL

La caisse correspond au compte **57 — Caisse** dans le plan comptable
OHADA / SYSCEBNL. Sous-comptes typiques :

- `571` Caisse siège (XOF)
- `572` Caisse devises (USD, EUR)
- `573` Régies d'avance (cash_advance encore non régularisées)

Quand une DA `petty_cash` ou `cash_advance` est approuvée, l'écriture
comptable correspondante (sprint 3.x, hors scope ici) devra créditer le
compte 57 et débiter la classe 6 / 2 selon la nature de la dépense.
Pour cash_advance, l'écriture initiale crédite 57 et débite **573**
(créance sur l'agent) ; le `settle` solde 573 et débite la charge réelle.

## 5. Anti-fraude — contrôles intégrés

- **Imputation analytique obligatoire** dès la DA (cf. CLAUDE.md §2).
- **Séparation des tâches** : le demandeur ≠ le caissier qui approuve.
  Un caissier ne peut pas s'approuver ses propres DA (le PI ou le DAF
  doit valider).
- **Plafonds quotidiens** : limite la consommation par agent.
- **Audit log immuable** : chaque approve/reject/settle est journalisé
  avec hash SHA-256 (table `audit.event_log`).
- **Variance check** : un settle avec variance > 0 (l'agent réclame plus
  que prévu) déclenche une alerte côté front (à venir).

## 6. Limites actuelles (à compléter en sprints suivants)

- Pas de réapprovisionnement automatique de caisse (endpoint à venir).
- Pas de gestion des devises non-XOF dans la caisse (couvert par le
  champ `currency` mais workflow non testé en multidevises).
- Pas de génération automatique de l'écriture comptable au moment de
  l'approbation — viendra avec le module GL (sprint 3.x).
- Le rapprochement entre le solde théorique (`current_balance`) et le
  solde physique (espèces dans le tiroir) doit être fait manuellement
  par le caissier en début/fin de journée. Une feature "inventaire de
  caisse" pourrait être ajoutée.

---

_Dernière mise à jour : 16/05/2026 — Sprint 2.3._

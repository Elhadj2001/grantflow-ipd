# Scénario de démonstration — De la convention au rapport bailleur (P2A complet)

> **But** : dérouler une chaîne Procure-to-Account complète, **création de convention → DA → BC (engagement classe 8) → réception → facture (classes 4/6) → comptabilisation → rapport bailleur**, sur des données réelles de la stack locale.
> Sert à : (1) produire un jeu de démo réaliste, (2) capturer les écrans pour le mémoire, (3) rejouer la chaîne devant le jury.
>
> _Établi le 22/05/2026 — ancré sur le code livré jusqu'à F5a (vérifié controllers + DTO + seed)._

---

## 0. Trois contraintes à connaître avant de commencer

Ces points ont été vérifiés dans le code et conditionnent tout le scénario :

1. **Les rôles ACHETEUR, MAGASINIER et BAILLEUR sont désormais seedés** (sprint amorce-démo). Le Bon de commande se fait sous `acheteur@`, la Réception sous `magasinier@`, et la lecture côté bailleur sous `bailleur@`. `admin@` (SUPER_ADMIN) reste autorisé sur *toutes* les étapes et sert de suppléant universel. ⚠️ **Pré-requis** : ces 3 comptes existent dans `docker/keycloak/realm.json` mais ne pourront se connecter qu'après **ré-import du realm Keycloak** (voir §1) — sinon, repli sur `admin@`.
2. **Le compte de charge par défaut d'une facture est `605`**, selon la priorité `ligne_facture.glAccount > ligne_budgétaire.default_account > 605`. Or **`605` n'est mappé dans aucun template bailleur** → si on laisse le compte vide, **le rapport affiche 0**. On impute donc la facture sur un compte **mappé** (ici `604` → catégorie *SUPPLIES* du template USAID).
3. **Les fournisseurs sont désormais seedés** (`FOURN-BIOMED`, `FOURN-LABEQUIP`, `FOURN-COLDCHAIN`). En revanche, **les lignes budgétaires d'une convention *neuve* ne sont pas créables depuis l'UI** : une petite **amorce technique** (un seul script, §4) crée les lignes budgétaires de la convention `USAID-IPD-2026-01`. Tout le reste se fait à la souris.

> Les points restants (lignes budgétaires sans écran, `605` non mappé) sont des **écarts à arbitrer** (voir §8) : ils alimentent le backlog F-polish.

---

## 1. Pré-requis

```bash
# Stack up
docker compose up -d postgres redis minio keycloak mailhog

# Schéma (source de vérité = DDL, jamais prisma migrate)
psql -h localhost -p 5433 -U grantflow -d grantflow_dev -f docs/grantflow_ddl_postgresql.sql

# Client Prisma + données métier
cd apps/api && npm run prisma:generate && npm run prisma:seed

# Ré-import du realm Keycloak (indispensable pour les 3 nouveaux comptes
# acheteur@ / magasinier@ / bailleur@ — sinon ils n'existent pas côté auth) :
docker compose stop keycloak && docker compose rm -f keycloak && docker compose up -d keycloak
# (le realm docker/keycloak/realm.json est ré-importé au démarrage)

# API + Web
npm run dev   # (depuis la racine, ou chaque app)
```

Le seed charge : plan SYSCEBNL, 11 rôles, 9 bailleurs, **11 utilisateurs**, **3 fournisseurs de démo** (`FOURN-BIOMED`, `FOURN-LABEQUIP`, `FOURN-COLDCHAIN`), 3 conventions de démo (BMGF / CEPI / EDCTP) avec leurs lignes budgétaires, et **3 templates** bailleur (`USAID-FFR425`, `WHO-FFR`, `WELLCOME`).

---

## 2. Comptes de connexion (seedés)

| Écran / action | Login | Mot de passe | Rôle |
|---|---|---|---|
| Création convention, lignes budg., templates, **rapport (créer + verrouiller)** | `cg@pasteur.sn` | `Cg#2026-IPD` | CONTROLEUR |
| Saisie de la DA | `amadou@pasteur.sn` | `Demandeur#2026` | DEMANDEUR |
| Validation DA (niveau PI) | `pi@pasteur.sn` | `Pi#2026-IPD` | PI |
| Validation DA finale, **envoi du rapport**, post facture | `daf@pasteur.sn` | `Daf#2026-IPD` | DAF |
| Facture (saisie, soumission, comptabilisation) | `compta@pasteur.sn` | `Compta#2026` | COMPTABLE |
| **Bon de commande** (créer + envoyer) | `acheteur@pasteur.sn` | `Acheteur#2026` | ACHETEUR |
| **Réception** (Goods Receipt) | `magasinier@pasteur.sn` | `Magasinier#26` | MAGASINIER |
| Lecture du rapport côté bailleur (RBAC) | `bailleur@pasteur.sn` | `Bailleur#2026` | BAILLEUR |
| Suppléant universel (tout niveau) | `admin@pasteur.sn` | `Admin#2026` | SUPER_ADMIN |
| Trésorerie / paiement (hors scénario) | `tres@pasteur.sn` | `Tres#2026-IPD` | TRESORIER |

> ✅ **Les 3 rôles ACHETEUR / MAGASINIER / BAILLEUR sont désormais seedés** — la démo « séparation des tâches » est complète. ⚠️ Ces comptes ne se connectent qu'après **ré-import du realm Keycloak** (commande au §1). En cas de souci de connexion, `admin@` reste un suppléant universel.

---

## 3. Vue d'ensemble du parcours

| # | Étape | Login | Statut produit | Écriture comptable |
|---|---|---|---|---|
| 1 | Créer la **convention** USAID | `cg@` | grant `active` | — |
| — | Amorce : lignes budgétaires de la convention | _script_ | — | — |
| 2 | Créer + soumettre la **DA** | `amadou@` | `submitted` | — |
| 3 | Valider la DA (PI → … → DAF) | `pi@` puis `daf@` | `approved` | — |
| 4 | Créer le **BC** depuis la DA | `acheteur@` | `draft` | — |
| 5 | **Envoyer** le BC | `acheteur@` | `sent` | **Engagement classe 8** (801/809) |
| 6 | **Réception** (GR) depuis le BC | `magasinier@` | `completed` | — |
| 7 | Saisir la **facture** (compte **604**), soumettre | `compta@` | `matched` | — (rapprochement 3-way) |
| 8 | **Comptabiliser** la facture | `compta@` | `posted` | **Classe 6/4** (604 / 445 / 401) + **extourne classe 8** |
| 9 | Générer le **rapport bailleur**, verrouiller, envoyer | `cg@` puis `daf@` | `locked` → `sent` | — |

Données de référence du scénario :

- **Projet** : `MADIBA-VAC-2024` (existant)
- **Convention** : `USAID-IPD-2026-01` — bailleur **USAID**, devise **USD**, overhead 10 %, du 01/01/2026 au 31/12/2027
- **Fournisseur** : `FOURN-BIOMED` — *BioMed Sénégal SARL*
- **Template de rapport** : `USAID-FFR425` (mappe `604 → SUPPLIES`, `661 → PERSONNEL`, `61 → TRAVEL`…)
- **Période de rapport** : 01/01/2026 → 30/06/2026

---

## 4. Amorce technique (à lancer une seule fois)

Crée les 3 lignes budgétaires de la convention (avec leur compte SYSCEBNL par défaut **déjà mappé**, ce qui sécurise le §0-point 2). Le fournisseur `FOURN-BIOMED` est désormais **seedé** (`seed/suppliers.json`) — plus besoin de le créer ici.

> Lancer **après l'étape 1** (la convention `USAID-IPD-2026-01` doit exister).

Créer `apps/api/prisma/demo-amorce.ts` :

```ts
import './load-env';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const GRANT_REF = 'USAID-IPD-2026-01';

async function main() {
  // Lignes budgétaires de la convention (default_account = compte mappé).
  // Le fournisseur FOURN-BIOMED est seedé (seed/suppliers.json) — rien à créer ici.
  const grant = await prisma.grantAgreement.findUnique({ where: { reference: GRANT_REF } });
  if (!grant) {
    throw new Error(`Convention ${GRANT_REF} introuvable — créez-la d'abord (étape 1).`);
  }
  const lines = [
    { code: 'L01', label: 'Consommables laboratoire',  budgetedAmount: 90000,  defaultAccount: '604' },
    { code: 'L03', label: 'Personnel scientifique',     budgetedAmount: 150000, defaultAccount: '661' },
    { code: 'L04', label: 'Missions et déplacements',   budgetedAmount: 40000,  defaultAccount: '61'  },
  ];
  for (const l of lines) {
    await prisma.budgetLine.upsert({
      where: { grantId_code: { grantId: grant.id, code: l.code } },
      update: { defaultAccount: l.defaultAccount },
      create: { grantId: grant.id, ...l },
    });
  }
  console.log('✅ Amorce démo : 3 lignes budgétaires prêtes (fournisseur déjà seedé).');
}

main().catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
```

Exécution :

```bash
cd apps/api && npx tsx prisma/demo-amorce.ts
```

> **Raccourci sans amorce** : si tu préfères zéro friction, déroule les étapes 2→9 sur une **convention déjà seedée** (`MADIBA-VAC-2024 / BMGF`, lignes L01–L05 prêtes). Le fournisseur étant seedé, **aucune amorce n'est nécessaire** dans ce cas — tu dois seulement saisir le compte `604` à la main à l'étape 7 sur la ligne de facture (les lignes seedées n'ont pas de `default_account`). Le rapport (étape 9) se génère alors sur la convention BMGF avec le template `USAID-FFR425`.

---

## 5. Le scénario pas-à-pas

### Étape 1 — Créer la convention _(login `cg@`)_

`Pilotage → Conventions → Nouvelle convention`

| Champ | Valeur |
|---|---|
| Référence | `USAID-IPD-2026-01` |
| Bailleur | USAID |
| Projet | MADIBA-VAC-2024 |
| Montant | `300000` |
| Devise | USD |
| Taux overhead | `0.10` |
| Date début | 2026-01-01 |
| Date fin | 2027-12-31 |
| Signée le | 2026-01-15 |
| Statut | active |

➡️ **Résultat attendu** : la convention apparaît dans la liste avec le badge `active`. Le tableau de bord de la convention est encore vide (0 ligne budgétaire) → c'est normal, on les ajoute via l'amorce.

**Lancer maintenant l'amorce du §4.** Recharge la page convention : les 3 lignes budgétaires s'affichent dans le *Tableau des emplois*.

---

### Étape 2 — Demande d'achat _(login `amadou@`)_

`Achats → Demandes d'achat → Nouvelle DA`

| Champ | Valeur |
|---|---|
| Type | standard |
| Projet | MADIBA-VAC-2024 |
| Convention | USAID-IPD-2026-01 |
| Devise | XOF |
| Description | Réactifs PCR pour la plateforme MADIBA |
| **Ligne** — description | Réactifs PCR SARS-CoV-2 |
| Quantité | 5 |
| Unité | boîte |
| Prix unitaire | 12000 |
| Ligne budgétaire | **L01 — Consommables laboratoire** |

➡️ Le **contrôle budgétaire** s'affiche : 60 000 demandés < 90 000 disponibles → ✅ vert.
Enregistrer, puis **Soumettre**. Statut → `submitted`.

> 🔒 Règle d'or démontrée : imputation analytique obligatoire **dès la DA** (projet + convention + ligne budgétaire).

---

### Étape 3 — Validation de la DA _(login `pi@`, puis `daf@`)_

`Achats → En attente de mon approbation` → ouvrir la DA → **Approuver**.

Le circuit d'une DA *standard* est PI → (Contrôleur) → DAF. **Approuve successivement** avec chaque login compétent jusqu'à obtenir le statut **`approved`** :

- `pi@` (Pi#2026-IPD) — validation budgétaire PI
- si une étape Contrôleur est demandée : `cg@` (Cg#2026-IPD)
- `daf@` (Daf#2026-IPD) — validation finale

> Astuce : si un niveau d'approbation ne correspond à aucun login seedé, `admin@` peut approuver n'importe quel niveau.
> 🔒 Règle d'or démontrée : **séparation des tâches** (le demandeur ≠ les valideurs).

---

### Étape 4 — Bon de commande _(login `acheteur@`)_

`Achats → Bons de commande → Nouveau` (ou, depuis la DA approuvée, *Créer le BC*).

| Champ | Valeur |
|---|---|
| Depuis la DA | la DA approuvée à l'étape 3 |
| Fournisseur | **FOURN-BIOMED** (sélecteur) |
| Incoterm / adresse | _facultatif_ |

➡️ Le BC est créé en statut `draft`, reprenant la ligne et l'imputation de la DA.

---

### Étape 5 — Envoyer le BC → engagement comptable _(login `acheteur@`)_

Ouvrir le BC → **Envoyer**. Statut → `sent`.

➡️ **Résultat attendu** : une **écriture d'engagement classe 8** est générée automatiquement (débit `801` engagement donné / crédit `809` contre-engagement), imputée à la convention. Vérifiable via *BC → Écritures liées*.

> 🔒 Règle d'or démontrée : **comptabilité d'engagement** (un BC validé crée une écriture classe 8).

---

### Étape 6 — Réception (Goods Receipt) _(login `magasinier@`)_

`Achats → Réceptions → Nouvelle réception` depuis le BC.

- Réceptionner **la totalité** (5 boîtes).
- **Terminer la réception**. Statut → `completed`.

➡️ Le service fait est constaté ; la facture pourra être rapprochée (3-way).

---

### Étape 7 — Facture fournisseur _(login `compta@`)_

`Comptabilité → Factures` → importer/saisir une facture, **rattachée au BC**.

| Champ | Valeur |
|---|---|
| Fournisseur | FOURN-BIOMED |
| Numéro facture | `FAC-BIOMED-2026-001` |
| Date facture | 2026-05-15 |
| Échéance | 2026-06-14 |
| **Ligne — compte SYSCEBNL** | **`604`** ⚠️ (= catégorie *SUPPLIES* du template) |
| Montant HT | 60000 |
| TVA (18 %) | 10800 |
| TTC | 70800 |

Puis **Soumettre** → le **rapprochement 3-way** (BC ↔ réception ↔ facture) passe → statut `matched`.

> ⚠️ **Le compte `604` est l'élément critique** : il garantit que le montant tombera dans une catégorie mappée du rapport. Si tu utilises la convention seedée (raccourci §4), c'est ici que tu **dois** le saisir.

---

### Étape 8 — Comptabiliser la facture _(login `compta@`)_

Ouvrir la facture `matched` → **Comptabiliser**. Statut → `posted`.

➡️ **Résultat attendu** (écriture AC) :

```
D  604  Achats consommables ........ 60 000   (imputée convention USAID)
D  445  TVA déductible ............. 10 800
   C  401  Fournisseurs ............ 70 800
```

\+ **extourne automatique de l'engagement classe 8** créé à l'étape 5.

> 🔒 Règles d'or démontrées : écriture en **classe 6/4** sur facture ; **piste d'audit** (chaînage hash) ; impossible de poster dans une **période close**.

---

### Étape 9 — Rapport bailleur _(login `cg@`, puis `daf@`)_

`Reporting → Rapports bailleur → Nouveau rapport`

| Champ | Valeur |
|---|---|
| Convention | USAID-IPD-2026-01 |
| Template | **USAID-FFR425** |
| Période début | 2026-01-01 |
| Période fin | 2026-06-30 |

**Générer**. ➡️ **Résultat attendu** : la ligne **SUPPLIES = 60 000 XOF** (issue du compte `604`), les autres catégories à 0, total cohérent.

Puis **Verrouiller** (`cg@`) → statut `locked`, puis **Envoyer** (`daf@`, réf. d'envoi ex. `USAID-FFR-2026-S1`) → statut `sent`.

> 🔒 Règle d'or démontrée : l'**envoi** est réservé au DAF (séparation contrôleur ≠ envoyeur). Export PDF/Excel disponibles sur le rapport verrouillé.

**Bonus RBAC bailleur (F5b-a)** : reconnecte-toi en `bailleur@` (Bailleur#2026). Le compte ne voit **que les rapports `sent`** — un rapport `draft`/`locked` renvoie 404, et même son PDF/Excel est inaccessible tant qu'il n'est pas envoyé (filtre serveur, pas seulement UI). C'est une belle démonstration de cloisonnement pour le jury.

---

## 6. Points de contrôle métier démontrés (pour le mémoire / jury)

- **Imputation analytique à la source** (étape 2) : projet + convention + ligne budgétaire dès la DA.
- **Contrôle budgétaire bloquant** (étape 2) : la DA ne passe que si le solde de ligne est suffisant.
- **Comptabilité d'engagement** (étapes 5 & 8) : engagement classe 8 à l'envoi du BC, extourné à la comptabilisation de la facture.
- **Rapprochement 3-way** (étape 7) : BC ↔ réception ↔ facture.
- **Séparation des tâches** (étapes 2-3, 9) : saisisseur ≠ valideur ; contrôleur (verrouille) ≠ DAF (envoie).
- **Multidevises** : convention en USD, comptabilité en XOF.
- **Traçabilité du rapport** : mapping compte SYSCEBNL → catégorie bailleur, verrouillage immuable, référence d'envoi.

---

## 7. Captures à prendre (livrable F5a)

1. **Liste des templates** (`Reporting → Templates`).
2. **Détail d'un template** (`USAID-FFR425`) avec l'arbre des catégories + table des mappings.
3. **Liste des rapports bailleur** (avec le rapport `sent`).
4. **Assistant de création** du rapport — étape 3 (récap convention + template + période).
5. **Détail du rapport** généré — ligne **SUPPLIES = 60 000**, totaux, badge `sent`.

Bonus jury : la **convention** (tableau des emplois après amorce), le **BC envoyé** + son écriture classe 8, l'**écriture AC** de la facture.

---

## 8. Écarts identifiés pendant la préparation (→ backlog)

| Écart | Statut | Piste / résolution |
|---|---|---|
| Pas d'utilisateur seedé pour **ACHETEUR / MAGASINIER / BAILLEUR** | ✅ **Résolu** (sprint amorce-démo) | 3 users ajoutés dans `seed.ts` + `realm.json` (ré-import realm requis) |
| **Pas d'écran de création fournisseur** | 🟡 **Partiel** | 3 fournisseurs désormais seedés (`seed/suppliers.json`) ; reste à livrer l'écran `Référentiel → Fournisseurs` (CRUD) |
| **Pas d'écran de saisie des lignes budgétaires** d'une convention | ❌ **Ouvert** | Une convention créée en UI naît sans budget → amorce script. Cible : section éditable dans le détail convention (CONTROLEUR) |
| Compte de charge par défaut **`605` non mappé** | ❌ **Ouvert** | Soit mapper `605`, soit imposer `default_account` à la création de ligne |
| **RBAC BAILLEUR** = voile UI uniquement | ✅ **Résolu** (F5b-a, Lot 1 + 1b) | Routes lecture gardées par `@Roles(...'BAILLEUR')` + filtre serveur (`status='sent'` pour donor-reports, `locked=true` pour états) ; canal PDF/Excel également fermé |

---

## 9. Et après

Le **backend F5b-a est livré** (sur `main`) : clôture mensuelle (avec FNP/Factures Non Parvenues + régularisations CCA/PCA), états SYSCEBNL `TER` / `BILAN` / `RESULTAT` / `FONDS_DEDIES`, et le **correctif RBAC BAILLEUR** (filtre serveur + fermeture du canal PDF/Excel).

**F5b-b** est désormais livré (sur la branche `sprint-F5b-b`) : les **écrans** correspondants sont en place et utilisables de bout en bout via la sidebar.

### Comment exercer la clôture mensuelle (sprint F5b-b)

1. **COMPTABLE / CONTROLEUR / DAF** → sidebar **« Clôture »** (`/accounting/periods`).
2. Choisir une période ouverte → page détail.
3. **Lancer le précheck** (bouton dédié) → la liste des findings BLOCKING (C001..C006) / WARNING (W001..W003) s'affiche regroupée. Un finding vide affiche « ✓ Période prête à clôturer ».
4. **Régulariser** via les 3 cards :
   - **FNP** : bouton « Passer les FNP » (auto, idempotent) — débit charge / crédit 408 + extourne automatique au 1er jour de la période suivante.
   - **CCA / PCA** : formulaire dynamique (ajout/suppression d'entrées) — direction (CCA → 476, PCA → 477) + compte, montant, libellé, imputation analytique optionnelle.
   - **Fonds dédiés** : bouton « Calculer les fonds dédiés » — dotation 689/19 si ressources > dépenses, reprise 19/789 sinon.
5. **Clôturer** (CONTROLEUR / DAF) → dialog :
   - 0 finding bloquant : motif optionnel, validation directe.
   - Findings bloquants + DAF : checkbox d'override **obligatoire** + motif ≥ 5 caractères.
   - Findings bloquants + CG : bouton désactivé, message « Seul un DAF peut overrider ».
6. **Ré-ouvrir** (DAF only) si besoin : dialog motif obligatoire ≥ 5 caractères, journalisé en `period_close_event`.

### Comment consulter les états financiers (sprint F5b-b)

1. **COMPTABLE / CONTROLEUR / DAF / BAILLEUR** → sidebar **« États financiers »** (`/reporting/statements`).
2. Filtrer par période + type. Le BAILLEUR ne voit nativement que les états `locked=true` (filtre serveur F5b-a Lot 1).
3. **Générer un état** (COMPTABLE+) : dialog → choisir période + type (TER / BILAN / RESULTAT / FONDS_DEDIES) → redirige vers le détail.
4. Le détail affiche :
   - **TER / BILAN / RESULTAT** : 2 sections côte à côte (Emplois/Ressources, Actif/Passif, Charges/Produits) + badge Équilibré/Déséquilibré + (pour RESULTAT) bandeau Résultat net.
   - **FONDS_DEDIES** : 3 cards de synthèse (Reçu 75x / Employé 6x / Restant), bandeau rapprochement 689/19 (vert si équilibré, rouge avec écart sinon), 2 sections (`GRANTS` + `RAPPROCHEMENT_689_19`), 2 cards footer (total dotations / total reprises).
5. **Verrouiller** (DAF / SUPER_ADMIN) : dialog avec warning sur l'immutabilité — après lock, plus aucune régénération possible si la période est elle-même close (trigger DB).
6. **Télécharger PDF / Excel** : disponibles dès que les `pdfObjectKey` / `xlsxObjectKey` existent (générés au lock).

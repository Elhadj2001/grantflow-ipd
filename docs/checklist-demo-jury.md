# Checklist de démonstration — GRANTFLOW IPD (jour J / jury)

> Parcours Procure-to-Account complet, rôle par rôle, avec ce qu'il faut **capturer** à chaque étape.
> Cocher `[x]` au fur et à mesure. Chaque changement de profil passe par une **déconnexion** (logout fédéré → Keycloak redemande les identifiants).

---

## 0. Pré-requis (à faire AVANT la démo)

- [ ] Stack lancée : `docker compose up -d postgres redis minio keycloak mailhog`
- [ ] Schéma appliqué : `psql -h localhost -p 5433 -U grantflow -d grantflow_dev -f docs/grantflow_ddl_postgresql.sql`
- [ ] Données : `cd apps/api && npm run prisma:generate && npm run prisma:seed`
- [ ] **Ré-import du realm Keycloak** (sinon acheteur@/magasinier@/bailleur@ ne peuvent pas se connecter) :
      `docker compose stop keycloak && docker compose rm -f keycloak && docker compose up -d keycloak`
- [ ] App lancée : `npm run dev` (api + web), puis **hard refresh** du navigateur (Ctrl+Shift+R)
- [ ] Logo présent : `apps/web/public/logo-ipd.png` visible dans la sidebar + page login
- [ ] (Option OCR Vision) `apps/api/.env` : `ANTHROPIC_API_KEY=…` + `OCR_PROVIDER=auto` (sinon laisser `pdfparse`)
- [ ] Onglet **MailHog** ouvert : `http://localhost:8025` (pour les e-mails de mot de passe)
- [ ] Facture de démo sous la main : `docs/demo/facture-demo-FOURN-BIOMED.pdf`

**Comptes (rappel)** — tous en `@pasteur.sn` :

| Rôle | Login | Mot de passe |
|---|---|---|
| SUPER_ADMIN | `admin@` | `Admin#2026` |
| CONTROLEUR (CG) | `cg@` | `Cg#2026-IPD` |
| DEMANDEUR | `amadou@` | `Demandeur#2026` |
| PI | `pi@` | `Pi#2026-IPD` |
| DAF | `daf@` | `Daf#2026-IPD` |
| ACHETEUR | `acheteur@` | `Acheteur#2026` |
| MAGASINIER | `magasinier@` | `Magasinier#26` |
| COMPTABLE | `compta@` | `Compta#2026` |
| BAILLEUR | `bailleur@` | `Bailleur#2026` |

**Données du scénario** : convention `USAID-IPD-2026-01` · bailleur **USAID** · projet **MADIBA-VAC-2024** · fournisseur **FOURN-BIOMED** · template **USAID-FFR425** · compte de charge **604**.

---

## 1. Référentiel & convention — _login `cg@`_

- [ ] Sidebar **Bailleurs** (`/referential/donors`) : vérifier que `USAID` existe (sinon le créer). 📸 *capture liste bailleurs*
- [ ] Sidebar **Projets** (`/referential/projects`) : vérifier `MADIBA-VAC-2024` (sinon le créer).
- [ ] Sidebar **Fournisseurs** (`/referential/suppliers`) : `FOURN-BIOMED` présent (seedé). 📸 *capture*
- [ ] **Pilotage → Conventions → Nouvelle convention** :
  - Référence `USAID-IPD-2026-01`, **Bailleur** = USAID (liste déroulante), **Projet** = MADIBA-VAC-2024 (liste déroulante — plus aucun UUID à taper ✅)
  - Montant `300000`, Devise `USD`, Overhead `0.10`, début `2026-01-01`, fin `2027-12-31`, statut `active`
  - 📸 *capture formulaire avec les pickers (pas de champ UUID)*
- [ ] Dans le détail de la convention → section **lignes budgétaires**, ajouter (avec `default_account`) :
  - `L01` Consommables labo — `90000` — compte **604**
  - `L03` Personnel scientifique — `150000` — compte **661**
  - `L04` Missions/déplacements — `40000` — compte **61**
  - 📸 *capture tableau des emplois rempli*

> 🔒 **Point jury** : imputation analytique structurée dès la convention ; création self-service des référentiels (plus de saisie d'UUID).

---

## 2. Demande d'achat — _login `amadou@` (DEMANDEUR)_

- [ ] **Achats → Demandes d'achat → Nouvelle DA** : Type `standard`, Projet MADIBA-VAC-2024, Convention USAID-IPD-2026-01, Devise `XOF`
- [ ] Ligne : « Réactifs PCR SARS-CoV-2 », qté `5`, PU `12000`, **ligne budgétaire L01**
- [ ] ➡️ le **contrôle budgétaire** s'affiche (60 000 < 90 000 → ✅ vert). 📸 *capture du contrôle budgétaire*
- [ ] Enregistrer → **Soumettre** (statut `submitted`)

> 🔒 **Point jury** : contrôle budgétaire bloquant + imputation obligatoire à la source.

---

## 3. Validation de la DA — _login `pi@` puis `daf@`_

- [ ] `pi@` : **Achats → En attente de mon approbation** → ouvrir la DA → **Approuver**
- [ ] (si étape contrôleur demandée : `cg@` approuve aussi)
- [ ] `daf@` : approuver → statut **`approved`**. 📸 *capture circuit d'approbation*

> 🔒 **Point jury** : séparation des tâches (demandeur ≠ valideurs).

---

## 4. Bon de commande → engagement — _login `acheteur@` (ACHETEUR)_

- [ ] **Achats → Bons de commande** : créer le BC depuis la DA approuvée, Fournisseur **FOURN-BIOMED** (e-mail `achats@biomed-sn.demo` seedé)
- [ ] BC en `draft` → **Envoyer** → statut `sent` + toast « BC envoyé au fournisseur (a*****@biomed-sn.demo) ». 📸 *capture toast envoi*
- [ ] ➡️ vérifier l'**écriture d'engagement classe 8** (801/809) via *BC → Écritures liées*. 📸 *capture écriture classe 8*
- [ ] **Ouvrir MailHog** (`http://localhost:8025`) → mail « Bon de commande … » reçu à `achats@biomed-sn.demo` → ouvrir → **PDF du BC en pièce jointe**. 📸 *capture MailHog avec le PDF reçu* (la boucle « envoi réel au fournisseur » bouclée pour le jury)
- [ ] **Noter le numéro du BC** (utile à l'étape facture)

> 🔒 **Point jury** : comptabilité d'engagement (BC validé → classe 8) **+ dispatch du PDF au fournisseur** par e-mail. Best-effort : si le fournisseur n'a pas d'e-mail, l'engagement est créé quand même (toast « aucun e-mail renseigné »).

---

## 5. Réception (scan magasinier) — _login `magasinier@` (MAGASINIER)_

- [ ] Sidebar **Réception** (`/procurement/reception-rapide`)
- [ ] Sélectionner le BC → réceptionner **5 boîtes** (scan caméra OU **saisie manuelle du code** via le champ rapide — pas besoin de scanner physique)
- [ ] **Terminer la réception** → statut `completed`. 📸 *capture réception scan*
- [ ] (Bonus) **Inventaire / Scan** (`/procurement/inventaire-scan`) : scanner un QR de carton → provenance + péremption. 📸 *capture*

> 🔒 **Point jury** : réception terrain + traçabilité lot/péremption.

---

## 6. Facture fournisseur — _login `compta@` (COMPTABLE)_

> 💡 **Pas de vrai fournisseur ?** Utiliser le **simulateur** depuis la fiche
> du BC (`sent`) — bouton « Simuler la facture fournisseur (démo) », visible
> si `ENABLE_DEMO_INVOICE_SIMULATOR=true`. Deux modes :
> **Mode A (Télécharger)** → récupère le PDF puis le re-uploader ci-dessous
> pour la **démo OCR Vision** ; **Mode B (Injecter)** → crée directement la
> facture en statut Capturée (pratique pour les **répétitions**).
> Détails : `docs/demo-features.md`.

- [ ] **Comptabilité → Factures → Uploader** (`/accounting/invoices/upload`) : déposer `facture-demo-FOURN-BIOMED.pdf`, pré-sélectionner FOURN-BIOMED
  - (Bonus OCR Vision : déposer une **facture scannée** pour montrer l'extraction Vision en mode `auto`) 📸 *capture OCR (champs extraits + confiance)*
- [ ] Sur la page détail : l'**aperçu PDF s'affiche** (fix sandbox blob) 📸 *capture aperçu*
- [ ] **Rattacher la facture au BC** (sinon `submit` renvoie 409 `INVOICE_NO_PO_LINKED`)
- [ ] Vérifier/corriger les champs ; **compte de charge = `604`** ⚠️ (sinon le rapport bailleur affichera 0)
- [ ] HT `60000`, TVA `10800`, TTC `70800` → **Soumettre** → rapprochement **3-way** → statut `matched`. 📸 *capture matching 3-way*
- [ ] **Comptabiliser** → statut `posted`
- [ ] ➡️ écriture AC : `D 604 / D 445 / C 401` + **extourne de l'engagement classe 8**. 📸 *capture écriture classe 6/4*

> 🔒 **Point jury** : 3-way match, écriture classe 6/4, extourne de l'engagement, piste d'audit.

---

## 7. Rapport bailleur — _login `cg@` puis `daf@`_

- [ ] `cg@` : **Reporting → Rapports bailleur → Nouveau** : Convention USAID-IPD-2026-01, Template **USAID-FFR425**, période `2026-01-01` → `2026-06-30`
- [ ] **Générer** → ligne **SUPPLIES = 60 000 XOF** (issue du compte 604), autres catégories à 0. 📸 *capture détail rapport*
- [ ] **Verrouiller** (`cg@`) → `locked`
- [ ] `daf@` : **Envoyer** (réf. ex. `USAID-FFR-2026-S1`) → `sent`. 📸 *capture badge sent + export PDF/Excel*

> 🔒 **Point jury** : mapping compte→catégorie, verrouillage immuable, envoi réservé au DAF.

---

## 8. Cloisonnement bailleur (RBAC) — _login `bailleur@` (BAILLEUR)_

- [ ] La sidebar **ne montre pas** Clôture / Fournisseurs / Utilisateurs / listes internes. 📸 *capture sidebar bailleur*
- [ ] **Reporting** : seul le rapport **`sent`** est visible (un `draft`/`locked` → 404, même son PDF). 📸 *capture*
- [ ] Tenter une URL interne (ex. `/treasury/payment-runs`) → redirection/refus.

> 🔒 **Point jury** : séparation des tâches appliquée côté **API et UI** (pas qu'un voile visuel).

---

## 9. Administration des utilisateurs — _login `admin@` (ou `daf@`)_

- [ ] Sidebar **Utilisateurs** (`/admin/users`) : liste des 11 comptes + statut actif/inactif. 📸 *capture*
- [ ] **Créer un utilisateur** (e-mail + rôles) → message « e-mail de définition de mot de passe envoyé » → le récupérer dans **MailHog** (`:8025`). 📸 *capture création + mail MailHog*
- [ ] Démontrer **activer/désactiver** + **réinitialiser le mot de passe** sur un compte seedé (ex. `compta@`).

> 🔒 **Point jury** : gestion des comptes intégrée (plus besoin de la console Keycloak), hybride Keycloak + base.

---

## 10. (Bonus) Clôture mensuelle & états SYSCEBNL — _login `cg@`/`daf@`_

- [ ] **Clôture** (`/accounting/periods`) → ouvrir une période → **Lancer le précheck** (findings C001–C006 / W001–W003). 📸 *capture findings*
- [ ] Régularisations : **FNP**, **CCA/PCA**, **Fonds dédiés** (boutons dédiés)
- [ ] **Clôturer** (CG/DAF, motif) — montrer le dialog override DAF si findings bloquants
- [ ] **États financiers** (`/reporting/statements`) : générer **TER**, **BILAN**, **RESULTAT**, **FONDS_DEDIES**, puis **Verrouiller** (DAF) + export PDF/Excel. 📸 *capture chaque état*

> 🔒 **Point jury** : clôture SYSCEBNL complète + états réglementaires.

---

## Pièges à éviter (vécus en test)

- **Changement de profil** : toujours **se déconnecter** entre deux rôles (le logout fédéré force Keycloak à redemander les identifiants ; `prompt=login` actif en dev).
- **Facture → 409** : bien **rattacher le BC** avant `Soumettre` ; mettre le compte **604**.
- **Mots de passe / invitations** : les e-mails partent vers **MailHog** (`:8025`), pas vers une vraie boîte.
- **Aperçu PDF** : si rien ne s'affiche, vérifier que le serveur web a rechargé (fix `sandbox=allow-same-origin`).
- **OCR Vision** : nécessite `ANTHROPIC_API_KEY` en `.env` + `OCR_PROVIDER=auto|vision` + un modèle valide (`OCR_VISION_MODEL` ou défaut interne). Sinon rester en `pdfparse`.

---

## Ordre de capture conseillé (livrable mémoire)

1. Convention + lignes budgétaires (CG)
2. Contrôle budgétaire de la DA (DEMANDEUR)
3. Écriture d'engagement classe 8 (ACHETEUR)
4. Réception scan (MAGASINIER)
5. OCR facture + matching 3-way + écriture classe 6/4 (COMPTABLE)
6. Rapport bailleur `sent` (CG/DAF)
7. Cloisonnement bailleur (BAILLEUR)
8. Écran admin utilisateurs (ADMIN)
9. États SYSCEBNL (CG/DAF) — bonus

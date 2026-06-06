# Note de cadrage — Phase 0
## GRANTFLOW IPD — Mémoire MIAGE 2025/2026

**Auteur** : El Hadj Amadou NIANG
**Encadrement académique** : à compléter
**Version** : 1.0 — 02 juin 2026
**Statut** : Document de référence pour les phases 1 à 8 du projet
**Périmètre** : Cadrage stratégique et méthodologique, mapping métier IPD, plan d'action 12 mois

---

## Préambule

### Objet du document

Cette note de cadrage formalise les fondations du projet GRANTFLOW IPD pour son cycle de développement final, du 02 juin 2026 à la soutenance de mémoire prévue en mai 2027. Elle consolide trois sources d'information :

1. La **présentation interne de l'Institut Pasteur de Dakar** intitulée *Présentation Gestion de Projet et Conventions de Recherche — Budget des conventions de recherche et des comptes rendus financiers*, qui décrit le processus opérationnel réel de la Direction Administrative et Financière (DAF) et du Grant Office (GO).
2. L'**audit transversal en lecture seule** réalisé sur la base de code GRANTFLOW IPD au 02 juin 2026, dont le rapport identifie 28 findings classés par sévérité (critique, majeur, mineur).
3. La **littérature professionnelle** sur les ERP financiers du secteur recherche et NGO : SAP Public Sector Management (PSM/PSCD), Oracle Grants Accounting, Sage Intacct Nonprofit, Serenic Navigator, FundEZ, Workday Adaptive Grants, complétée par les référentiels OHADA/SYSCEBNL et les standards d'audit ISA 315 et COSO 2013.

Ce document n'est pas un cahier des charges figé : c'est une **base de discussion académique avec le directeur de mémoire**, un **outil de pilotage** pour l'auteur, et la future **annexe méthodologique du mémoire**.

### Méthodologie de construction

Le projet entre dans une phase qui n'est plus celle de l'exploration mais de la consolidation. La méthodologie retenue est inspirée des cycles V industriels et des méthodes agiles : un cadrage initial fort (cette note), un découpage en phases livrables, des sprints de deux semaines, une rédaction du mémoire en parallèle continu plutôt qu'en aval.

Les hypothèses métier non encore validées avec l'IPD réelle sont **explicitement marquées comme telles** dans le texte avec la notation *(hypothèse — à valider)*. Elles sont ancrées sur les patterns ERP standards du secteur, qui constituent une base académiquement défendable en l'absence de validation utilisateur directe. Une fois le contact établi avec la DFC IPD (post-mémoire ou en parallèle si possible), ces hypothèses seront confrontées au réel.

### Posture vis-à-vis de la dette technique

Le projet a accumulé une dette technique inévitable lors des sprints de mise en service de la démo de validation. Cette dette n'est pas un échec mais le sous-produit normal d'un développement itératif sous pression. La Phase 0 acte cette dette, la priorise, et planifie sa résorption méthodique, plutôt que de la masquer.

---

# Partie I — Le domaine métier IPD

## 1. Contexte institutionnel

L'Institut Pasteur de Dakar (IPD) est un institut de recherche en biologie, microbiologie et santé publique, membre du Réseau International des Instituts Pasteur (RIIP). Sa Direction Administrative et Financière (DAF) opère selon le référentiel comptable **SYSCEBNL** issu de l'Acte uniforme OHADA relatif aux organisations à but non lucratif, dans un environnement de fiscalité sénégalaise et de tenue comptable en Franc CFA UEMOA (XOF).

L'activité de recherche est financée majoritairement par des **bailleurs internationaux** — USAID, Wellcome Trust, Bill & Melinda Gates Foundation, NIH/DHHS, Union Européenne (Horizon Europe, EDCTP), Pasteur Network — qui contractualisent avec l'IPD via des **conventions de recherche** dotées chacune de leur propre devise, calendrier, contraintes d'éligibilité et règles de reporting.

L'organigramme financier impliqué dans le cycle Procure-to-Account des projets de recherche inclut au minimum les rôles suivants : le **Principal Investigator (PI)** scientifique responsable du projet, le **Grant Office (GO)** qui assure l'interface administrative et budgétaire entre les bailleurs et l'opérationnel, le **DAF** qui valide les engagements financiers significatifs et signe les rapports, le **Directeur** qui co-signe les rapports financiers et arbitre les dépenses majeures, le **Contrôleur de gestion (CG)** qui vérifie l'imputation analytique et la disponibilité budgétaire, le **Comptable** qui enregistre les écritures et clôture les périodes, le **Trésorier** qui exécute les paiements, le **Caissier** qui gère la caisse menue, le **Magasinier** qui réceptionne les biens, l'**Acheteur** qui passe les bons de commande, et le **Demandeur** qui initie les demandes d'achat. À ces rôles internes s'ajoutent les **auditeurs externes** mandatés sur certaines conventions.

## 2. La convention de recherche comme objet métier central

### 2.1 Nature juridique et opérationnelle

Selon le PPT IPD, *« la convention est un contrat signé entre un organisme financier et l'Institut Pasteur de Dakar »*. Elle constitue à la fois un instrument juridique liant deux entités, un cadre budgétaire encadrant des fonds dédiés à une finalité scientifique précise, et un référentiel d'éligibilité contraignant chaque dépense future.

Une fois signée, la convention est transmise au DAF et au Grant Office. Le PI conserve les originaux côté laboratoire. De cette signature naissent des obligations qui structurent l'ensemble du cycle de vie du projet : respect des natures de dépenses autorisées, respect de la fenêtre temporelle d'utilisation des fonds, application correcte du taux de frais généraux contractuel. Le PPT signale explicitement que *« certaines conventions excluent les frais généraux des prestations de sous-traitance »* et que *« d'autres conventions n'autorisent aucun frais général »* — ce qui implique que la règle d'overhead ne peut pas être globale au système mais doit être paramétrée par convention, avec une granularité par catégorie de dépense.

### 2.2 La Note Technique : artefact pivot du Grant Office

L'élément le plus structurant révélé par le PPT IPD est l'existence d'un objet métier non capturé par la version actuelle de GRANTFLOW : la **Note Technique**. Citation directe : *« Le code budgétaire est créé après la réception de la convention et de la Note Technique. La note technique est rédigée par le GO après réception de la convention. »*

La Note Technique est la traduction opérationnelle de la convention en infrastructure budgétaire activée dans le système. Elle contient : le code budgétaire propre à la convention, les échéances de reporting intermédiaires et finales, la répartition budgétaire en grandes lignes (fonctionnement, équipement, personnel, missions), le détail granulaire (nombre de meetings par an, listes des équipements à acquérir comme un thermocycleur PCR ou des ordinateurs, listes des consommables de laboratoire — référence DHHS du PPT —, listes des réactifs, nombre de déplacements), et le cas échéant la **contribution sur fonds propres** que l'IPD s'engage à apporter au projet et qui doit être tracée séparément des fonds bailleur.

L'absence de cette entité dans GRANTFLOW actuel a deux conséquences. Premièrement, le workflow d'activation budgétaire d'une convention n'est pas formalisé — aujourd'hui les lignes budgétaires sont créées implicitement sans étape de validation GO/DAF. Deuxièmement, les contraintes spécifiques à chaque convention (nature autorisée, plafond par ligne, dates valides) sont diluées dans la logique métier au lieu d'être centralisées dans un **eligibility engine** qui s'appuie sur la Note Technique comme source de vérité.

### 2.3 Maquette de rapport bailleur

Toujours selon le PPT, *« la transmission en début de projet d'un modèle de rapport financier à respecter »* est un acte explicite. Chaque bailleur fournit son propre format de reporting — qui doit être utilisé tel quel et **ne peut pas être modifié** par l'IPD. À titre indicatif et sans validation IPD à ce stade : USAID utilise typiquement le formulaire FFR (Federal Financial Report) SF-425, Wellcome Trust utilise son propre Grants Financial Report, l'Union Européenne sur Horizon impose le Form C (Financial Statement Form), DHHS utilise des templates spécifiques à ses subventions.

Cette diversité impose à GRANTFLOW une architecture de **templates de rapport configurables par convention**, avec un mapping entre les lignes du template et les natures de dépenses du système. La génération doit produire un **PDF signé numériquement par le Directeur et le DAF** ainsi qu'un **fichier Excel** raw simultanément, comme indiqué par le PPT : *« Transmission des rapports financiers au Bailleur, en pdf signés du Directeur Administratif et Financier et du Directeur et en fichier Excel »*.

### 2.4 Mécanisme d'ajustement des rapports déjà transmis

Le PPT contient une règle structurante de comptabilité réglementaire : *« Ne pas modifier les comptes rendus financiers déjà transmis ; au besoin ajouter une colonne d'ajustement et présenter un nouveau total »*. C'est un principe d'**immutabilité du publié** avec **versioning par ajustement explicite**, comparable au principe d'écritures rectificatives en comptabilité d'engagement. Le système doit produire des **versions successives** du rapport, conservant la trace de la version transmise, et exposant les corrections sous forme de colonnes d'ajustement annotées.

## 3. Acteurs et responsabilités

Le tableau suivant consolide les acteurs identifiés dans le PPT et dans la pratique standard NGO, avec leur responsabilité dans le cycle de vie d'une convention.

| Acteur | Responsabilités principales |
|---|---|
| **Bailleur** | Sélectionne et finance les projets ; reçoit les rapports financiers et scientifiques signés ; mandate ou non les audits externes |
| **Directeur (DG ou Dir. scientifique)** | Co-signe avec le DAF les rapports financiers transmis au bailleur ; arbitre les dépenses majeures ; valide les avenants conventionnels |
| **DAF** | Réceptionne la convention signée ; valide la Note Technique ; signe les rapports financiers ; valide les engagements significatifs ; supervise la clôture |
| **Grant Office (GO)** | Réceptionne la convention avec le DAF ; rédige la Note Technique ; assure l'interface avec les bailleurs ; suit les échéances ; coordonne la production des rapports |
| **Principal Investigator (PI)** | Initie scientifiquement le projet ; conserve les originaux des conventions ; valide les demandes d'achat de son projet ; rend compte scientifiquement au bailleur |
| **Contrôleur de gestion (CG)** | Vérifie l'imputation analytique et la disponibilité budgétaire à chaque engagement ; détecte les écarts |
| **Comptable** | Enregistre les écritures comptables ; rapproche les comptes ; produit les états SYSCEBNL ; pilote la clôture mensuelle et annuelle |
| **Trésorier** | Prépare et exécute les paiements fournisseurs ; gère la trésorerie projetée |
| **Caissier** | Gère la caisse menue (petty cash) ; encaisse et décaisse les espèces ; rapproche la caisse |
| **Magasinier** | Réceptionne physiquement les biens commandés ; produit les bons de livraison ; tient l'inventaire |
| **Acheteur** | Émet les bons de commande à partir des demandes d'achat approuvées ; négocie avec les fournisseurs ; suit la commande jusqu'à réception |
| **Demandeur** | Initie une demande d'achat avec imputation analytique complète (projet, grant, ligne budgétaire, centre de coût, activité) |
| **Auditeur externe** | Mandaté sur les conventions dont l'audit est contractuel ; produit des mission letters et rapports d'audit signés |

## 4. Workflows clés à supporter

Le système GRANTFLOW doit supporter au minimum les workflows opérationnels suivants, dont la couverture actuelle est partielle.

### 4.1 Workflow d'activation d'une convention

La convention est signée par le bailleur et l'IPD. Le DAF et le GO la réceptionnent. Le GO rédige la Note Technique, qui passe en validation DAF puis Directeur. Une fois validée, le code budgétaire est créé dans GRANTFLOW, les lignes budgétaires sont activées avec leurs plafonds, leur fenêtre temporelle, leur règle d'overhead applicable, et leur liste de natures de dépenses éligibles. La maquette de rapport bailleur est associée à la convention. Les échéances de reporting (intermédiaires et finales) sont calendarisées et déclenchent des rappels automatiques à approche.

### 4.2 Workflow Procure-to-Account standard

Le demandeur initie une DA avec imputation analytique complète. Le système valide en temps réel les contraintes d'éligibilité contre la Note Technique : la nature est-elle autorisée ? La date d'engagement tombe-t-elle dans la fenêtre conventionnelle ? Le plafond de ligne est-il respecté ? Le matériel a-t-il déjà été remboursé par Institut Pasteur Paris (cas mentionné dans le PPT) ? La DA suit ensuite le circuit d'approbation hiérarchique par seuil : PI seul en deçà de 500 000 XOF, PI puis CG entre 500 000 et 5 000 000 XOF, PI puis CG puis DAF au-delà. L'approbation finale déclenche l'engagement classe 8 en comptabilité d'engagement avec l'équivalent XOF si la convention est en devise étrangère.

L'acheteur transforme ensuite la DA approuvée en bon de commande, sélectionne le fournisseur, et envoie le BC par mail. La réception physique est enregistrée par le magasinier qui produit le Goods Receipt. La facture fournisseur est réceptionnée par le service comptable, soit en saisie manuelle, soit via OCR Vision, et matchée avec le BC + GR (three-way matching). L'écriture comptable de classe 4/6 est passée. Le trésorier inclut la facture dans un payment run, l'exécute (virement, chèque ou espèces), et l'écriture de paiement est enregistrée.

### 4.3 Workflow de reporting bailleur

À l'approche de l'échéance définie dans la Note Technique, le système alerte le Grant Office. Le GO génère le rapport financier à partir de la maquette bailleur, en utilisant la devise de la convention (avec équivalents XOF pour audit interne). Le rapport extrait les dépenses imputées au projet sur la période, séparant les engagements des décaissements, intégrant la contribution sur fonds propres si applicable. Le système valide l'absence d'engagements non facturés (interdit selon le PPT), de dépenses dépassant les lignes, de natures inéligibles. Le rapport est revu par le GO puis transmis pour signature électronique au DAF et au Directeur. Le PDF signé est produit avec son équivalent Excel raw. Une copie des **factures d'achats** est jointe au PDF transmis à la DAF, conformément à la règle PPT en gras. Le rapport est transmis au bailleur via un canal défini (email sécurisé, portail bailleur, courrier).

Si une correction devient nécessaire après transmission, le GO ne modifie pas le rapport publié mais produit une **nouvelle version avec colonne d'ajustement** explicite et nouveau total.

### 4.4 Workflow d'audit conventionnel

Si la convention prévoit un audit, le système instancie un module d'audit dédié au moment de l'activation budgétaire. Le coût de l'audit est provisionné dans la ligne budgétaire dédiée. À l'approche de la date d'audit, le GO sélectionne un cabinet auditeur, génère une **mission letter** signée DAF/Directeur, l'envoie au cabinet. À réception du rapport d'audit signé par les auditeurs, le DAF appose sa signature et le Directeur la sienne. Le rapport d'audit est joint au compte rendu financier final transmis au bailleur.

Si la convention ne prévoit pas d'audit externe, le compte rendu financier annuel et intermédiaire est simplement co-signé par le DAF et le Directeur.

### 4.5 Workflow de clôture périodique

À la fin de chaque mois, le comptable lance la clôture mensuelle : passation des écritures de coupure (FNP — Factures Non Parvenues, CCA — Charges Constatées d'Avance, PCA — Produits Constatés d'Avance, dotations aux amortissements), rapprochements bancaires, contrôle des soldes intermédiaires, génération des états SYSCEBNL (balance générale, grand livre, journal). Une fois validée, la période est fermée et toute modification ultérieure est bloquée par le trigger PostgreSQL `gl.check_period_open`.

À la clôture annuelle, le système produit en complément le **Tableau des Emplois et Ressources (TER)** et les autres états SYSCEBNL réglementaires, l'état des fonds dédiés par convention, le bilan et le compte de résultat formatés.

## 5. Les "à ne pas faire" du PPT comme catalogue de contrôles

Le PPT IPD énonce dans sa slide 7 une liste de comportements interdits qui constituent en réalité le **catalogue de contrôles internes** que le système doit enforcer techniquement. Le tableau suivant convertit chaque interdiction en règle système.

| Interdiction PPT | Règle système GRANTFLOW |
|---|---|
| Déclarer des dépenses engagées non facturées (montant des commandes) | Le reporting ne sort que les factures comptabilisées ; les engagements restent en classe 8 séparée |
| Imputer les mêmes dépenses sur plusieurs projets | Contrainte d'unicité sur (facture, ligne_facture) ; alerte sur duplicate detection inter-projet |
| Imputer des dépenses inéligibles | Eligibility engine : validation nature de dépense ∈ natures_autorisées de la Note Technique |
| Dépasser les lignes budgétaires | `co.v_budget_tracking` + check pré-engagement, déjà partiellement en place |
| Imputer des dépenses sur la mauvaise ligne | Validation que la nature de dépense est cohérente avec la ligne budgétaire choisie |
| Imputer des dépenses remboursées par Institut Pasteur Paris | Flag `pasteur_paris_reimbursed` sur facture ; exclusion automatique du reporting bailleur |
| Imputer des dépenses antérieures ou postérieures à la convention | Validation date_engagement ∈ [convention.start_date, convention.end_date] |
| Modifier les comptes rendus financiers déjà transmis | Immutabilité des rapports publiés ; versioning par colonne d'ajustement |
| Utiliser un autre format que la maquette transmise | Templates de rapport stockés par convention, génération conforme uniquement |
| Refacturation des stocks inter-pôles non tracée | Module inter-center transfer avec écritures miroirs au consolidé |

Chaque ligne de ce tableau devrait faire l'objet d'au moins un test d'intégration dédié dans la suite Jest, prouvant que la règle est effectivement bloquée par le système. Ces tests ont une vertu pédagogique forte : ils documentent vivant le contrat fonctionnel du système.

---

# Partie II — Mapping PPT IPD vs GRANTFLOW actuel

## 6. Couverture par domaine

Le tableau suivant croise les domaines fonctionnels identifiés dans le PPT avec l'état de couverture de GRANTFLOW IPD au 02 juin 2026. Trois niveaux : **Couvert** (présent et fonctionnel), **Partiel** (présent mais incomplet ou avec dette identifiée), **Absent** (à créer).

| Domaine | État | Commentaire |
|---|---|---|
| Modélisation convention bailleur | Partiel | Entité `Grant` existante mais sans Note Technique associée |
| Note Technique GO | Absent | Entité, workflow rédaction, validation, versioning à créer |
| Lignes budgétaires conventionnelles | Couvert | Entité `BudgetLine` opérationnelle avec plafond et tracking |
| Règle d'overhead par convention | Partiel | Champ taux global ; granularité par catégorie à étendre |
| Catalogue natures de dépenses éligibles | Absent | Aujourd'hui pas de liaison Convention → Natures autorisées |
| Fenêtre temporelle de validité | Partiel | Dates de convention stockées ; contrôle pré-engagement à câbler |
| Contribution sur fonds propres | Absent | Catégorie de fonds à introduire ; traçabilité spécifique |
| Workflow approbation DA par seuil | Couvert | Matrice PI/CG/DAF avec conversion XOF correcte (post-fix 484839f) |
| Bon de commande | Couvert | Création, envoi mail, suivi |
| Goods Receipt | Couvert | Réception avec écarts |
| Three-way matching facture | Couvert | Matching BC-GR-Facture |
| OCR Vision factures | Partiel | Provider câblé en factory, peu testé en prod |
| Comptabilité d'engagement classe 8 | Partiel | Écritures créées mais équivalent XOF non stocké en multidevise |
| Comptabilité d'exécution classe 4/6 | Couvert | Posting service opérationnel |
| Caisse menue | Couvert | Workflow petty cash + cash_advance |
| Payment run | Couvert | Préparation et exécution paiements |
| Rapprochement bancaire | Absent | Module à créer (import CSV/MT940, matching, GUI reconciliation) |
| Clôture mensuelle | Partiel | Triggers période + état des comptes ; FNP/CCA/PCA à automatiser |
| États SYSCEBNL réglementaires | Partiel | Balance et grand livre ; TER, fonds dédiés, bilan formaté à créer |
| Templates de rapport bailleur | Absent | Aucune infrastructure de template configurable |
| Génération PDF signé Directeur + DAF | Absent | Signature électronique à introduire |
| Excel raw simultané | Partiel | Export Excel existe ; alignement maquette bailleur à câbler |
| Versioning rapport avec colonne ajustement | Absent | Mécanisme d'immutabilité du publié à concevoir |
| Module Audit conventionnel | Absent | Mission letters, rapports auditeurs, signatures à créer |
| Refacturation inter-pôles IPD | Absent | Transactions internes inter-cost-center à modéliser |
| Justificatifs typés par nature | Partiel | Stockage des pièces existe ; règles de complétude par type à câbler |
| RBAC et matrice de visibilité | Partiel | 5 fixes successifs ; matrice centralisée à finaliser |
| Audit trail SHA-256 | Couvert | Trigger `audit.compute_hash_chain` en place |
| Séparation des tâches (saisisseur ≠ valideur) | Absent | Contrôle par identité non enforced ; uniquement par rôle |
| i18n FR/EN UI | Absent | Tout en FR hardcodé |
| Localisation rapports bailleur | Absent | Conséquence : rapports en EN selon maquette à supporter |
| Tests automatisés | Partiel | Unitaires existants mais ~28 rouges suite refactor non répercuté |

Sur 30 domaines évalués : 8 couverts, 13 partiels, 9 absents. La couverture absolue (couvert + partiel) est de 70 %, mais la moitié des couvertures partielles cache des dettes structurelles identifiées par l'audit du 02 juin 2026.

## 7. Écarts critiques et leur trajectoire de résorption

Quatre écarts dominent le risque projet : la Note Technique et l'eligibility engine associé (sans quoi le système ne peut pas réellement empêcher les violations métier listées par le PPT), les templates de rapport bailleur (sans quoi le système ne sert pas le besoin de reporting qui est la finalité administrative numéro un selon le PPT), la séparation des tâches enforced par identité (exigence d'audit et de contrôle interne incontournable en environnement comptable), et la complétude des états SYSCEBNL réglementaires (sans le TER et l'état des fonds dédiés, le système ne peut pas remplacer un ERP comptable existant).

Ces quatre chantiers sont planifiés en Phase 5A du plan d'action présenté en partie V.

---

# Partie III — Hypothèses Q1-Q5 argumentées

Cette partie traite les cinq questions ouvertes identifiées par l'audit transversal du 02 juin 2026, en formulant pour chacune une position argumentée à la lumière du PPT IPD et des patterns ERP standards. Ces positions sont des **hypothèses méthodologiquement défendables** mais doivent in fine être confrontées à la DFC IPD réelle. Elles servent de base au développement Phases 1-5.

## 8. Q1 — Multidevise : XOF partout ou multidevise de bout en bout ?

### 8.1 Constat

Les conventions bailleur sont libellées dans la devise du bailleur (USD pour USAID, EUR pour Wellcome Trust et l'EU, GBP pour certains fonds britanniques, CHF pour des fonds suisses). La comptabilité SYSCEBNL impose une tenue en XOF (Article 1 de l'Acte uniforme OHADA). Les paiements opérationnels au Sénégal sont majoritairement en XOF, mais certaines factures fournisseurs internationaux sont en devises étrangères. Les rapports au bailleur sont produits dans la devise de la convention.

### 8.2 Position retenue

GRANTFLOW IPD adopte une architecture **multidevise tripartite** :

- **Devise transactionnelle** : devise réelle de l'opération (USD pour une convention USAID, EUR pour une facture fournisseur européen, XOF pour un paiement local).
- **Devise fonctionnelle** : XOF, devise de tenue comptable selon SYSCEBNL. Tous les soldes, balances et états réglementaires sont libellés en XOF.
- **Devise de reporting** : selon le contexte. Pour les rapports au bailleur, devise de la convention. Pour les états internes, XOF. Pour la consolidation Pasteur Network, à définir (potentiellement EUR).

Chaque montant stocké dans le système est accompagné de sa devise et de son équivalent XOF calculé à un taux et une date documentés. Les contrôles (budget, caisse, seuils d'approbation) opèrent **systématiquement en XOF** avec conversion préalable.

### 8.3 Justification académique

Ce pattern de multidevise tripartite est documenté dans SAP Financial Accounting (concept de Currency Type 10 — Company Code Currency, 30 — Group Currency, 40 — Hard Currency, 50 — Index-Based Currency, 60 — Global Company Currency). Oracle Financials parle de Functional Currency, Reporting Currency, Transaction Currency. C'est le pattern standard de tout ERP comptable opérant dans plusieurs zones monétaires.

La parité EUR/XOF est fixée par les accords de Bretton Woods successifs et garantie par le Trésor français (655,957 XOF pour 1 EUR), ce qui simplifie significativement le cas EUR. Les autres devises nécessitent une table de taux historisée avec révision périodique par le contrôle de gestion.

### 8.4 Implications

Extension du DDL : ajout de colonnes `*_amount_xof`, `*_fx_rate`, `*_fx_rate_date` partout où un montant non-XOF est susceptible d'être manipulé. Cela concerne au minimum les tables `purchase_request`, `purchase_request_line`, `purchase_order`, `purchase_order_line`, `invoice`, `invoice_line`, `journal_entry`, `journal_entry_line`, `payment`, `payment_line`, `cash_movement`, `commitment_entry`, `budget_consumption`.

Service `ExchangeRateService` enrichi (déjà partiellement fait par le sprint `484839f`) qui devient le point de passage unique pour toute conversion opérationnelle. Audit trail Pino structuré sur chaque conversion.

## 9. Q2 — Séparation des tâches : enforce ou tolérance ?

### 9.1 Constat

L'audit a identifié que GRANTFLOW n'enforce la séparation des tâches qu'au niveau des **rôles** (le DEMANDEUR ne peut pas approuver, seul le PI peut, etc.) mais pas au niveau des **identités** (un utilisateur portant à la fois les rôles DEMANDEUR et PI peut créer une DA puis l'approuver lui-même). Le PPT IPD ne traite pas explicitement cette question, ce qui suggère que les rôles sont en pratique portés par des individus distincts à l'IPD réelle, mais ne formalise pas une contrainte système.

### 9.2 Position retenue

Le système enforce la séparation par identité **par défaut**, avec une dérogation possible explicite et documentée. Un utilisateur ne peut pas approuver une DA dont il est le créateur. Un payment run ne peut pas être approuvé par celui qui l'a préparé. Une écriture ne peut pas être validée par son créateur.

Les rôles `SUPER_ADMIN` peuvent court-circuiter cette séparation (break-glass) mais chaque bypass est **enregistré dans `audit.event_log` avec un marqueur explicite `bypass_reason` obligatoire**. Une revue mensuelle des bypass est intégrée au tableau de bord du DAF.

Pour le cas des petites structures où une même personne porte plusieurs rôles (par exemple un PI qui est aussi le seul utilisateur de son projet), une convention peut **explicitement autoriser** un mode dégradé via un flag `single_actor_authorized = true` au niveau de la convention, à valider lors de l'activation budgétaire par le DAF.

### 9.3 Justification académique

ISA 315 (norme internationale d'audit) impose la séparation des fonctions incompatibles comme contrôle clé. COSO 2013 (Internal Control Framework) en fait un principe fondamental au point 10 (Selection and Development of Control Activities). Les guidelines USAID, Wellcome et EU exigent cette séparation pour les fonds qu'elles allouent. La position « comply or document » est standard dans le secteur NGO sous contrainte d'audit externe.

### 9.4 Implications

Création d'une `SegregationOfDutiesException` dans le catalogue d'exceptions métier. Décorateur NestJS `@RequireDifferentActor(field: 'requestedBy')` qui peut être appliqué aux endpoints d'approbation. Champ `single_actor_authorized` ajouté à `ref.grant`. Tableau de bord DAF avec liste des bypass mensuels.

## 10. Q3 — Accès TRESORIER à la clôture ?

### 10.1 Constat

L'audit a identifié un drift RBAC entre le frontend (qui autorise TRESORIER à voir la page Clôture) et le backend (qui le refuse, garantissant un 403). Le PPT IPD ne mentionne pas explicitement le rôle de trésorier dans le processus de clôture.

### 10.2 Position retenue

TRESORIER a accès en **lecture seule** à la clôture mensuelle. La rationale métier est qu'un trésorier doit pouvoir consulter l'état des périodes pour ne pas exécuter de paiement sur une période fermée et pour planifier ses payment runs en cohérence avec le calendrier comptable. En revanche, **seul le comptable peut clôturer** (action d'écriture).

### 10.3 Justification

Aucun ERP du secteur ne donne au trésorier la capacité de clôturer les périodes — c'est un acte comptable exclusif. Mais tous donnent au trésorier une visibilité sur le statut période. La position retenue est conforme à cette pratique standard.

### 10.4 Implications

Aligner le backend sur `('COMPTABLE','CONTROLEUR','DAF','TRESORIER','SUPER_ADMIN')` pour les endpoints GET de `accounting/periods`, `/events`, `/checks`. Conserver `('COMPTABLE','CONTROLEUR','DAF','SUPER_ADMIN')` pour les endpoints POST/PUT/DELETE. Le frontend est déjà aligné.

## 11. Q4 — Internationalisation EN

### 11.1 Constat

Le CLAUDE.md actuel mentionne *« Langue UI primaire : français, secondaire : anglais (i18n) »*. L'audit a confirmé qu'aucune librairie d'i18n n'est installée et que 100 % du texte UI est hardcodé en français.

### 11.2 Position retenue

La position retenue est **abandon de l'i18n UI** au profit d'une **localisation des rapports bailleur uniquement**. L'IPD est une structure francophone, les utilisateurs internes opèrent en français, le mémoire est en français, le pilote sera francophone. En revanche, les rapports financiers envoyés aux bailleurs anglophones doivent respecter leur maquette (souvent en anglais).

Le CLAUDE.md doit être mis à jour pour refléter cette position : i18n UI retirée, localisation rapport ajoutée.

### 11.3 Justification

L'i18n UI complète est un investissement significatif (estimé 4-6 semaines) pour un bénéfice marginal sur le pilote IPD. La localisation des rapports bailleur, en revanche, est **incontournable** : un rapport USAID doit être en anglais avec leur terminologie ("Cumulative Expenditures", "Disbursements", "Federal Share"). Cette localisation est portée par les templates de rapport, pas par une i18n générique.

### 11.4 Implications

Suppression de la mention `langue secondaire anglais` dans CLAUDE.md. Documentation explicite de la décision dans une ADR (ADR-008 — Internationalisation portée par les rapports bailleur uniquement). Implémentation de la localisation au niveau des templates de rapport en Phase 5A.

## 12. Q5 — `packages/shared` : source unique ou retrait ?

### 12.1 Constat

L'audit a identifié que `packages/shared` contient un enum `PrStatus` incomplet (manquent `pending_caissier` et `settled`), que l'API n'importe pas ces enums (elle utilise `@prisma/client` directement, ce qui est mieux), et que le frontend a sa propre redéclaration locale de `PrStatus`. Le package n'apporte donc aucune garantie d'alignement actuellement.

### 12.2 Position retenue

`packages/shared` est conservé et **devient la vraie source unique de types partagés** entre frontend et API. Ses enums sont **générés automatiquement depuis Prisma** via un script `codegen:shared-enums` ajouté au pipeline CI, qui fail si dérive détectée. Les types non-enum (interfaces FxConversion, PrSummary, ReportTemplate, etc.) sont également placés dans ce package.

Le frontend importe systématiquement depuis `@grantflow/shared` ; l'API importe les enums depuis `@prisma/client` (autorité) **et** les types métier depuis `@grantflow/shared`.

### 12.3 Justification

La complexité métier révélée par le PPT (Note Technique, maquettes, règles d'overhead) impose de nombreux types partagés. Supprimer le package créerait des duplications. Le conserver sans le maintenir crée un contrat faux dangereux. La position retenue (codegen + CI gate) est la seule défendable techniquement.

### 12.4 Implications

Création d'un script `apps/api/scripts/codegen-shared-enums.ts` qui lit `apps/api/prisma/schema.prisma` et génère `packages/shared/src/enums.generated.ts`. Ajout d'un job CI qui exécute ce script et compare au tracked output ; fail si dérive. Migration progressive des redéclarations d'enums frontend vers les imports `@grantflow/shared`.

---

# Partie IV — Modélisation conceptuelle des nouvelles entités

Cette partie décrit les entités métier à ajouter au modèle de données pour supporter les workflows identifiés au PPT et absents de la version actuelle.

## 13. Entités nouvelles et leurs relations

### 13.1 `NoteTechnique`

Entité pivot qui matérialise la traduction opérationnelle de la convention. Attributs principaux :

```
note_technique
├── id UUID PK
├── grant_id UUID FK → ref.grant
├── version INT NOT NULL DEFAULT 1
├── status TEXT CHECK IN ('draft', 'validated_go', 'validated_daf', 'active', 'superseded')
├── drafted_by_user_id UUID FK → auth.app_user (GO)
├── validated_by_daf_user_id UUID FK → auth.app_user NULL
├── activated_at TIMESTAMP NULL
├── budget_code TEXT NOT NULL  -- code budgétaire dérivé selon convention
├── reporting_intermediate_dates DATE[] NOT NULL
├── reporting_final_date DATE NOT NULL
├── own_funds_contribution_xof BIGINT NOT NULL DEFAULT 0
├── own_funds_contribution_currency TEXT  -- si différente
├── overhead_rule_id UUID FK → overhead_rule
├── notes TEXT
├── created_at, updated_at, deleted_at
```

Une convention a une note technique active à un instant donné (`status = 'active'`) et une histoire de versions précédentes (`superseded`). Le workflow d'évolution suit un mécanisme similaire à celui des écritures comptables : pas de modification destructive, création d'une nouvelle version qui supersede l'ancienne.

### 13.2 `OverheadRule`

Entité qui modélise les règles de frais généraux différenciées par convention.

```
overhead_rule
├── id UUID PK
├── name TEXT NOT NULL
├── default_rate NUMERIC(5,4) NOT NULL  -- 0.1500 pour 15%
├── applies_to_subcontracting BOOLEAN NOT NULL DEFAULT TRUE
├── applies_to_equipment BOOLEAN NOT NULL DEFAULT TRUE
├── applies_to_personnel BOOLEAN NOT NULL DEFAULT TRUE
├── applies_to_missions BOOLEAN NOT NULL DEFAULT TRUE
├── applies_to_consumables BOOLEAN NOT NULL DEFAULT TRUE
├── created_at, updated_at, deleted_at
```

Une règle nommée `'USAID-standard'` peut avoir `default_rate = 0.15` et `applies_to_subcontracting = FALSE`. Une règle nommée `'Wellcome-zero'` peut avoir `default_rate = 0.00`. Au moment de l'imputation d'une DA, le système consulte la règle de la convention pour décider si la nature de dépense entraîne ou non un overhead calculé.

### 13.3 `EligibilityRule` et `ExpenseNature`

Tables jointes qui matérialisent les natures de dépenses éligibles par convention.

```
expense_nature
├── id UUID PK
├── code TEXT UNIQUE  -- ex: 'PCR_EQUIPMENT', 'CONSUMABLES_LAB', 'TRAVEL_INTERNATIONAL'
├── label TEXT
├── category TEXT CHECK IN ('functioning', 'equipment', 'personnel', 'missions', 'subcontracting')
├── default_account_class CHAR(1)  -- 6 = charges, 2 = immobilisations

eligibility_rule
├── id UUID PK
├── grant_id UUID FK → ref.grant
├── expense_nature_id UUID FK → expense_nature
├── max_per_request_xof BIGINT NULL  -- plafond unitaire
├── max_per_year_xof BIGINT NULL     -- plafond annuel
├── excluded BOOLEAN NOT NULL DEFAULT FALSE
├── notes TEXT
├── UNIQUE (grant_id, expense_nature_id)
```

Au moment de la création d'une DA, le service valide que `requestType` (lié à `expense_nature`) figure dans la `eligibility_rule` de la `Grant` et n'est pas marqué `excluded`. Si plafond, validation que le montant ne dépasse pas.

### 13.4 `ReportTemplate`

Entité qui modélise les maquettes de rapport bailleur configurables.

```
report_template
├── id UUID PK
├── donor_id UUID FK → ref.donor
├── name TEXT  -- ex: 'USAID-FFR-SF425', 'Wellcome-Annual-Report', 'EU-Horizon-Form-C'
├── language TEXT NOT NULL  -- 'fr', 'en'
├── currency TEXT NULL  -- forcée par le bailleur ou suit la convention
├── version TEXT  -- version de la maquette bailleur
├── template_file_storage_key TEXT  -- clé MinIO/R2 vers le fichier Excel/PDF
├── line_mapping JSONB NOT NULL  -- mapping ligne template → ExpenseNature[]
├── header_fields JSONB NOT NULL  -- métadonnées bailleur (recipient_id, etc.)
├── created_at, updated_at, deleted_at

donor_report_assignment
├── id UUID PK
├── grant_id UUID FK → ref.grant
├── report_template_id UUID FK → report_template
├── period_type TEXT CHECK IN ('intermediate', 'final')
├── due_date DATE NOT NULL
├── status TEXT CHECK IN ('pending', 'in_progress', 'submitted', 'amended')
```

### 13.5 `ReportVersion`

Entité qui gère le versioning des rapports avec colonnes d'ajustement.

```
report_version
├── id UUID PK
├── donor_report_assignment_id UUID FK → donor_report_assignment
├── version INT NOT NULL  -- 1, 2, 3...
├── status TEXT CHECK IN ('draft', 'signed_daf', 'signed_director', 'transmitted', 'superseded')
├── generated_at TIMESTAMP NOT NULL
├── pdf_storage_key TEXT NULL
├── xlsx_storage_key TEXT NULL
├── daf_signature_at TIMESTAMP NULL
├── daf_signed_by_user_id UUID FK → auth.app_user NULL
├── director_signature_at TIMESTAMP NULL
├── director_signed_by_user_id UUID FK → auth.app_user NULL
├── transmitted_at TIMESTAMP NULL
├── transmitted_by_user_id UUID FK → auth.app_user NULL
├── adjustment_column_notes TEXT NULL  -- justification de la version suivante
├── supersedes_version_id UUID FK → report_version NULL
├── UNIQUE (donor_report_assignment_id, version)
```

La règle métier : une version `transmitted` ne peut plus être modifiée ; elle peut seulement être **superseded** par une nouvelle version qui contient une colonne d'ajustement explicite et un nouveau total.

### 13.6 `AuditClause` et `AuditMission`

Modélisation du module audit.

```
audit_clause
├── id UUID PK
├── grant_id UUID FK → ref.grant
├── required BOOLEAN NOT NULL DEFAULT FALSE
├── frequency TEXT CHECK IN ('annual', 'final_only', 'both')
├── financed_by_project BOOLEAN NOT NULL DEFAULT TRUE
├── budget_line_id UUID FK → co.budget_line NULL  -- ligne provisionnée

audit_mission
├── id UUID PK
├── audit_clause_id UUID FK → audit_clause
├── period_start DATE
├── period_end DATE
├── auditor_firm_name TEXT
├── mission_letter_storage_key TEXT
├── mission_letter_signed_at TIMESTAMP NULL
├── audit_report_storage_key TEXT NULL
├── audit_report_signed_by_auditor_at TIMESTAMP NULL
├── audit_report_signed_by_daf_at TIMESTAMP NULL
├── audit_report_signed_by_director_at TIMESTAMP NULL
├── status TEXT CHECK IN ('planned', 'letter_sent', 'in_progress', 'report_received', 'signed_off', 'attached_to_final_report')
```

### 13.7 `FundContribution`

Modélisation de la contribution sur fonds propres.

```
fund_contribution
├── id UUID PK
├── grant_id UUID FK → ref.grant
├── budgeted_amount_xof BIGINT NOT NULL
├── budgeted_amount_currency TEXT NOT NULL
├── consumed_amount_xof BIGINT NOT NULL DEFAULT 0  -- calculé via vue
├── fund_source TEXT  -- ex: 'IPD_OWN_FUNDS', 'PASTEUR_NETWORK_GRANT'
├── notes TEXT
```

Au moment d'une imputation, le système peut marquer une dépense comme financée par fonds propres (champ `funded_by_own_funds = TRUE` sur l'imputation analytique), ce qui décrémente cette table au lieu du budget bailleur.

### 13.8 `InterCenterTransfer`

Modélisation des refacturations inter-pôles IPD.

```
inter_center_transfer
├── id UUID PK
├── from_cost_center_id UUID FK → co.cost_center
├── to_cost_center_id UUID FK → co.cost_center
├── from_grant_id UUID FK → ref.grant
├── to_grant_id UUID FK → ref.grant
├── source_invoice_id UUID FK → ap.invoice NULL  -- traçabilité origine
├── amount_xof BIGINT NOT NULL
├── currency TEXT NOT NULL
├── transfer_date DATE
├── status TEXT CHECK IN ('proposed', 'approved', 'posted', 'cancelled')
├── notes TEXT
```

Une refacturation génère deux écritures miroirs (passage du centre A au centre B) qui s'annulent au consolidé IPD mais sont visibles dans la comptabilité analytique par projet.

## 14. Diagramme entité-association — vue de haut niveau

Le schéma textuel suivant représente les relations entre les entités existantes et nouvelles.

```
ref.donor ──1───* ref.grant ──1───1 NoteTechnique
                  │           │
                  │           └────1 OverheadRule
                  │           └────* EligibilityRule ──*──1 ExpenseNature
                  │           └────* FundContribution
                  │           └────* AuditClause ──1──* AuditMission
                  │           └────* DonorReportAssignment ──*──1 ReportTemplate
                  │                                   └────1──* ReportVersion
                  │
                  └────* co.budget_line ──*── ExpenseNature (via line_eligible_natures)
                  └────* procurement.purchase_request ──*── ref.grant
                                  │
                                  └── analytic_imputation ──→ project, grant, budget_line,
                                      cost_center, activity, fund_source, expense_nature

InterCenterTransfer ──→ FROM co.cost_center, ref.grant
                   └──→ TO   co.cost_center, ref.grant
```

## 15. Impacts DDL et stratégie de migration

L'introduction de ces entités impose une extension non-trivial du DDL PostgreSQL. La stratégie de migration retenue est conforme au workflow DDL-first documenté dans CLAUDE.md §9 :

1. Le DDL `docs/grantflow_ddl_postgresql.sql` est étendu **en premier**, avec les nouvelles tables et leurs contraintes, triggers et vues.
2. Une migration SQL idempotente est préparée pour passer une base existante du schéma actuel au schéma cible, en utilisant exclusivement `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`.
3. Les colonnes calculées (équivalents XOF) sont déclarées `GENERATED ALWAYS AS STORED` quand la formule est déterministe (parité BCEAO EUR), et restent en colonnes ordinaires avec triggers de mise à jour quand le taux est lookup-based.
4. Les triggers métier critiques (équilibre débit-crédit, période close, chaînage hash) sont préservés et étendus si nécessaire.
5. `prisma db pull` synchronise le schéma Prisma après chaque migration DDL appliquée.
6. Aucun usage de `prisma migrate dev` ou `prisma migrate deploy` — interdiction réitérée.

---

# Partie V — Plan d'action 12 mois révisé

## 16. Vision d'ensemble

Le plan révisé couvre 52 semaines, du 02 juin 2026 à la soutenance du mémoire prévue fin mai 2027. Il est structuré en 8 phases logiques, avec des phases partiellement parallélisables et des livrables identifiés pour chaque jalon. La rédaction du mémoire avance en continu pendant les phases techniques, pas en aval.

Une compression de 4 semaines par rapport au plan initial est obtenue en parallélisant la Phase 2 (santé tests) avec la Phase 1 (multidevise comptable), justifiable techniquement car les zones de la codebase concernées sont disjointes.

## 17. Phase 0 — Cadrage stratégique et modélisation conceptuelle

**Durée** : 4 semaines (semaines 1 à 4)
**Période** : 02 juin → 30 juin 2026

**Activités** :
- Analyse PPT IPD et synthèse domaine (cette note).
- Étude documentaire ERP NGO : SAP PSM, Oracle Grants, Sage Intacct, Serenic Navigator, FundEZ — lectures et synthèse.
- Modélisation conceptuelle des 8 nouvelles entités (Partie IV de ce document).
- Formalisation des 7+ ADRs structurantes.
- Définition du backlog initial sprintable Phase 1.
- Setup CI/CD propre : branch protection, gates lint/typecheck/test/e2e, preview deploys.
- Charte rédactionnelle du mémoire (plan détaillé, normes typographiques, conventions de citation).

**Livrables** :
- `docs/cadrage-phase-0.md` (ce document)
- `docs/adr/*.md` (7-10 ADRs)
- `docs/backlog-initial.md` (50-80 user stories sprintées)
- `docs/memoire-plan.md` (table des matières détaillée du mémoire)
- CLAUDE.md mis à jour (suppression mention i18n EN, ajout référence à cette note)

**Critères d'acceptation** :
- Note de cadrage validée par le directeur de mémoire.
- Backlog Phase 1 prêt à attaquer avec critères d'acceptation par story.
- ADRs publiées dans le repository.

## 18. Phase 1 — Exactitude comptable multidevise + Eligibility engine

**Durée** : 10 semaines (semaines 5 à 14)
**Période** : 01 juillet → 09 septembre 2026

**Activités** :
- DDL : extension avec `*_amount_xof`, `*_fx_rate`, `*_fx_rate_date` partout où nécessaire (~12 tables).
- Migration SQL idempotente.
- Service `ExchangeRateService` étendu : `convertToXof`, `convertFromXof`, gestion taux historisés.
- Contrôle budgétaire et limites de caisse migrés sur conversion XOF (Lot 1 audit, finding F1).
- Comptabilité d'engagement classe 8 avec équivalent XOF stocké (finding F18).
- Remplacement systématique de `Number()` par `Prisma.Decimal` sur les agrégats et comparaisons (finding F10).
- Modélisation et implémentation de `EligibilityRule` et `ExpenseNature`.
- Eligibility engine câblé à la création de DA, validation contre Note Technique, fenêtre de dates, plafonds.
- Tests d'intégration : 20+ cas couvrant les combinaisons devise × seuil × type DA, plus les 10 règles « à ne pas faire » du PPT.

**Livrables** :
- DDL mis à jour avec migration documentée.
- Service FX consolidé et documenté.
- Eligibility engine opérationnel avec tests de couverture.
- **Chapitre mémoire** : « Architecture multidevise et alignement SYSCEBNL » — 20-25 pages.

**Critères d'acceptation** :
- 100 % des cas de test du PPT « à ne pas faire » bloqués par le système.
- DA en devise étrangère correctement routée selon seuils XOF.
- Engagement classe 8 stockant l'équivalent XOF et le taux d'origine.

## 19. Phase 2 — Santé de la suite de tests (en parallèle Phase 1)

**Durée** : 4 semaines (semaines 7 à 10, en parallèle Phase 1)
**Période** : 14 juillet → 11 août 2026

**Activités** :
- Migration des 7 mocks Prisma vers `mockDeep<PrismaService>()` via `jest-mock-extended` (finding F2).
- Mock horloge systématique : `jest.useFakeTimers()` + `setSystemTime` (finding F22).
- Réactivation de la suite e2e auth/RBAC ou documentation de son retrait justifié (finding F20).
- Création de `jest-int.config.js` ou retrait de la commande `test:int` (finding F28).
- Atteinte couverture cible : > 70 % API, > 50 % web (mesurée via Istanbul).
- Suite e2e Playwright avec 5-7 parcours utilisateur principaux.

**Livrables** :
- CI verte stable et reproductible.
- Rapport de couverture publié en annexe mémoire.
- Vidéos des parcours e2e (réutilisables comme démos mémoire).

**Critères d'acceptation** :
- 0 test rouge sur main.
- Couverture mesurée et reportée.
- Pipeline CI < 15 min.

## 20. Phase 3 — Sécurité, gouvernance et séparation des tâches

**Durée** : 4 semaines (semaines 15 à 18)
**Période** : 10 septembre → 07 octobre 2026

**Activités** :
- Implémentation de la séparation des tâches enforced par identité (finding F3, position retenue Q2).
- `SegregationOfDutiesException`, décorateur `@RequireDifferentActor`.
- Module RBAC central avec matrice de permissions JSON-config (findings F4, F6, F8).
- Endpoint `/me/permissions` qui sert de source unique aux permissions frontend.
- Audit `event_log` migré au niveau domaine via un `AuditEventBus` (finding F9).
- Politique de bypass `SUPER_ADMIN` avec `bypass_reason` obligatoire.
- Tableau de bord DAF des bypass mensuels.
- Pentest interne avec OWASP ZAP sur l'instance Render.

**Livrables** :
- Matrice de permissions documentée.
- Catalogue d'exceptions étendu.
- Rapport pentest OWASP (annexe mémoire).
- **Chapitre mémoire** : « Gouvernance, contrôle interne et conformité ISA 315 / COSO 2013 » — 15-20 pages.

**Critères d'acceptation** :
- Aucun parcours utilisateur ne génère plus de 403 silencieux par drift RBAC.
- Bypass `SUPER_ADMIN` tracés et reportés.
- Zéro vulnérabilité OWASP Top 10 critique sur l'instance Render.

## 21. Phase 4 — Refactoring architectural et dette propre

**Durée** : 6 semaines (semaines 19 à 24)
**Période** : 08 octobre → 18 novembre 2026

**Activités** :
- `AppUserResolver` partagé et extraction Prisma des controllers (finding F7).
- Migration des hooks frontend sur `use-api.ts` (finding F12).
- Création de `common/dto/query.helpers.ts` (finding F14).
- Isolation de la démo PO → Invoice dans un module dédié (finding F15).
- Codegen Prisma → `packages/shared/enums.generated.ts` (finding F5).
- Migration des 5 tuples Zod en `z.nativeEnum` (finding F13).
- Centralisation des listes de devises et bornes pagination (finding F24).
- Formalisation rétrospective des ADRs implicites (~30 décisions à documenter).

**Livrables** :
- Codebase refactorée avec duplication < 5 %.
- Catalogue ADR complet en annexe mémoire.
- **Chapitre mémoire** : « Architecture logicielle et patterns appliqués » — 20-25 pages.

**Critères d'acceptation** :
- Aucune duplication de `FULL_VIEW_ROLES`, `resolveAppUserId`, helpers Zod.
- `packages/shared` est la seule source d'enums côté frontend.
- 30 ADRs publiés.

## 22. Phase 5A — Modules métier IPD-critiques

**Durée** : 14 semaines (semaines 25 à 38)
**Période** : 19 novembre 2026 → 24 février 2027

**Modules à implémenter** :

1. **Note Technique et workflow Grant Office** (3 semaines) — entité, workflow rédaction → validation DAF → activation, versioning.
2. **Maquettes bailleur configurables** (2 semaines) — `ReportTemplate`, mapping ligne template → expense nature, upload des templates par bailleur.
3. **Génération de rapport multi-format** (2 semaines) — PDF signé Directeur+DAF, Excel raw, signature électronique simple.
4. **Versioning rapport et colonne d'ajustement** (1 semaine) — `ReportVersion`, mécanisme d'immutabilité du publié, génération de la colonne d'ajustement.
5. **Module Audit** (2 semaines) — `AuditClause`, `AuditMission`, mission letters, upload rapports, signatures.
6. **Refacturation inter-pôles** (1 semaine) — `InterCenterTransfer`, écritures miroirs.
7. **Contribution sur fonds propres** (1 semaine) — `FundContribution`, traçabilité spécifique au reporting.
8. **Justificatifs typés par nature de dépense** (1 semaine) — règles de complétude, alerte au moment du compte rendu.
9. **États SYSCEBNL réglementaires** (1 semaine) — TER, état des fonds dédiés, bilan formaté SYSCEBNL.

**Livrables** :
- Système fonctionnellement complet au sens NGO ERP.
- **Chapitre mémoire** : « Modules métier spécifiques au secteur recherche / NGO » — 30-40 pages.

**Critères d'acceptation** :
- Cycle complet convention → activation budgétaire → engagement → exécution → reporting bailleur → audit → clôture testé end-to-end.
- Rapports bailleur générés conformes aux maquettes (USAID FFR, Wellcome, EU Form C au moins en simulation).

## 23. Phase 5B — Modules complémentaires

**Durée** : 4 semaines (semaines 39 à 42)
**Période** : 25 février → 24 mars 2027

**Activités** :
- OCR Vision Claude testé et stabilisé en prod.
- Mobile-responsive (validation tablette + smartphone).
- Notifications par mail sur transitions de workflow critiques.
- Dashboard PI dédié avec consommation budget temps réel.
- Module rapprochement bancaire (import CSV/MT940 + matching + GUI reconciliation).

**Livrables** :
- Système complet et utilisable en mobilité.
- Démos vidéo des nouveaux modules.

## 24. Phase 6 — Étude comparative ERP

**Durée** : 4 semaines (semaines 43 à 46)
**Période** : 25 mars → 21 avril 2027

**Activités** :
- Analyse approfondie de 5-7 ERPs : SAP PSM, Oracle Grants Accounting, Sage Intacct Nonprofit, Serenic Navigator, FundEZ, Sage X3, EBP NGO.
- Construction d'un tableau comparatif fonctionnel ~80-100 critères.
- Positionnement de GRANTFLOW IPD sur ce tableau.
- Argumentaire d'adoption : TCO (Total Cost of Ownership) comparatif, time-to-deploy, niveau de personnalisation, vendor lock-in, alignement SYSCEBNL.
- Identification des forces différenciantes de GRANTFLOW et de ses faiblesses persistantes.

**Livrables** :
- **Chapitre mémoire** : « Étude comparative et positionnement » — 25-30 pages. **Chapitre fort différenciant.**
- Annexe : tableau comparatif complet.

## 25. Phase 7 — Artefacts de persuasion adoption IPD

**Durée** : 4 semaines (semaines 47 à 50)
**Période** : 22 avril → 19 mai 2027

**Livrables** (ensemble qui constitue un dossier d'adoption clé en main) :
- **Executive Summary IPD** — 2 pages, format DG-friendly.
- **Business case** — ROI quantifié sur 3 ans (économies vs ERP commercial, gain productivité DFC, fiabilisation reporting bailleur).
- **Plan de change management** — séquence d'adoption recommandée, formation, accompagnement.
- **Simulation de réponse RFP** — comme si l'IPD lançait un appel d'offres, GRANTFLOW répond.
- **Documentation utilisateur** — PDF 40-60 pages + 6-8 vidéos de formation.
- **Manuel d'installation IPD** — déploiement on-premise sur infrastructure IPD.
- **Présentation comité de direction IPD** — 30 slides format soutenance executive.

## 26. Phase 8 — Finalisation mémoire et soutenance

**Durée** : 2 semaines (semaines 51 à 52)
**Période** : 20 mai → 02 juin 2027

**Activités** :
- Révision globale du mémoire pour cohérence d'ensemble.
- Schémas finaux (architecture, diagrammes UML cas d'usage / séquence / classes).
- Annexes consolidées (audit, ADRs, captures, KPIs, comparatif ERP).
- Bibliographie et table des références finalisées.
- Slides de soutenance : structure problème métier → solution → preuves → limites → roadmap.
- Vidéo de démonstration scriptée 8-12 minutes en backup.
- 3 répétitions devant un public.

## 27. Vue calendaire compressée

```
Mois    | S | Phase active
--------|---|---------------------------------------
Juin 26 | 1 | Phase 0 — Cadrage
        | 2 | Phase 0
        | 3 | Phase 0
        | 4 | Phase 0
Juil 26 | 5 | Phase 1 — Multidevise + Eligibility
        | 6 | Phase 1
        | 7 | Phase 1 + Phase 2 (parallèle)
        | 8 | Phase 1 + Phase 2
Août 26 | 9 | Phase 1 + Phase 2
        |10 | Phase 1 + Phase 2
        |11 | Phase 1
        |12 | Phase 1
Sept 26 |13 | Phase 1
        |14 | Phase 1 (clôture)
        |15 | Phase 3 — Sécurité
        |16 | Phase 3
Oct 26  |17 | Phase 3
        |18 | Phase 3 (clôture)
        |19 | Phase 4 — Refactoring archi
        |20 | Phase 4
Nov 26  |21 | Phase 4
        |22 | Phase 4
        |23 | Phase 4
        |24 | Phase 4 (clôture)
        |25 | Phase 5A — Note Technique
Déc 26  |26 | Phase 5A — Note Technique
        |27 | Phase 5A — Note Technique
        |28 | Phase 5A — Maquettes
        |29 | Phase 5A — Maquettes
Janv 27 |30 | Phase 5A — Génération rapports
        |31 | Phase 5A — Génération rapports
        |32 | Phase 5A — Versioning
        |33 | Phase 5A — Audit
Févr 27 |34 | Phase 5A — Audit
        |35 | Phase 5A — Inter-pôles
        |36 | Phase 5A — Fonds propres
        |37 | Phase 5A — Justificatifs
        |38 | Phase 5A — SYSCEBNL (clôture)
Mars 27 |39 | Phase 5B — OCR + Mobile
        |40 | Phase 5B
        |41 | Phase 5B
        |42 | Phase 5B
        |43 | Phase 6 — Étude comparative ERP
Avril 27|44 | Phase 6
        |45 | Phase 6
        |46 | Phase 6 (clôture)
        |47 | Phase 7 — Persuasion
Mai 27  |48 | Phase 7
        |49 | Phase 7
        |50 | Phase 7
        |51 | Phase 8 — Finalisation
        |52 | Phase 8 — Soutenance
```

---

# Partie VI — Risques et mitigation

## 28. Cartographie des risques

| ID | Risque | Probabilité | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Hypothèses métier divergentes de la réalité IPD | Moyenne | Élevé | Confronter aux ERP NGO, contact opportuniste DFC IPD, marquer hypothèses dans mémoire |
| R2 | Abonnement Claude Code/Cowork interrompu | Élevée | Moyen | Plan en bursts (cf. §29), kit autonomie, batch deliverables |
| R3 | Découverte tardive d'un manque fonctionnel structurant | Moyenne | Élevé | Audit complémentaire fin Phase 4, marge Phase 5A intentionnellement large |
| R4 | Régression critique introduite par refactoring | Moyenne | Élevé | Phase 2 santé tests avant refactoring Phase 4, gates CI |
| R5 | Performance dégradée sur volumétrie réelle | Moyenne | Moyen | Tests de charge avec dataset simulé en Phase 5B |
| R6 | Encadrement académique insatisfait du périmètre | Faible | Élevé | Validation Phase 0 par directeur, points trimestriels |
| R7 | Décalage calendaire > 4 semaines | Moyenne | Élevé | Marge non allouée en Phase 8, compression Phase 6 possible |
| R8 | Bug de production sur dépendance non patchée | Faible | Moyen | Audit dépendances Phase 1, Dependabot activé |
| R9 | Difficulté à modéliser une convention réelle complexe | Moyenne | Moyen | Cas type USAID simplifié comme référence Phase 5A |
| R10 | Soutenance technique trop dense pour un jury non-spécialiste | Élevée | Moyen | Slides avec storyline métier, vidéo de démo, répétitions |

## 29. Stratégie face à la contrainte LLM

Le budget Claude Code + Cowork ne peut pas être garanti continu sur 12 mois. Stratégie en bursts :

- **Mois 1-2** (Phase 0 + démarrage Phase 1) : abonnement actif, intensif.
- **Mois 3** : autonomie complète sur Phase 1 (codage classique sur patterns établis), rédaction mémoire chapitre 1.
- **Mois 4-5** (Phase 1 finition + Phase 3) : abonnement actif.
- **Mois 6** : autonomie sur Phase 4 début, rédaction chapitre 2.
- **Mois 7-8** (Phase 4 + Phase 5A démarrage) : abonnement actif.
- **Mois 9** : autonomie sur Phase 5A continuation.
- **Mois 10-11** (Phase 5A finition + Phase 7) : abonnement actif.
- **Mois 12** (Phase 8) : finalisation mémoire en humain seul.

Soit 6-7 mois d'abonnement sur 12. Réduction de coût d'environ 40 %.

Pendant les mois sans abonnement actif, recours possible au tier gratuit de Claude.ai pour consultations ponctuelles sans tools. Le « kit autonomie » prévu en Phase 0 (templates, ADRs, patterns documentés) maximise la productivité solo.

---

# Annexes

## A. Glossaire IPD

- **Bailleur** : organisme financier qui finance un projet de recherche via une convention.
- **BC** : Bon de Commande.
- **CCA / PCA** : Charges / Produits Constatés d'Avance.
- **DA** : Demande d'Achat.
- **DAF** : Directeur Administratif et Financier.
- **DHHS** : U.S. Department of Health and Human Services, bailleur fédéral américain.
- **FNP** : Facture Non Parvenue.
- **Frais généraux** : voir Overhead.
- **GO** : Grant Office, cellule IPD interface entre les bailleurs et l'opérationnel financier.
- **GR** : Goods Receipt, bon de réception.
- **IPD** : Institut Pasteur de Dakar.
- **Maquette bailleur** : modèle de rapport financier fourni par le bailleur, à utiliser tel quel.
- **Nature de dépense** : catégorie typologique d'une dépense (consommables labo, équipement, mission, etc.).
- **Note Technique** : document rédigé par le GO traduisant la convention en infrastructure budgétaire activée.
- **Overhead** : taux de frais généraux conventionnellement reconnus comme imputables au projet.
- **PI** : Principal Investigator, responsable scientifique d'un projet.
- **RIIP** : Réseau International des Instituts Pasteur.
- **SYSCEBNL** : Système Comptable des Entités à But Non Lucratif, référentiel OHADA.
- **TER** : Tableau des Emplois et Ressources, état SYSCEBNL annuel.

## B. Sources documentaires

**Référentiels comptables et d'audit**
- Acte uniforme OHADA relatif au droit comptable et à l'information financière (édition en vigueur).
- Acte uniforme OHADA relatif aux organisations à but non lucratif (SYSCEBNL).
- ISA 315 (Identifying and Assessing the Risks of Material Misstatement), IFAC.
- COSO Internal Control — Integrated Framework, édition 2013.

**ERP de référence pour le secteur recherche / NGO**
- SAP Public Sector Management (PSM) — Funds Management, Grants Management modules.
- Oracle Federal Financials / Oracle Grants Accounting.
- Sage Intacct Nonprofit — Multi-dimensional accounting.
- Serenic Navigator (Microsoft Dynamics 365 pour NGOs).
- FundEZ — NGO accounting.
- Workday Adaptive Grants Planning.

**Guidelines bailleurs (exemples consultés)**
- USAID 2 CFR 200 (Uniform Administrative Requirements, Cost Principles, and Audit Requirements for Federal Awards).
- Wellcome Trust Grants Conditions.
- European Commission Horizon Europe Grant Agreement.

**Sources internes**
- Présentation IPD « Gestion de Projet et Conventions de Recherche — Budget des conventions de recherche et des comptes rendus financiers » (document fourni).
- CLAUDE.md du projet GRANTFLOW IPD.
- Audit transversal GRANTFLOW IPD du 02 juin 2026.

## C. Liste des ADRs à formaliser

- ADR-001 — DDL-first comme source unique du schéma de données
- ADR-002 — Keycloak OIDC pour l'authentification et l'autorisation
- ADR-003 — Modular monolith comme architecture de départ (vs microservices)
- ADR-004 — Prisma comme ORM unique
- ADR-005 — Multidevise tripartite avec XOF comme devise de tenue SYSCEBNL
- ADR-006 — Grant Office et Note Technique comme entités de premier plan
- ADR-007 — Eligibility engine centralisé vs validation éparpillée
- ADR-008 — Internationalisation portée par les rapports bailleur uniquement (pas i18n UI)
- ADR-009 — Séparation des tâches enforced par identité avec dérogation explicite
- ADR-010 — `packages/shared` comme source unique avec codegen Prisma
- ADR-011 — Immutabilité des rapports publiés et versioning par colonne d'ajustement
- ADR-012 — Audit trail SHA-256 chaîné préservé en trigger PostgreSQL
- ADR-013 — Stratégie multi-environnements (dev local Docker, cloud Render/Vercel/Neon, IPD on-premise)
- ADR-014 — Choix Cloudflare R2 vs MinIO selon environnement (single bucket avec routing par préfixe)
- ADR-015 — Stratégie de tests : pyramide Unit > Integration > E2E avec couverture cible 70/50

## D. Conventions de travail

**Branches Git**
- `main` : version stable, protégée, déploiement automatique vers cloud.
- `feature/XXX` : branche par sprint, mergée via PR avec revue.
- `fix-XXX` : correctifs ciblés.
- `chore-XXX` : maintenance, dépendances, doc.

**Format de commit**
Convention Conventional Commits : `<type>(<scope>): <message>` avec types `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `perf`.

**Format de PR**
Titre court explicite, description structurée : Contexte / Changement / Tests / Captures. Mention de l'audit finding traité le cas échéant.

**Rituel de sprint**
Sprint de 2 semaines, démarrage le lundi, démo le vendredi de la 2ème semaine, rétro le lundi suivant. Mise à jour de la TASKS.md à chaque démarrage et clôture.

---

*Note de cadrage Phase 0 — Version 1.0 — 02 juin 2026*
*Auteur : El Hadj Amadou NIANG — Mémoire MIAGE 2025/2026 — Institut Pasteur de Dakar*

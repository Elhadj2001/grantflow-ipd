# ADR-005 — Multidevise tripartite avec XOF comme devise de tenue SYSCEBNL

**Statut** : accepted
**Date** : 2026-06-02
**Auteur** : El Hadj Amadou NIANG

## Contexte

GRANTFLOW IPD doit gérer simultanément trois réalités monétaires distinctes :

- Les **conventions bailleur** sont libellées dans la devise du bailleur — USD pour USAID, EUR pour Wellcome Trust et l'Union Européenne, GBP pour certains fonds britanniques, CHF pour des fonds suisses, parfois XOF pour des fonds locaux ou régionaux UEMOA.
- La **comptabilité de l'IPD** doit être tenue en XOF (Franc CFA UEMOA) par obligation réglementaire SYSCEBNL, conformément à l'Article 1 de l'Acte uniforme OHADA relatif au droit comptable.
- Les **paiements opérationnels** au Sénégal sont majoritairement en XOF, mais certaines factures de fournisseurs internationaux (équipements scientifiques, abonnements de revues, prestataires hors zone UEMOA) sont en devises étrangères.

À cela s'ajoutent les contraintes de seuils et de contrôles : la matrice de délégation IPD (PI < 500 000 XOF, CG < 5 000 000 XOF, DAF au-delà) est définie en XOF. Les caisses physiques (`cash_box`) sont en XOF. Les budgets bailleur sont définis dans la devise de la convention mais doivent être tracés analytiquement en XOF pour le contrôle interne.

Un bug critique identifié par l'audit du 02 juin 2026 (finding F1) résultait précisément du non-traitement de cette tripartition : le contrôle budgétaire comparait des montants en EUR à des seuils en XOF sans conversion, faussant le routage par seuil.

Trois architectures de gestion devise étaient possibles : (a) **mono-devise XOF** avec conversion frontale opérationnelle, (b) **multi-devise par enregistrement** avec un champ devise sur chaque montant et conversion à la demande, (c) **multi-devise tripartite** avec stockage simultané de la valeur transactionnelle et de son équivalent fonctionnel XOF.

## Décision

GRANTFLOW IPD adopte une architecture **multi-devise tripartite** inspirée des Currency Types de SAP Financial Accounting :

- **Devise transactionnelle** (`*_currency`) : devise réelle de l'opération. Stockée systématiquement avec le montant brut (`*_amount`).
- **Devise fonctionnelle** (XOF) : devise de tenue comptable. L'équivalent XOF (`*_amount_xof`) est stocké pour chaque montant, accompagné du taux appliqué (`*_fx_rate`) et de la date du taux (`*_fx_rate_date`) — pour audit trail et reproductibilité.
- **Devise de reporting** : selon le contexte. Pour les rapports au bailleur, c'est la devise de la convention (reconstituée depuis `*_amount` et `*_currency`). Pour les états internes SYSCEBNL (balance, grand livre, TER), c'est XOF (utilise `*_amount_xof`).

**Règles d'or** :

1. Tout **contrôle métier** (budget, seuil d'approbation, plafond caisse, limite par jour) opère en XOF, après conversion.
2. Tout **affichage utilisateur** privilégie la devise transactionnelle, avec mention de l'équivalent XOF en infobulle ou en seconde ligne.
3. Toute **écriture comptable** (`gl.journal_entry_line`) stocke à la fois le montant transactionnel + sa devise + l'équivalent XOF + le taux + la date du taux, pour pouvoir reproduire l'écriture en cas d'audit.
4. La **parité EUR/XOF** est fixée à **655,957** (parité immuable BCEAO garantie par le Trésor français depuis 1999). Elle ne provient pas de la table `exchange_rate` — elle est constante dans le service FX.
5. Les **autres devises** (USD, GBP, CHF) ont leur taux historisé dans `gl.exchange_rate`, avec révision périodique par le contrôle de gestion. Un fallback indicatif (USD = 600, GBP = 800, CHF = 700) existe pour la démo mais ne doit pas être utilisé en production.
6. Le service `ExchangeRateService` est l'**unique point de passage** pour toute conversion. Son utilisation est tracée par log Pino structuré.

**Implémentation DDL** : ajout des triplets `*_amount_xof`, `*_fx_rate`, `*_fx_rate_date` sur les tables `purchase_request`, `purchase_request_line`, `purchase_order`, `purchase_order_line`, `invoice`, `invoice_line`, `journal_entry`, `journal_entry_line`, `payment`, `payment_line`, `cash_movement`, `commitment_entry`, `budget_consumption`.

## Conséquences

### Positives

- **Conformité SYSCEBNL** garantie : la tenue comptable est en XOF de fait, par construction du champ `*_amount_xof`.
- **Reproductibilité d'audit** : chaque montant peut être ré-évalué dans la devise de son choix avec le taux historisé, conformément aux exigences de traçabilité d'audit ISA 230.
- **Bug F1 résorbé** : les contrôles budgétaires, seuils et caisses opèrent désormais en XOF de manière déterministe.
- **Reporting bailleur** dans la devise du bailleur est immédiat — pas de re-conversion en sortie.
- **Pattern reconnu** par les ERP du secteur (SAP, Oracle, Sage) — défendable académiquement.

### Négatives

- **Bloat DDL** : chaque table financière gagne 3 colonnes (montant XOF, taux, date). Acceptable car les tables comptables sont peu nombreuses.
- **Logique de conversion sur les hot paths** : chaque insertion/modification d'un montant déclenche une conversion. Coût mitigé par le caching du dernier taux par devise dans `ExchangeRateService`.
- **Risque de désynchronisation** entre `*_amount` et `*_amount_xof` si modifié à la main. Atténué par le respect strict du `ExchangeRateService` comme unique chemin d'écriture.
- **Sensibilité aux taux** : un taux mal configuré dans `exchange_rate` propage l'erreur. Atténué par la revue obligatoire CG des taux et le fallback indicatif loud loggé.

## Alternatives considérées

- **Mono-devise XOF** avec conversion frontale opérationnelle — rejetée. La perte d'information sur la devise transactionnelle empêche tout reporting bailleur fidèle et viole l'esprit d'audit ISA 230 (la pièce justificative doit être lisible dans sa devise originale).
- **Multi-devise sans stockage XOF** (conversion à la demande à chaque lecture) — rejetée. Coût de calcul sur chaque lecture, et impossibilité de geler la valeur XOF historique (si le taux change, l'historique change rétroactivement — inacceptable comptablement).
- **Table dédiée `currency_conversion`** au lieu de colonnes dénormalisées — rejetée. Joints supplémentaires sur les requêtes les plus chaudes (balance générale, suivi budgétaire), pénalisation des performances.

## Addendum 2026-07-17 — Politique d'arrondi et résorption des écarts d'engagement (Sprint S9)

> Décisions validées le 2026-07-17 (Sprint S9, lot L4 « Intégrité montants », audit v2).
> Rattachées à cet ADR plutôt qu'à un ADR-014 dédié : l'arrondi et la résorption
> des écarts multi-taux sont des corollaires directs du modèle tripartite —
> fragmenter la doctrine des montants sur deux ADR nuirait à sa lisibilité.

### Politique d'arrondi (US-095 — F-S8-10/13)

**Règle** : tout montant XOF issu d'une conversion est arrondi **half-up à
l'unité** (0 décimale), **une seule fois, à la frontière** (persistance d'une
colonne `*_amount_xof`, décision de contrôle, écriture comptable) — **jamais
en chaîne** sur des valeurs intermédiaires. Tout le calcul amont (montant ×
taux, agrégats budgétaires, comparaisons) est mené en `Prisma.Decimal` exact.

**Justification SYSCEBNL** :

- Le XOF n'a **pas de subdivision en circulation** : la pratique comptable
  SYSCOHADA/SYSCEBNL tient le XOF à l'unité.
- La parité fixe 1 EUR = 655,957 XOF génère structurellement des fractions
  (taux à 3 décimales) : une politique d'arrondi explicite est indispensable.
- Half-up est l'arrondi arithmétique attendu par les comptables — et le
  comportement **de fait** du code historique (`Math.round` sur montants
  positifs). Le passage à `Prisma.Decimal` remplace le **mécanisme** (float64),
  pas la **règle** : zéro rupture sur les montants déjà persistés.

**Implémentation** : `ExchangeRateService.roundXofHalfUp`
(`Decimal.toDecimalPlaces(0, ROUND_HALF_UP)`), unique point d'arrondi de
`convertToXof`. Les entiers XOF produits sont très inférieurs à 2^53, donc
représentables exactement en `number` aux frontières DTO. L'interdiction
`Number(decimal)` (règle F10) reste absolue sur toute valeur **non encore
arrondie** engagée dans un agrégat ou une comparaison comptable.

### Résorption de l'écart d'engagement multi-taux (US-099 — F-S8-26) : Option A

**Problème** : un BC en devise est engagé en classe 8 à l'équivalent XOF du
taux du jour de commande (parfois le fallback indicatif) ; chaque facture
extourne l'engagement au taux d'origine mais est comptabilisée au taux de sa
propre date. En fin de vie du BC, un **résidu d'engagement** (801/802) peut
subsister alors que plus aucune facture n'est attendue.

**Décision (Option A)** : à la fin de vie du BC (`fully_invoiced` ou
`cancelled`), une **OD d'ajustement solde le résidu de classe 8**, hors
résultat. L'extourne à la facture reste au taux d'origine (inchangée).
*Justification SYSCEBNL* : la classe 8 est un cadre d'engagements hors
gestion ; un écart d'**engagement** n'est pas un écart de change réalisé. Les
comptes 676/776 (pertes/gains de change) constatent des écarts sur créances et
dettes **réglées**, pas sur des engagements statistiques. L'OD de solde est
simple, auditable, sans impact TER ni compte de résultat.

**Options rejetées** :

- **Option B — constater 676/776 à chaque facture** pour l'écart
  engagement↔facture : rejetée. Cela crée un résultat de change sur un flux
  hors bilan — hétérodoxe SYSCEBNL — et bruite le compte de résultat avec des
  écarts non réalisés portant sur des montants statistiques.
- **Option C — réévaluer l'engagement au taux du jour à chaque facture**
  (re-mesure continue de la classe 8) : rejetée. Lourde et bruyante (une OD
  par facture et par variation de taux) sans aucune exigence normative — la
  classe 8 n'est pas soumise à la réévaluation de clôture (IAS 21/SYSCEBNL
  visent les créances et dettes monétaires, pas les engagements).

**Périmètre du vrai écart de change** : 676/776 restent réservés au
**règlement** des dettes 401 en devise (taux de paiement ≠ taux de
comptabilisation). La vérification de `postPayment` sur ce point est
programmée en ouverture d'US-099 (intégration au périmètre si ≤ 2 pts, sinon
story dédiée S10).

## Références

- Acte uniforme OHADA relatif au droit comptable, Article 1 (devise de tenue comptable).
- SAP Financial Accounting — Currency Types 10/30/40/50/60 ([SAP Help Portal](https://help.sap.com/docs/SAP_ERP)).
- Oracle Financials — Functional Currency, Reporting Currency, Transaction Currency.
- IFRS — *The Effects of Changes in Foreign Exchange Rates* (IAS 21).
- ISA 230 — Audit Documentation.
- Audit GRANTFLOW IPD du 02 juin 2026, finding F1.
- Audit transversal v2 du 17 juillet 2026, findings F-S8-10/11/12/13/14/26.
- Note de cadrage Phase 0, §8.
- Commit `484839f` — premier fix multidevise sur le routage d'approbation.

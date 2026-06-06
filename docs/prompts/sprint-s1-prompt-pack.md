# Prompt Pack — Sprint S1 (DDL multidevise + service FX)

**Sprint** : S1 (semaines 5-6, juillet 2026)
**Objectif** : étendre le schéma de base de données avec les colonnes équivalent XOF + taux + date, et consolider `ExchangeRateService` comme source unique pour la conversion.
**Stories couvertes** : US-001 à US-007 (29 story points)
**ADRs concernées** : ADR-001 (DDL-first), ADR-005 (Multidevise tripartite)
**Audit findings adressés** : F1 (partiel — contrôle budgétaire prévu sprint S2), F10 (partiel — Decimal Phase 1 globale)

---

## Mode d'emploi

1. Tu colles **un prompt à la fois** dans Claude Code (ou Antigravity), dans l'ordre.
2. Tu attends que Claude Code termine et te livre un rapport.
3. Tu valides le rapport en spot-check (le critère d'acceptation est rappelé sous chaque prompt).
4. Tu enchaînes sur le suivant.
5. À la fin du Sprint S1, tu lances le prompt **VERIFY-S1** qui valide l'ensemble.

**Convention de branches** : chaque story commence par `feature/sprint-s1-us-001-ddl-xof-columns` etc. Merge `main` après revue.

**Si quelque chose part mal**, tu colles le prompt **ABORT-AND-REPORT** en bas du document.

---

## Prompt 1 — US-001 : Extension DDL avec colonnes équivalent XOF

```
TÂCHE — Sprint S1 / US-001 / fix multidevise

CONTEXTE
GRANTFLOW IPD adopte une architecture multidevise tripartite (cf. ADR-005 dans
docs/adr/adr-005-multidevise-tripartite.md). Chaque montant financier doit être
stocké à la fois dans sa devise transactionnelle ET avec son équivalent XOF +
le taux et la date du taux appliqué, pour audit-trail et reproductibilité.

Source de vérité du schéma : docs/grantflow_ddl_postgresql.sql (cf. ADR-001).
Workflow DDL-first OBLIGATOIRE : on étend le DDL en premier, jamais
prisma migrate.

CORRECTION DEMANDÉE
Étendre le DDL docs/grantflow_ddl_postgresql.sql avec un triplet de colonnes
sur les 12 tables financières concernées :

  - <numeric_amount>_amount_xof BIGINT NULL  (montant en XOF, exprimé en centimes
    si la devise XOF utilise déjà des unités entières, sinon en unité monétaire
    selon convention de la table — VÉRIFIE la convention existante pour chaque
    table avant d'écrire)
  - <numeric_amount>_fx_rate NUMERIC(14,6) NULL  (taux appliqué pour la conversion)
  - <numeric_amount>_fx_rate_date DATE NULL  (date du taux)

Pour les 12 tables suivantes (à confirmer par lecture du DDL existant) :

  procurement.purchase_request       → total_amount, total_amount_xof, fx_rate, fx_rate_date
  procurement.purchase_request_line  → unit_price + line_total (déjà GENERATED — NE PAS TOUCHER line_total ;
                                       ajouter unit_price_xof, fx_rate, fx_rate_date sur unit_price uniquement)
  procurement.purchase_order         → total_amount → idem
  procurement.purchase_order_line    → unit_price → idem
  ap.invoice                         → total_amount → idem
  ap.invoice_line                    → unit_price → idem (si applicable, vérifier si line_total GENERATED)
  gl.journal_entry_line              → debit_amount, credit_amount (deux séries de colonnes XOF)
  treasury.payment                   → total_amount → idem
  treasury.payment_line              → amount → idem
  treasury.cash_movement             → amount → idem
  gl.commitment_entry                → debit_amount, credit_amount → idem
  co.budget_consumption (si table)   → consumed_amount → idem (à confirmer en lisant le DDL)

NE PAS TOUCHER les colonnes déjà déclarées GENERATED ALWAYS AS STORED
(line_total, overhead_amount) — PostgreSQL les calcule.

CONTRAINTES
- Modifier docs/grantflow_ddl_postgresql.sql uniquement, pas le schema.prisma.
- Préserver TOUS les triggers, CHECK, et colonnes GENERATED existants.
- Ajouter un commentaire SQL `COMMENT ON COLUMN ...` pour chaque nouvelle
  colonne expliquant son rôle.
- Pas de DEFAULT sur les nouvelles colonnes (elles seront populées par
  l'application via ExchangeRateService).
- Commit unique sur branche `feature/sprint-s1-us-001-ddl-xof-columns`.

LIVRABLE
- docs/grantflow_ddl_postgresql.sql modifié.
- Rapport listant : tables modifiées, nombre de colonnes ajoutées par table,
  vérification qu'aucun trigger n'a été touché, vérification que line_total et
  overhead_amount sont toujours GENERATED.
- SHA du commit poussé sur la branche.

RAPPORT en moins de 300 mots.
```

**Critère d'acceptation US-001** : 12 tables modifiées, 36+ colonnes ajoutées (3 par table sauf cas multi-montants), aucun trigger touché, GENERATED préservé.

---

## Prompt 2 — US-002 : Migration SQL idempotente

```
TÂCHE — Sprint S1 / US-002 / migration idempotente pour US-001

CONTEXTE
US-001 a étendu docs/grantflow_ddl_postgresql.sql avec des colonnes
multidevise. Pour appliquer cette extension à une base existante (cloud Neon,
local dev) sans drop, on prépare une migration SQL idempotente.

Workflow DDL-first (cf. CLAUDE.md §9) : la migration utilise exclusivement
ALTER TABLE ... ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS. Pas de
DROP. Pas de RECREATE.

CORRECTION DEMANDÉE
Créer un nouveau fichier docs/migrations/2026-07-xx-sprint-s1-multicurrency-columns.sql
qui :
1. En tête, commentaire structuré : nom de la migration, sprint, date, story,
   description du changement, instructions d'application.
2. Pour chaque colonne ajoutée par US-001, un bloc :
     ALTER TABLE <schema>.<table>
       ADD COLUMN IF NOT EXISTS <column> <type>;
     COMMENT ON COLUMN <schema>.<table>.<column> IS '...';
3. Aucun DROP, aucun ALTER destructif.
4. À la fin, un commentaire de vérification :
     -- Vérification post-migration :
     -- SELECT column_name FROM information_schema.columns WHERE table_schema='procurement' AND column_name LIKE '%_xof';

CONTRAINTES
- Idempotente (rejouer plusieurs fois ne casse rien).
- Commit unique sur branche `feature/sprint-s1-us-002-migration-multicurrency`.
- Ne pas modifier le DDL principal (déjà fait en US-001).

LIVRABLE
- Fichier docs/migrations/2026-07-xx-sprint-s1-multicurrency-columns.sql créé.
- Rapport : nombre d'ALTER générés, vérification idempotence (rejouer
  mentalement), SHA poussé.

RAPPORT en moins de 200 mots.
```

**Critère d'acceptation US-002** : fichier migration créé, idempotent (rejouable sans casser), aucun DROP/RENAME destructif.

---

## Prompt 3 — US-003 : Synchronisation Prisma

```
TÂCHE — Sprint S1 / US-003 / synchronisation Prisma post-DDL

CONTEXTE
Les colonnes multidevise ont été ajoutées au DDL (US-001) et une migration
idempotente est prête (US-002). Maintenant, il faut synchroniser
apps/api/prisma/schema.prisma avec le nouveau schéma DB.

ATTENTION : on n'utilise PAS `prisma migrate dev`. On utilise `prisma db pull`
suivi de `prisma generate`.

PRÉREQUIS
- La migration US-002 doit avoir été appliquée sur une base de dev locale
  (Postgres Docker). Si tu n'as pas accès à une base, indique-le et
  l'utilisateur appliquera manuellement.

CORRECTION DEMANDÉE
1. Si possible : appliquer la migration sur une base locale, puis lancer
     cd apps/api
     npx prisma db pull
     npm run prisma:generate
2. Si pas de base locale : indique exactement les commandes que l'utilisateur
   doit lancer manuellement, et prépare un check des modifications attendues
   sur schema.prisma (liste des champs ajoutés par modèle Prisma).

CONTRAINTES
- Ne pas modifier schema.prisma à la main.
- Ne pas exécuter `prisma migrate dev` ou `prisma migrate deploy`.
- Commit unique sur branche `feature/sprint-s1-us-003-prisma-sync`.

LIVRABLE
- apps/api/prisma/schema.prisma mis à jour (par db pull).
- Rapport : liste des champs ajoutés par modèle Prisma, confirmation que les
  triggers et GENERATED ne sont pas perdus dans schema.prisma (Prisma ne les
  expose pas mais ne doit pas les supprimer du DDL non plus), SHA poussé.

RAPPORT en moins de 200 mots.
```

**Critère d'acceptation US-003** : schema.prisma synchronisé, client Prisma régénéré, aucune commande `migrate dev`/`deploy` exécutée.

---

## Prompt 4 — US-004 : Méthode `convertToXof` consolidée

```
TÂCHE — Sprint S1 / US-004 / consolidation ExchangeRateService.convertToXof

CONTEXTE
Cf. docs/adr/adr-005-multidevise-tripartite.md et docs/cadrage-phase-0.md §8.
ExchangeRateService existe déjà (cf. sprint précédent SHA 484839f qui a
introduit convertToXof partiellement pour le routage d'approbation). Il faut
maintenant le consolider comme source unique de toute conversion vers XOF
dans le système.

CORRECTION DEMANDÉE
Dans apps/api/src/referential/exchange-rate/exchange-rate.service.ts :

1. Vérifier ou ajouter la méthode `convertToXof(amount, currency, date?)` avec
   la signature suivante :
       interface XofConversionResult {
         xofAmount: number;
         fxRate: number;
         fxRateDate: Date;
         isIndicativeFallback: boolean;
       }
       async convertToXof(
         amount: number | Prisma.Decimal,
         currency: string,
         date?: Date,
       ): Promise<XofConversionResult>;

2. Comportement par devise :
   - currency === 'XOF' → { xofAmount: amount, fxRate: 1, fxRateDate: today, isIndicativeFallback: false }
   - currency === 'EUR' → { xofAmount: amount * 655.957, fxRate: 655.957, fxRateDate: today, isIndicativeFallback: false }
   - currency === 'USD' | 'GBP' | 'CHF' | autres :
       * Lookup dans gl.exchange_rate WHERE currency = X AND date <= requested_date ORDER BY date DESC LIMIT 1
       * Si trouvé → utiliser ce taux
       * Si pas trouvé → utiliser le FALLBACK_INDICATIVE_TO_XOF et { isIndicativeFallback: true }

3. Si currency inconnu → lever UnknownCurrencyException.

4. Documenter en JSDoc :
   - Source unique pour conversion opérationnelle (vs lookup primitive comptable).
   - Parité BCEAO immuable pour EUR.
   - Fallback indicatif pour USD/GBP/CHF tant que la table exchange_rate n'est
     pas seedée par le CG.

5. Vérifier que toutes les autres méthodes existantes du service restent en
   place et fonctionnelles.

CONTRAINTES
- Pas de duplication : la méthode doit être l'unique chemin de conversion.
- Tests unitaires : à venir en US-007 (ne pas écrire ici).
- Commit unique sur branche `feature/sprint-s1-us-004-convert-to-xof`.

LIVRABLE
- apps/api/src/referential/exchange-rate/exchange-rate.service.ts modifié.
- Rapport : signature exposée, comportement par devise vérifié, JSDoc présente,
  vérification que la méthode existante (si déjà introduite par 484839f) est
  enrichie sans duplication, SHA poussé.

RAPPORT en moins de 300 mots.
```

**Critère d'acceptation US-004** : signature stable `convertToXof(amount, currency, date?) → XofConversionResult`, BCEAO EUR exact (655,957), lookup DB pour autres devises avec fallback indicatif.

---

## Prompt 5 — US-005 : Constantes FX documentées

```
TÂCHE — Sprint S1 / US-005 / constantes FX et fallback documentés

CONTEXTE
La méthode convertToXof (US-004) s'appuie sur deux constantes :
1. Parité BCEAO immuable EUR/XOF = 655,957 (garantie par accords Bretton Woods,
   ne change pas sans modification du traité international).
2. Fallback indicatif pour USD/GBP/CHF tant que la table exchange_rate n'est
   pas alimentée par le contrôle de gestion (CG).

Pour la production future, le CG IPD validera des taux historisés. Pour la
démo et la phase de développement, on utilise un fallback documenté à valeur
indicative.

CORRECTION DEMANDÉE
Dans apps/api/src/referential/exchange-rate/exchange-rate.service.ts (ou dans
un fichier de constantes adjacent exchange-rate.constants.ts) :

1. Exporter `FX_BCEAO_EUR_XOF = 655.957` avec JSDoc :
       /**
        * Parité immuable BCEAO EUR/XOF, fixée par les accords successifs de
        * Bretton Woods, garantie par le Trésor français depuis 1999. NE PAS
        * MODIFIER sauf modification du traité international.
        */

2. Exporter `FALLBACK_INDICATIVE_TO_XOF = Object.freeze({ USD: 600, GBP: 800, CHF: 700 })`
   avec JSDoc :
       /**
        * Taux fallback INDICATIFS pour USD/GBP/CHF tant que la table
        * gl.exchange_rate n'est pas alimentée par le contrôle de gestion.
        * À NE PAS UTILISER EN PRODUCTION pour des décisions comptables.
        * Chaque usage est tracé par log Pino avec isIndicativeFallback=true.
        */

3. La méthode convertToXof (US-004) doit consommer ces constantes.

4. Documenter dans docs/uemoa-exchange-rate.md la politique : parité fixe EUR,
   lookup historisé pour autres devises, fallback démo loud loggé.

CONTRAINTES
- Object.freeze pour éviter modification accidentelle à l'exécution.
- Commit unique sur branche `feature/sprint-s1-us-005-fx-constants`.

LIVRABLE
- Constantes exportées et consommées par convertToXof.
- docs/uemoa-exchange-rate.md mis à jour.
- Rapport : symboles exportés, JSDoc présente, doc utilisateur mise à jour,
  SHA poussé.

RAPPORT en moins de 200 mots.
```

**Critère d'acceptation US-005** : constantes exportées, JSDoc présente, doc utilisateur à jour.

---

## Prompt 6 — US-006 : Audit trail Pino sur conversion

```
TÂCHE — Sprint S1 / US-006 / log Pino structuré sur convertToXof

CONTEXTE
Cf. docs/adr/adr-005-multidevise-tripartite.md.
Chaque appel à convertToXof doit produire un log Pino structuré pour audit
trail. Cela permet, en cas d'audit ou de litige, de retrouver exactement la
conversion appliquée à un instant donné.

CORRECTION DEMANDÉE
Dans apps/api/src/referential/exchange-rate/exchange-rate.service.ts :

1. Injecter `Logger` (Pino via nestjs-pino, scope this.logger = new Logger(ExchangeRateService.name)).

2. À chaque appel de convertToXof, après la résolution, émettre :
       this.logger.info(
         {
           event: 'fx_conversion',
           currency,
           rawAmount: Number(amount),
           xofAmount,
           fxRate,
           fxRateDate: fxRateDate.toISOString().slice(0, 10),
           isIndicativeFallback,
         },
         `FX convert ${amount} ${currency} → ${xofAmount} XOF`,
       );

3. Si `isIndicativeFallback === true`, émettre en plus :
       this.logger.warn(
         { event: 'fx_indicative_fallback_used', currency, xofAmount },
         `Indicative fallback used for ${currency} — replace with validated rate before production`,
       );

4. Pas d'événement personnel ni d'amount masking — c'est un log technique
   FX, pas un log utilisateur (pas de PII).

CONTRAINTES
- Logger Pino injecté par DI, pas hardcodé.
- Commit unique sur branche `feature/sprint-s1-us-006-fx-audit-log`.

LIVRABLE
- exchange-rate.service.ts modifié.
- Rapport : emplacement des logs, exemple de payload émis, vérification que
  le warn fallback est bien émis quand applicable, SHA poussé.

RAPPORT en moins de 200 mots.
```

**Critère d'acceptation US-006** : chaque conversion loggue le payload structuré complet ; fallback indicatif émet en plus un warn.

---

## Prompt 7 — US-007 : Tests unitaires convertToXof

```
TÂCHE — Sprint S1 / US-007 / 6 tests unitaires sur convertToXof

CONTEXTE
Pour garantir le contrat de convertToXof (US-004 à US-006) et prévenir les
régressions, on écrit 6 tests unitaires ciblés.

CORRECTION DEMANDÉE
Dans apps/api/src/referential/exchange-rate/__tests__/exchange-rate.service.spec.ts
(à créer ou enrichir) :

1. Test 1 — XOF passe-through :
       convertToXof(10000, 'XOF') → { xofAmount: 10000, fxRate: 1, isIndicativeFallback: false }
       (assertion exacte sans tolérance)

2. Test 2 — EUR parité BCEAO exacte :
       convertToXof(100000, 'EUR') → { xofAmount: 65595700, fxRate: 655.957 }
       (assertion exacte, 100 000 × 655.957)

3. Test 3 — USD avec taux DB :
       Stub gl.exchange_rate WHERE currency='USD' avec rate=605, date='2026-06-01'
       convertToXof(100, 'USD', '2026-06-10') → { xofAmount: 60500, fxRate: 605, isIndicativeFallback: false }

4. Test 4 — USD sans taux DB → fallback :
       Stub gl.exchange_rate vide
       convertToXof(100, 'USD') → { xofAmount: 60000, fxRate: 600, isIndicativeFallback: true }
       Vérifier qu'un log warn 'fx_indicative_fallback_used' est émis (spy logger).

5. Test 5 — Devise inconnue :
       convertToXof(100, 'JPY') → throws UnknownCurrencyException

6. Test 6 — Decimal en entrée :
       convertToXof(new Prisma.Decimal('100.50'), 'EUR') → { xofAmount: 65923.6...,
       fxRate: 655.957 }
       (vérifie que Decimal est correctement traité)

CONTRAINTES
- Utiliser jest-mock-extended `mockDeep<PrismaService>()` pour Prisma
  (déjà en place si Sprint S2bis a été fait, sinon utiliser le pattern existant
  des autres specs du module).
- Spy Pino logger pour vérifier les logs émis.
- Tests verts à la première exécution.
- Commit unique sur branche `feature/sprint-s1-us-007-fx-tests`.

LIVRABLE
- exchange-rate.service.spec.ts avec 6 nouveaux tests verts.
- Rapport : 6 tests passent, couverture du module ExchangeRateService > 90 %,
  SHA poussé.

RAPPORT en moins de 200 mots.
```

**Critère d'acceptation US-007** : 6 tests verts, couverture > 90 % sur le service.

---

## Prompt VERIFY-S1 — Vérification globale de fin de sprint

```
TÂCHE — Sprint S1 / VERIFY / vérification globale

CONTEXTE
Le Sprint S1 est terminé. Les 7 stories US-001 à US-007 ont été livrées sur
des branches distinctes mergées sur main. Avant de clôturer le sprint, on
exécute une vérification globale.

VÉRIFICATIONS DEMANDÉES
1. DDL : ouvrir docs/grantflow_ddl_postgresql.sql et vérifier que les 12 tables
   financières ont leur triplet *_amount_xof, *_fx_rate, *_fx_rate_date.
   Lister les colonnes ajoutées par table.

2. Migration : ouvrir docs/migrations/2026-07-xx-sprint-s1-multicurrency-columns.sql
   et vérifier que c'est idempotent (chaque ALTER avec IF NOT EXISTS, pas de DROP).

3. Schéma Prisma : vérifier que apps/api/prisma/schema.prisma reflète les
   colonnes ajoutées. Liste 3-4 modèles enrichis pour preuve.

4. ExchangeRateService : vérifier la signature et la docstring de convertToXof.
   Vérifier que FX_BCEAO_EUR_XOF et FALLBACK_INDICATIVE_TO_XOF sont exportés
   et utilisés. Vérifier que les logs Pino sont câblés.

5. Tests : lancer `npm test -- exchange-rate.service.spec.ts` et reporter le
   résultat. Lancer `npm run lint` et `npm run typecheck` côté API.

6. Documentation : docs/uemoa-exchange-rate.md est-il à jour ?

7. Anti-leak : recherche `sk-ant`, `npg_`, `postgresql://.*@` dans les fichiers
   modifiés — confirmer NO_LEAK.

LIVRABLE
- Rapport structuré en sections (DDL / Migration / Prisma / Service /
  Tests / Doc / Anti-leak) avec ✅ ou ❌ par item.
- Liste des écarts détectés et stories de rattrapage proposées (US-XXX-bis
  potentielles).

RAPPORT en moins de 500 mots.
```

---

## Prompt ABORT-AND-REPORT — En cas de problème

À utiliser si une story sort de sa scope ou casse main, pour obtenir un rollback propre.

```
TÂCHE — Sprint S1 / ABORT-AND-REPORT

CONTEXTE
Une story du Sprint S1 a posé problème. Avant de continuer, on fait le point.

ACTIONS DEMANDÉES
1. Identifier la branche en cours et son état (commit, push).
2. Identifier ce qui a été tenté, ce qui a réussi, ce qui a échoué.
3. Proposer une trajectoire :
     - Option A : rebase + reset propre, redémarrer la story.
     - Option B : forward fix sur la même branche.
     - Option C : créer une story d'investigation US-XXX-debug et
       documenter le bug avant de reprendre.

LIVRABLE
- Rapport synthétique : état actuel, diagnostic, recommandation.

RAPPORT en moins de 300 mots.
```

---

## Résumé Sprint S1

| Story | Pts | Critère d'acceptation | Statut |
|---|---|---|---|
| US-001 | 8 | DDL étendu, 12 tables, triplets ajoutés | `todo` |
| US-002 | 5 | Migration idempotente prête | `todo` |
| US-003 | 1 | Prisma synchronisé via db pull | `todo` |
| US-004 | 5 | convertToXof consolidé, contrat stable | `todo` |
| US-005 | 2 | Constantes exportées + doc utilisateur | `todo` |
| US-006 | 3 | Logs Pino sur chaque conversion | `todo` |
| US-007 | 5 | 6 tests verts, couverture > 90 % | `todo` |
| **VERIFY-S1** | — | Tous les items ✅ | `todo` |

**Effort total** : 29 points (cible sprint 30-50).

**Prochain sprint** : S2 — Conversion sur contrôle budgétaire et limites caisse (US-010 à US-014).

---

*Prompt Pack Sprint S1 — Version 1.0 — 02 juin 2026*

# ADR-003 — Modular monolith comme architecture de départ

**Statut** : accepted
**Date** : 2026-06-02
**Auteur** : El Hadj Amadou NIANG

## Contexte

GRANTFLOW IPD recouvre une dizaine de bounded contexts métier identifiés sur la base de l'analyse DDD (Domain-Driven Design) du domaine SYSCEBNL : authentification et RBAC (`auth`), référentiel (`referential` : grants, donors, projects, suppliers, budget lines, accounts), achats (`procurement` : DA, BC, GR), comptes fournisseurs (`ap` : factures, matching, OCR), grand livre (`gl` : journal, écritures, périodes, clôture), comptabilité analytique (`co` : centres de coût, suivi budget, overhead), trésorerie (`treasury` : payment runs, caisse), reporting (`reporting` : états SYSCEBNL, rapports bailleur), audit (`audit` : event_log, hash chain), et après extension : grant office (`grant_office` : Note Technique, eligibility), audit conventionnel (`compliance_audit` : missions, signatures).

Trois architectures de déploiement étaient envisageables : (a) **un monolithe unique** sans séparation modulaire stricte, (b) **un modular monolith** avec séparation forte des bounded contexts dans une seule application déployée, (c) **un ensemble de micro-services** un par bounded context, déployés indépendamment.

Le contexte du projet impose plusieurs contraintes : équipe d'un seul développeur (l'auteur), cible de déploiement initiale modeste (Render free tier pour la démo, infrastructure IPD à dimensionner pour le pilote), budget infrastructure proche de zéro, vitesse de développement prioritaire sur scalabilité massive, latence acceptable de quelques centaines de millisecondes (pas de temps réel sub-100ms).

## Décision

GRANTFLOW IPD adopte une architecture **modular monolith** matérialisée par :

- Une seule application NestJS dans `apps/api/` avec un module Nest par bounded context (`auth/`, `procurement/`, `ap/`, `gl/`, `co/`, `reporting/`, `treasury/`, `referential/`, ultérieurement `grant_office/`, `compliance_audit/`).
- Une seule base de données PostgreSQL, avec **schémas Postgres séparés par contexte** (`auth.*`, `ref.*`, `procurement.*`, `ap.*`, `gl.*`, `co.*`, `reporting.*`, `audit.*`).
- Les communications inter-modules passent par les **services injectés** (DI NestJS), pas par HTTP ni message broker.
- Les modules exposent leurs interfaces via `exports` du `@Module()` et n'exposent **pas leurs Repository Prisma** — seul le service est l'API du module.
- Une seule frontend Next.js dans `apps/web/`.
- Un déploiement unique par environnement (un conteneur API + un conteneur frontend + une instance DB).

**Règle d'or de modularité** : un module ne dépend que de ses dépendances déclarées dans `imports`, jamais de l'implémentation interne d'un autre module. Si un service A dans module M1 doit appeler un service B dans module M2, alors M2 exporte B et M1 importe M2 — pas de raccourci direct.

**Trajectoire d'extraction** : si un module atteint une charge ou une criticité justifiant son extraction (typiquement : reporting bailleur sous charge, OCR Vision avec scaling indépendant), il peut être **extrait en service indépendant** sans réécriture, en remplaçant l'injection DI par un client HTTP/gRPC. La discipline modulaire actuelle facilite cette extraction future.

## Conséquences

### Positives

- **Vitesse de développement** maximale pour un développeur unique : une stack, un déploiement, un debugging cycle.
- **Atomicité transactionnelle native** entre modules — une transaction Prisma peut couvrir des écritures sur procurement et accounting, garantissant la cohérence comptable sans saga distribuée.
- **Coût infrastructure minimal** : un seul conteneur API à scaler, pas de message broker, pas de service mesh.
- **Refactoring inter-modules trivial** comparé à des services distribués (pas de coordination de version d'API).
- **Trajectoire d'extraction préservée** : la discipline modulaire actuelle est la fondation d'une éventuelle migration micro-services.

### Négatives

- **Risque de couplage rampant** entre modules si la discipline d'exports/imports n'est pas tenue — atténué par la documentation des règles dans CLAUDE.md §4 et la revue de code.
- **Scaling horizontal limité** par la base de données unique. Acceptable pour le volume IPD (< 10 000 DA/an estimées).
- **Un crash de l'app tombe tout** — atténué par le déploiement Render avec health checks et redémarrage automatique.
- **Compilation et tests deviennent plus lents** à mesure que la codebase grandit ; cible : maintenir CI < 15 min.

## Alternatives considérées

- **Monolithe non-modulaire** — rejeté. Sans séparation explicite, la codebase évoluerait en spaghetti et l'extraction future serait impossible sans réécriture complète.
- **Micro-services dès le départ** — rejeté. Multipliication par 10 du coût opérationnel et du temps de développement pour un bénéfice nul à cette échelle. Anti-pattern documenté dans la littérature (« Don't start with microservices », Martin Fowler, 2015).
- **Serverless functions** (Vercel Functions, AWS Lambda par module) — rejeté. Cold start incompatible avec l'UX cible, billing complexity, debugging plus difficile.

## Références

- `CLAUDE.md` §3 — Architecture.
- Sam Newman, *Building Microservices* (2nd ed., 2021), Ch. 1-3.
- Martin Fowler, [Monolith First](https://martinfowler.com/bliki/MonolithFirst.html), 2015.
- Simon Brown, [Modular Monolith](https://www.codingthearchitecture.com/2015/03/08/package_by_component_and_architecturally_aligned_testing.html).
- Note de cadrage Phase 0, §1.

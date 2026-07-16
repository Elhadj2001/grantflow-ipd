# CLOSE-S6 — Rapport de sprint (2026-07-16)

> Sprint S6 : workflow Note Technique + activation complète de
> l'EligibilityEngine (PPT IPD slide 7) + dette de restauration prod.
> **28 pts livrés.**

## US livrées

| US | Contenu | Pts |
|---|---|---|
| US-051 | Transitions workflow Note Technique (draft→pending_daf→validated_daf→active→superseded, supersede atomique) | 5 |
| US-052 | Endpoints REST des transitions (submit/validate/reject/activate, DTO Zod, Swagger) | 3 |
| US-053 | SoD sur validate NT (rédacteur ≠ valideur, dérogation `single_actor_authorized`, break-glass `X-Bypass-SoD-Reason`) | 5 |
| US-054 | DDL `purchase_request` : `expense_nature_code`, `pasteur_paris_reimbursed`, `supplier_invoice_number` + index partiels | 3 |
| US-055 | DDL `budget_line.category` + CHECK (domaine commun aux natures) | 3 |
| US-056 | ContextBuilder : lecture directe `budget_line.category` (fallback proxy + WARN) → **PPT-4 activée** | 3 |
| US-057 | Audit d'activation des règles PPT + synthèse e2e « parcours DA » | 3 |
| US-142 | `render.yaml` aligné sur l'inventaire env vars (+ WEB_ORIGIN, KC_PROXY_HEADERS) + checklist Blueprint + script de parité | 3 |

## Statut final PPT IPD slide 7 — **7/7 ACTIFS via submit()**

| Invariant | Code | Statut |
|---|---|---|
| PPT-1 nature inéligible | `ELIG_NATURE_NOT_ALLOWED` | ✅ bloque (S5) |
| PPT-2 hors fenêtre convention | `ELIG_DATE_OUT_OF_WINDOW` | ✅ bloque (S5) |
| PPT-3 plafond par requête | `ELIG_LINE_BUDGET_EXCEEDED` | ✅ bloque (S5) |
| PPT-4 ligne ↔ nature | `ELIG_LINE_NATURE_INCOHERENT` | ✅ bloque (US-055+056) |
| PPT-5 remboursé Pasteur Paris | `ELIG_PASTEUR_PARIS_REIMBURSED` | ✅ bloque (**CLOSE-S6** : transport US-054 branché dans `runEligibilityGate`) |
| PPT-6 doublon facture inter-projet | `ELIG_CROSS_PROJECT_DUPLICATE` | ✅ warning non bloquant (**CLOSE-S6**) |
| PPT-7 période fiscale close | `ELIG_PERIOD_CLOSED` | ✅ bloque (S5) |

La « Dette PPT-5/6 » d'ADR-007 est **RÉSOLUE** (transport des champs
matérialisés au croisement des lignées 054 × 055-057, fait au close).

## Tests

- **1142 / 1142, 80 suites** (baseline pré-close 1118 → +23 stack Note
  Technique, +1 PPT-5bis ; PPT-5 ajoutée au tableau de synthèse).
- tsc 0, lint API 0, anti-leak OK, F2 = 0.
- Vérification après CHAQUE merge (tsc + lint + suite) : jamais rouge.

## Migrations & backfill

- **US-054** : appliquée + vérifiée sur Docker dev le 2026-06-10 (3 colonnes,
  2 index, rejouée = no-op).
- **US-055** : **réserve maintenue** — Docker Desktop/WSL indisponible sur les
  sessions du 2026-07-13 et du close. Migration idempotente à rejouer sur dev
  au prochain Docker up, et à inclure dans le run Neon standard (workflow CI
  `migrate-neon.yml` livré avec la stack US-051).
- Vérif triggers/CHECK/GENERATED (`\d+`) : à faire au même moment (aucun des
  deux fichiers ne touche triggers ni colonnes générées — additifs purs).
- **Backfill** : `scripts/backfill-budget-line-category.sql` — dry-run par
  défaut (rapport lignes résolubles / non résolubles), APPLY gated par
  `SET grantflow.backfill_apply='on'`, idempotent (ne touche que les NULL).
  **Exécution prod = décision utilisateur séparée.**

## Dettes ouvertes restantes

1. **R2 / stockage (US-143 pressenti)** : variables `S3_*` volontairement
   absentes de la prod → upload PDF de BC KO. Valider les credentials via
   `scripts/test-r2-credentials.ts` (putObject réel) puis re-saisir sur Render.
2. **Backfill prod `budget_line.category`** : script prêt, exécution Neon à
   décider (sinon fallback proxy + WARN, jamais bloquant).
3. **Peuplement des nouveaux champs par l'UI** : les DTO de création de DA ne
   posent pas encore `expense_nature_code` / `pasteur_paris_reimbursed` /
   `supplier_invoice_number` — la gate reste dormante pour les DA qui n'en ont
   pas (story UI/DTO à planifier, avec rôle GO dédié US-058).
4. **Réserve Docker locale** (cf. Migrations) — à lever au prochain démarrage.
5. **Résidu NextAuth Vercel** (crash « Configuration ») — traité côté user,
   hors périmètre API.

## Annexe — incident prod 2026-07-13

Après ~2 mois d'inactivité : variables BOOT perdues sur Render
(`KEYCLOAK_URL`… → deploy failed), `S3_*` supprimées, UptimeRobot en pause,
Neon suspendue. Restauration user + kit versionné :
`docs/deploy/env-vars-inventory.md`, `docs/deploy/prod-restoration-2026-07-13.md`,
`scripts/prod-health-check.{sh,ps1}`, `scripts/check-render-env-parity.sh`
(US-142). Nouvelle URL API : `grantflow-api-cvde.onrender.com`.

## Annexe — git log main (état au close ; le commit de clôture `chore(docs): close Sprint S6` s'ajoute au-dessus)

```
ca45587 feat(grant-office): Segregation of Duties on Note Technique validate (US-053)
dc2db75 feat(grant-office): REST endpoints for Note Technique transitions (US-052)
1a1780d feat(grant-office): Note Technique workflow transitions (US-051)
6e4a70d chore(deploy): align render.yaml with env-vars inventory + restoration kit (US-142)
e4f2f02 test(eligibility): PPT rules activation audit + synthesis e2e (US-057)
3bf4c96 feat(grant-office): read budget_line.category directly in context builder (US-056)
b82dd54 feat(referential): DDL budget_line.category for line/nature coherence (US-055)
d076915 feat(procurement): DDL purchase_request materialized fields PPT-5/6 (US-054)
a319911 test(eligibility): PPT rules activation audit + synthesis e2e (US-057)
6eee965 feat(grant-office): read budget_line.category directly in context builder (US-056)
b6d09ab chore(deploy): align render.yaml with env-vars inventory (US-142)
8aa2a70 chore(deploy): update prod API URL to grantflow-api-cvde (service recreated)
7e9c4e9 feat(referential): DDL budget_line.category for line/nature coherence (US-055)
7c06ea6 docs(deploy): prod restoration kit — env inventory + checklist + health-check
9676d71 feat(procurement): DDL purchase_request champs matérialisés PPT-5/6 (US-054)
```

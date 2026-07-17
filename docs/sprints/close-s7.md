# CLOSE-S7 — Sprint S7 (cadence réelle, juillet 2026)

> **Thème** : effectivité de l'Eligibility Engine côté utilisateurs + dettes
> courtes. 6 stories (dont US-069 ajoutée en cours de sprint sur retour user).
> **Livré : 22 pts, sprint CLOS À 100 % le 2026-07-17** — 5 stories mergées
> main (US-064/065/066/068/069), US-067 exécutée sur Neon (seed seul, backfill
> différé documenté), rôle GO créé sur Keycloak PROD. Aucune action restante.

## Stories livrées

| ID | Story | Pts | Branche (SHA story) |
|---|---|---|---|
| US-064 | Formulaire DA : champs éligibilité (nature via `GET /expense-natures`, flag Pasteur Paris, n° facture) → colonnes US-054 → `runEligibilityGate` ; refus PPT restitué en panneau FR dédié (`EligibilityErrorAlert`), détail DA enrichi | 5 | `fb11d9f` |
| US-065 | Rôle **GO** (Grant Office, ADR-006) : realm dev + user `go.demo@pasteur.sn`, seeds, `@Roles` NT (crée/édite/soumet/active — validation/rejet restent DAF, SoD ADR-009 intacte), lecture expense-natures/overhead/pilotage, sidebar + badge | 5 | `1c052e1` |
| US-066 | `GET /api/v1/dashboard/summary` : compteurs en 1 requête (groupBy DA, factures, conventions, paiements) — fan-out front supprimé (8 → 1), scoping rôle aligné listes sources | 3 | `47eefdc` |
| US-068 | Sous-titres Poppins Light (`ipd-bleu-fonce` AA) via PageHeader ; infobulle « ≈ X XOF » sur montants devise ≠ XOF (colonnes `*_amount_xof`, zéro recalcul front) — DA/BC/factures | 2 | `4a901c3` |
| US-069 | Aperçu PDF fiable (diagnostic : erreurs storage non mappées → 500 brut ; fix 404 `DOCUMENT_NOT_FOUND` / 503 `DOCUMENT_STORE_UNAVAILABLE`) + `DocumentsPanel` généralisé (facture/BC/GR/DA, listing dérivé des `pdfObjectKey`, visionneuse plein écran, pattern projet frère) | 5 | `e396502` |
| US-067 | **Préparée** : seed `ref.exchange_rate` USD↔XOF (590,50, daté 2026-07-15, idempotent — SQL prod + miroir seed.ts) ; backfill `budget_line.category` prêt (dry-run défaut). **Exécution Neon = DATABASE_URL + GO user** | 2 | `02f7c7c` |

## Merges (ordre) et conflits résolus

`cb922b9` (069, mergée en avance sur validation user) → `8df4110` (064) →
`cda8da2` (066) → `782babe` (065, conflit `expense-nature.controller` :
**union** des @Roles US-064 saisisseurs + US-065 GO) → `f2beed6` (068,
conflit `lib/api/procurement.ts` : cumul champs éligibilité + `total_amount_xof`)
→ `3205ad1` (067 prep, seed.ts auto-mergé user GO + taux USD).

## VERIFY final (post-merges)

- **API : 1162/1162 (82 suites)** — tsc 0, lint 0.
- **Web : 689/689 (84 suites)** — tsc 0, lint 0, `next build` OK.
- Anti-leak : aucun secret réel ; 2 placeholders documentaires historiques
  neutralisés (`<AT>`) au commit de clôture.

## Événements du sprint

- **US-143 FERMÉE (2026-07-17)** : S3_* restaurés et vérifiés en prod
  (`object uploaded`, BC-2026-0001 → R2). Cause racine historique :
  corruption presse-papier des tokens (cf. post-mortem §5 + piège documenté).
  Conséquence assumée : les documents capturés pendant la fenêtre sans
  stockage (dont FAC-SIM-BC-2026-0002-1) n'ont pas d'objet R2 → 404
  « Aucun document archivé » **attendu et définitif** (US-069).
- Tier fonctionnel non-boot (SMTP + ANTHROPIC_API_KEY) restauré et ajouté à
  la parité env vars (commit `a399bc4` pré-sprint).

## Actions utilisateur — TOUTES SOLDÉES (sprint clos à 100 %)

1. ~~**Keycloak PROD** : créer le rôle `GO` + l'utilisateur Grant Office~~ —
   **FAIT le 2026-07-17** via l'admin UI, vérifié (le realm.json ne
   s'importe qu'à la création du conteneur, d'où l'action manuelle).
2. ~~**US-067 — exécution Neon**~~ — **EXÉCUTÉE le 2026-07-17 (GO « seed
   seul »)** : inventaire préalable (2 parités fixes EUR seulement — le taux
   605,50 @01/07 d'un dépannage manuel évoqué n'existait pas en base), seed
   USD↔XOF 590,50 @2026-07-15 appliqué et vérifié (4 lignes finales dans
   `ref.exchange_rate`) → WARN `fx_indicative_fallback_used` éteints pour
   l'USD. **Backfill `category` DIFFÉRÉ sur dry-run** : 24 lignes budgétaires
   toutes NULL, 0 résoluble (aucune DA ne portait encore
   `expense_nature_code` — le formulaire US-064 vient d'arriver). Idempotent
   et rejouable quand l'historique de natures aura vécu ; d'ici là, fallback
   proxy US-056 + WARN, jamais bloquant.

## Dettes / backlog notés

- PDF archivé de DA et de bon de livraison (GR) — à générer si souhaité
  (noté sur la ligne US-069 du backlog).
- Page front « Notes Techniques » (l'entrée nav GO viendra avec elle).
- Custom domain (répercussions d'URL Render) — inchangé.
- Réserve Docker locale (migrations US-055 dev) — inchangée.

## Annexe — git log du sprint (depuis 7093c51)

```
3205ad1 Merge branch 'feature/sprint-S7-US-067-data-prod'
f2beed6 Merge branch 'feature/sprint-S7-US-068-ui-polish'
782babe Merge branch 'feature/sprint-S7-US-065-role-go'
cda8da2 Merge branch 'feature/sprint-S7-US-066-dashboard-summary'
8df4110 Merge branch 'feature/sprint-S7-US-064-da-eligibility-fields'
cb922b9 Merge branch 'feature/sprint-S7-US-069-documents-panel'
09e5a0c docs(deploy): US-143 fermee — S3_* restaures et verifies en prod (2026-07-17)
76fe80b docs(backlog): US-069 — contexte prod actualise (US-143 fermee)
e396502 feat(documents): US-069 — apercu PDF fiable + panneau Documents generalise
02f7c7c feat(data): US-067 — seed taux USD→XOF date (preparation, application sur GO user)
4a901c3 feat(ui): US-068 — sous-titres Poppins Light + infobulle equivalent XOF
1c052e1 feat(rbac): US-065 — role GO (Grant Office) dedie, ADR-006
47eefdc feat(dashboard): US-066 — endpoint agrege GET /dashboard/summary
fb11d9f feat(procurement): US-064 — champs eligibilite dans le formulaire DA
```

---

_Clôture rédigée le 2026-07-17 — El Hadj Amadou NIANG (assisté Claude Code)._

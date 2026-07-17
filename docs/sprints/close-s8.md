# CLOSE-S8 — Sprint S8 (cadence réelle, juillet 2026)

> **Thème** : résorption de l'audit transversal v2 (`docs/audit-codebase-2026-07-17.md`).
> **Livré mergé main : ~29 pts** — lots L1, L5, L2, L3 (~27,5 pts) + hotfix
> L1-bis « étiquette devise journal » (~1,5 pt) surgi en cours de sprint.
> **L4 (dette montants ADR-005) reporté en Sprint S9 dédié**, périmètre
> enrichi de F-S8-26 (résorption de l'écart d'extourne multi-taux).

## Stories livrées (ordre de merge)

| Lot | ID | Story | SHA | Merge |
|---|---|---|---|---|
| L1 | US-075 | 4 actions cassées : sandbox iframe aperçu PDF (F-S8-01), `ackRef` confirmation BC (F-S8-21), enveloppe `lines` édition GR (F-S8-22), formats U+202F PDF reporting + emails (F-S8-15/16) | `df95796` | FF main |
| L5 | US-076 | Entrées sidebar « Bons de commande » / « Réceptions » / « Analytique » — fin des pages orphelines (F-S8-05/24), « Réception rapide » renommée | `12f9701` | FF main |
| L2 | US-077 | OCR pdfparse fiable : taux jamais capturé comme montant, recherche bornée à la ligne, cohérence HT+TVA≈TTC (warning + confiance dégradée), ligne de repli « Import global », devise près des totaux (F-S8-04) | `980d765` | lot |
| L2 | US-078 | `MATCHING_EMPTY_INVOICE` 409 : plus de « Rapprochée » par vacuité, précondition totaux > 0 codée (F-S8-02/06) | `21c95f6` | lot |
| L2 | US-079 | `INVOICE_NO_LINES_NOT_POSTABLE` 409 (fin du 404 trompeur) + bouton Comptabiliser désactivé avec bandeau explicite (F-S8-03) | `ef99261` | FF `ef99261` |
| L1-bis | hotfix | Journal : label **XOF** systématique sur les montants (tenue fonctionnelle) + secondaire « ≈ 5 000,00 USD @ 590,50 » — fin du « montant XOF + label USD » (F-S8-25) | `7943844` | FF main |
| L3 | US-091 | RBAC lectures sensibles : détail payment-runs/paiements, PDF/Excel états SYSCEBNL (acteur + locked-only BAILLEUR), comptes bancaires (IBAN), templates (F-S8-17/18/19/20) | `e040db4` | lot |
| L3 | US-092 | Reject interdit sur facture `posted`/`partially_paid` — plus d'écritures orphelines (F-S8-07) | `364c163` | lot |
| L3 | US-093 | `complete` GR vérifie l'état courant du BC — un GR draft ne rouvre plus un BC annulé (F-S8-08) | `81f9565` | lot |
| L3 | US-094 | Approve payment run résilient : marquage par paiement, reprise idempotente, re-validation des factures entre prepare et approve (F-S8-09) | `c1f5a15` | merge `8f59b2c` |

## VERIFY final (post-merges, main)

- **API : 1191/1191 (84 suites)** — tsc 0, lint 0.
- **Web : 700/700 (86 suites)** — tsc 0, lint 0, `next build` OK.

## Contexte terrain (validations user en prod)

- B1 (aperçu PDF), B4 (OCR) et L5 (navigation) **confirmés en prod**.
- Matching « écart bloquant » sur la ligne de repli « Import global » =
  comportement attendu (UNMATCHED → circuit exception/correction, plus
  jamais de matched par vacuité).
- `ANTHROPIC_API_KEY` posée sur Render — provider Vision testé séparément
  par l'user (pdfparse reste le fallback durci par US-077).
- Rôle GO + user Grant Office créés sur Keycloak PROD (S7 soldé).

## Périmètre Sprint S9 (dette montants ADR-005 — lot L4 enrichi)

1. F-S8-10/13 — `convertToXof` + agrégats budgétaires en `Prisma.Decimal`.
2. F-S8-14 — triplets `*_amount_xof`/`fx_rate`/`fx_rate_date` persistés sur
   DA/facture/BC/paiement + backfill idempotent (l'infobulle US-068 lit NULL).
3. F-S8-11/12 — totaux DA et simulateur en Decimal.
4. F-S8-26 — politique de résorption de l'écart d'extourne multi-taux
   (engagement au taux indicatif vs facture au taux seedé) : écriture
   d'ajustement de change en fin de vie du BC ou à la clôture.

---

_Clôture rédigée le 2026-07-17 — El Hadj Amadou NIANG (assisté Claude Code)._

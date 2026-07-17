# Audit transversal de cohérence v2 — 2026-07-17 (base Sprint S8)

> **Périmètre** : 5 bugs prod déclencheurs (facture IMPORT-2026-653e4da2,
> BC-2026-0001) + balayage transversal 7 axes (calculs, machines à états,
> storage, routes/contrats, RBAC, eligibility, formats).
> **AUCUN fix appliqué** — findings uniquement, corrections à décider ensemble.
> Sévérités : 🔴 bloquant · 🟠 majeur · 🟡 mineur.

---

## Partie 1 — Les 5 bugs prod (diagnostic complet)

### F-S8-01 🔴 [B1] Aperçu PDF cassé pour TOUS les documents — `sandbox` sur l'iframe bloque le viewer PDF Chromium

- **Localisation** : `apps/web/components/common/DocumentViewer.tsx:138` (`sandbox="allow-same-origin"`).
- **Preuve / test discriminant** (user) : BC-2026-0001 échoue AUSSI alors que son objet R2 existe (log `object uploaded`, Content-Type posé) → le stockage est hors de cause.
- **Chaîne instruite** — les 4 pistes du brief :
  1. Client HTTP : `apiFetchBlob` (`apps/web/lib/api-client.ts`) fait bien `res.blob()` (jamais `res.json()`), Authorization en header. ✅ hors de cause.
  2. Type du Blob : hérité du `Content-Type` de la réponse — l'API le pose. ✅ hors de cause.
  3. Endpoint : `invoice.controller.ts:177-181` et `purchase-order.controller.ts:146-150` propagent `Content-Type: application/pdf` + `Content-Length`. ✅ hors de cause.
  4. CSP front : aucun header CSP dans `next.config` (pas de `frame-src`). ✅ hors de cause.
- **Cause racine** : l'iframe d'aperçu porte `sandbox="allow-same-origin"` (hérité de l'ancien `PdfFrame`, conservé lors du portage US-069). **Chromium n'instancie pas son viewer PDF interne dans une iframe sandboxée** (le viewer requiert un contexte non sandboxé / scripts) → page blanche/icône cassée pour TOUT PDF, quel que soit le blob. Le projet frère de référence — qui fonctionne — n'a **aucun attribut sandbox** sur ses iframes (`apercu-pdf.tsx:81`, `visionneuse.tsx:77`).
- **Repro** : n'importe quel détail facture/BC avec PDF existant → aperçu vide ; retirer l'attribut `sandbox` en devtools → le PDF s'affiche.
- **Fix proposé** : retirer `sandbox` de l'iframe (blob local même-origine, PDF sans scripts exécutables par construction — le frère vit sans depuis le début) ; test RTL sur l'attribut. **1 pt.**
- _Données prod à intégrer dès réception (user) : status + content-type + erreurs console de la requête PDF — attendues confirmatoires (200/application/pdf, pas d'erreur réseau)._

### F-S8-02 🔴 [B2] Matching 3-voies « Match parfait » par vacuité (0 ligne)

- **Localisation** : `apps/api/src/invoicing/services/matching.service.ts:242-249` ; absence de garde après le chargement de la facture (`:93-99`).
- **Mécanique** : la boucle `for (const il of invoice.lines)` ne s'exécute pas quand `lines=[]` → `details=[]` → `hasPrice=false`, `hasQty=false` → `newStatus = InvoiceStatus.matched`. Le seul garde amont est `totalReceived > 0` (réceptions du BC — satisfait par BC-2026-0001). Le summary affiche « 0 ligne rapprochée » = l'écran constaté.
- **Cause racine** : agrégation de verdict en `some()` sur une liste potentiellement vide — un « tous OK » vide est indistinguable d'un vrai match parfait.
- **Fix proposé** : garde explicite `if (invoice.lines.length === 0) throw new MatchingEmptyInvoiceException(...)` (409, code `BUSINESS.MATCHING_EMPTY_INVOICE`) + test. **2 pts.**

### F-S8-03 🟠 [B3] Comptabilisation refusée — garde LÉGITIME mais 404 trompeur + UX bouton actif

- **Localisation garde** : `apps/api/src/accounting/services/posting.service.ts:398-399` — `if (invoice.lines.length === 0) throw new EntityNotFoundException('InvoiceLine', …)`.
- **Verdict** : le refus est **légitime** (règle d'or n°1 — pas d'écriture sans imputation analytique, laquelle vit sur les lignes). Deux défauts réels :
  1. L'exception est un **404 `BUSINESS.NOT_FOUND`** — sémantiquement faux (la facture existe) ; devrait être un 409/422 métier explicite (`INVOICE_NO_LINES_NOT_POSTABLE`) que le front peut restituer.
  2. **UX** : `apps/web/app/(authenticated)/accounting/invoices/[id]/page.tsx` — `canPost = status==='matched' && permissions.canPostInvoice()` → bouton « Comptabiliser » actif sur une facture sans lignes → erreur générique au clic. Attendu : état explicite (bouton désactivé + tooltip « Facture sans lignes — non comptabilisable »).
- **Amont** : l'état « matched sans lignes » ne devrait jamais exister (F-S8-02).
- **Fix proposé** : exception métier dédiée + gating front `lines.length > 0` + message. **2 pts** (après F-S8-02).

### F-S8-04 🔴 [B4] Import OCR : TVA = TAUX au lieu du MONTANT, 0 ligne créée, cohérence non vérifiée

- **Flux identifié** : `IMPORT-…` = numéro auto-généré par `uploadAndCapture` (`invoice.service.ts:144`) → provider OCR `pdfparse` (prod : `OCR_PROVIDER=auto` sans clé → pdfparse ; désormais clé restaurée → Claude Vision d'abord, mais le fallback reste actif).
- **Cause racine 1 — TVA** : `pdfparse-ocr.provider.ts:210` + `matchAmountLabelled` (`:223-233`) : le label `/tva|vat/i` matche la **première** occurrence dans le texte et capture le **premier nombre** dans les 120 caractères suivants. Sur une facture affichant « TVA (18%) … 2 952,00 », c'est **18** (le taux) qui est capturé — **avec confidence 95 (CONF_EXACT)**. → l'écran constaté : HT 16 400,00 / TVA 18,00 / TTC 19 352,00.
- **Cause racine 2 — lignes** : le provider pdfparse **n'extrait JAMAIS de lignes** (aucune logique `lines` dans le fichier) → `ocr.fields.lines` absent → `invoice.create` sans `lines` (`invoice.service.ts:177-187`) → 0 ligne → enchaîne F-S8-02 (matched par vacuité) puis F-S8-03 (posting refusé). **Chaîne causale complète des bugs prod B2→B3.**
- **Cause racine 3 — aucune validation de cohérence** : `uploadAndCapture:158-161` persiste HT/TVA/TTC bruts sans vérifier `HT + TVA ≈ TTC` (16 400 + 18 ≠ 19 352 aurait dû dégrader la confiance / flagger la capture).
- **Fragilités connexes** : devise = **première** occurrence ISO dans le texte (`extractCurrency:266-275`) — un IBAN/une mention EUR hors totaux peut l'emporter (la facture prod est sortie EUR) ; `parseNumber` sur fenêtre de 120 chars peut concaténer des nombres adjacents de colonnes tabulaires.
- **Storage** : le putObject de l'upload pose bien `contentType: application/pdf` + metadata (`invoice.service.ts:150-156`). ✅
- **Fix proposé** : (a) regex TVA excluant les pourcentages (`(?!\s*%)`, préférence au libellé « Total TVA » et au bloc totaux), (b) contrôle de cohérence HT+TVA≈TTC avec tolérance → sinon confidence dégradée + statut visible « à vérifier », (c) extraction de lignes best-effort OU création d'une ligne unique de repli « Import global » imputable, (d) devise cherchée près des totaux. **5 pts.**

### F-S8-05 🟠 [B5] Pages orphelines de navigation — BC inaccessibles en direct

- **Confirmé** : `AppSidebar.tsx` — « Achats » a `href: /procurement/purchase-requests` avec `matchPrefixes` couvrant PO et GR (l'item s'ALLUME sur ces pages) mais **aucune entrée ne MÈNE** à `/procurement/purchase-orders` ni `/procurement/goods-receipts` (listes) : accessibles uniquement par rebond détail (DA → BC) ou URL directe.
- **Recensement complet** : voir Axe H (Partie 2) — tableau page → chemin d'accès → verdict.
- **Fix pressenti** : entrée sidebar « Bons de commande » (+ « Réceptions » à décider) dans le groupe Opérations + revue du groupe ; gating aligné `canListPurchaseOrders()`. **2 pts.**

---

## Partie 2 — Balayage transversal (axes A→H)

_(Sections alimentées par le balayage systématique — findings numérotés à la suite.)_

### Axe D — Machines à états

#### F-S8-06 🟠 Pré-conditions du matching documentées mais non appliquées
`invoice.service.ts:420-444` (`submitForMatching`) : le JSDoc annonce « status=captured, po_id renseigné, **totaux > 0** » — le code ne vérifie que les deux premiers. Une facture à totaux 0 / sans ligne franchit la soumission. Renforce F-S8-02. **Fix** : gardes totaux > 0 + ≥ 1 ligne. **1 pt** (avec F-S8-02).

#### F-S8-07 🔴 `reject` autorisé sur une facture `posted` / `partially_paid` — écritures orphelines
`invoice.service.ts:60-63` : `IMMUTABLE_STATUSES = [paid, archived]` seulement ; `reject` (:378-403) écrit `status=rejected` sans extourner. Une facture **comptabilisée** (écritures 4/6 + extourne classe 8 postées), voire partiellement payée, peut être rejetée → journal incohérent avec l'état métier. **Fix** : interdire reject sur `posted`/`partially_paid` (le chemin légitime est `cancelPosting` d'abord). **2 pts.**

#### F-S8-08 🟠 `GoodsReceipt.complete` réécrit le statut du PO sans lire son état courant
`goods-receipt.service.ts:277-398` : seul garde = `gr.status === draft` ; le recalcul `newPoStatus` est écrit sans vérifier que le PO n'est pas passé à `invoiced`/`cancelled` entre-temps → un GR draft ancien peut **rouvrir un BC annulé** (received/partially_received), en court-circuitant les gardes du PO. **Fix** : garde statut PO ∈ {sent, acknowledged, partially_received} au complete. **2 pts.**

#### F-S8-09 🟠 `PaymentRun.approve` : écritures BQ hors transaction de bascule
`payment-run.service.ts:435-485` : Phase 1 (`postPayment` par paiement) hors `$transaction` ; Phase 2 (bascule payments/factures/run) dans une transaction séparée. Un échec en milieu de série laisse des écritures BQ `posted` avec `payment.status=prepared` → réconciliation manuelle. Pas de re-validation du statut facture entre `prepare` et `approve`. **Fix** : englober ou compenser (saga simple, marquage par paiement). **3 pts.**

_Point conforme : la state machine Note Technique (US-051/053) est correcte — transitions via `assertStatus`, supersede transactionnel, SoD vérifiée._

### Axe E — Calculs (Decimal vs float, F10)

#### F-S8-10 🟠 `convertToXof` multiplie en float64 — au cœur de TOUTES les conversions
`exchange-rate.service.ts:180,195,210,222` : `Number(amount)` puis `Math.round(value * taux)` en float — c'est la primitive unique (contrôle budgétaire, plafonds caisse, posting). Le rappel F10 s'applique en amont de tous les agrégats XOF. **Fix** : arithmétique `Prisma.Decimal` interne, arrondi final seul. **3 pts.**

#### F-S8-11 🟡 Totaux DA calculés et persistés depuis du float
`purchase-request.service.ts:193-196` (create), `:402,417-420` (update) : `sum + Number(q)*Number(pu)` en float écrit dans `total_amount` Decimal(18,2) — divergence possible avec `line_total` (colonne GENERATED). **Fix** : réduire en Decimal. **1 pt.**

#### F-S8-12 🟡 Simulateur : TVA/TTC en `Math.round` float
`purchase-order.service.ts:710-714` : `totalVat/totalTtc` en float → persistés Decimal via `createFromSimulatedPdf`. Démo uniquement, mais même pattern. **Fix** : Decimal. **1 pt** (avec F-S8-11).

#### F-S8-13 🟠 Agrégats du contrôle budgétaire sommés en `number`
`purchase-request.service.ts:762-815` : accumulation des `xofAmount` (number) + `Number(bl.budgetedAmountXof)` et comparaison `available < 0` en float — la **décision bloquante** budgétaire repose sur une chaîne entièrement flottante (combiné à F-S8-10). **Fix** : agrégats Decimal. **2 pts** (avec F-S8-10).

_Points conformes : `totalVat` stocké partout comme MONTANT (aucune affectation croisée taux/montant hors bug OCR F-S8-04) ; matching/payment-run/posting sont passés en Decimal (correctif F10 appliqué)._

### Axe F — Triplets XOF (`*_amount_xof` / `fx_rate` / `fx_rate_date`)

#### F-S8-14 🟠 Les triplets XOF ne sont JAMAIS persistés — sauf sur BudgetLine
Constat transversal : les colonnes existent au schéma sur **toutes** les entités financières mais restent NULL partout sauf `budget_line` :
- Factures : `uploadAndCapture` (:165-193), `createManual` (:213-240), `createFromSimulatedPdf` (:287-313) — aucun `convertToXof` (le service ne l'injecte même pas) ; lignes idem.
- BC : `createFromPr` / `createFromMultiplePrs` — pas de `fx_rate/fx_rate_date` ; le taux n'est figé que sur le journal (posting), pas sur l'entité.
- DA : `create`/`update` ne posent pas `total_amount_xof/fx_rate/fx_rate_date` **alors que le service appelle `convertToXof` pour ses contrôles** (résultat jeté).
- Paiements : `payment.createMany` sans `amount_xof` ; `payment-run.service` n'appelle jamais `convertToXof`.
- Seule conforme : `budget-line.service` (triplet posé partout).
**Impact** : ADR-005/US-001 à moitié réalisés — l'infobulle XOF US-068 lit NULL sur toute facture/DA/BC en devise ; tout état s'appuyant sur ces colonnes est vide. **Fix** : poser le triplet à la création/màj de chaque entité financière (DA, facture+lignes, BC, paiement) via `convertToXof` + backfill idempotent des existantes. **5 pts.**

### Axe A — Formats (usages hors helper `fr-number-format`)

#### F-S8-15 🟠 PDF bailleurs et états SYSCEBNL : `toLocaleString` direct → même bug U+202F que le fix BC
- `reporting/services/pdf-render.service.ts:203` (`fmtAmount` du rendu PDF des **rapports bailleurs**) et `reporting/services/statement-render.service.ts:242` (partagé PDF **états financiers TER/BILAN/RESULTAT** + Excel) : `toLocaleString('fr-FR')` direct, polices Helvetica/WinAnsi → séparateur U+202F non encodable → glyphes cassés dans les montants des documents **envoyés aux bailleurs**. Exactement le bug corrigé sur les PDF BC (`f9053b0`), non propagé ici. **Fix** : brancher `formatMoneyFr`. **1 pt.**

#### F-S8-16 🟡 Emails BC : formatage hors helper (incohérence, pas de tofu)
`purchase-order.service.ts:937,951` (`buildEmailText/Html`) : `toLocaleString('fr-FR')` direct — email UTF-8 donc lisible, mais formaté différemment du PDF joint. **Fix** : helper. **0,5 pt** (avec F-S8-15).
_Web : tous les usages `toLocaleString` restants sont des affichages écran (bénins) ; aucun `Intl.NumberFormat` côté API._

### Axe B — Storage (putObject/getObject)

**Verdict : sain.** Les 7 `putObject` (rapports, états, facture OCR, BC, simulateur) posent tous `contentType` + clés préfixées `YYYY/MM/` + metadata ; lectures alignées sur les buckets d'écriture. Deux observations informatives (pas des bugs) : constantes de bucket dupliquées entre services (`grantflow-reports` ×2, `grantflow-invoices` ×2 — un renommage unilatéral divergerait silencieusement) ; les étiquettes GR sont générées à la volée sans archivage (asymétrie assumée, cf. dette PDF BL notée US-069).

### Axe C — RBAC

_Rappel mécanique : `RolesGuard` retourne `true` si `@Roles` absent → route ouverte à TOUT authentifié ; elle n'est protégée que si le service filtre par acteur. Test discriminant appliqué : « pas de @Roles **ET** méthode service sans paramètre acteur » = fuite._

#### F-S8-17 🔴 Détail payment-runs / paiements lisibles par tout rôle (y compris BAILLEUR)
`payment-run.controller.ts:67,74,80,86,106` : `GET payment-runs/:id`, `/payments`, `/journal-entries`, `GET payments/:id` (Prisma direct !), `GET invoices/:invoiceId/payments` — aucun `@Roles`, services **sans acteur**. La liste (:56) est pourtant gardée avec le commentaire explicite « BAILLEUR ne doit pas voir les fournisseurs payés » — contredit par les endpoints détail. **Fix** : reporter le même `@Roles` sur les 5 routes. **1 pt.**

#### F-S8-18 🔴 Téléchargements PDF/Excel des états financiers non gardés
`reporting.controller.ts:296,311` (`statements/:id/pdf|excel`) : aucun `@Roles`, `downloadPdf/downloadExcel` **sans acteur** → tout authentifié (MAGASINIER, CAISSIER… et BAILLEUR sur un état **brouillon non verrouillé**) télécharge les états SYSCEBNL. Les frères `GET statements(/:id)` sont gardés + filtre `isBailleurOnly/locked` ; les donor-reports appliquent le bon pattern. **Fix** : `@Roles` + passer l'acteur au service (mêmes règles que la lecture). **2 pts.**

#### F-S8-19 🟠 Comptes bancaires (IBAN) lisibles par tout authentifié
`bank-account.controller.ts:35,41` : lectures sans `@Roles` ni filtre acteur, écritures gardées TRESORIER/DAF/SA. La liste des comptes IPD avec IBAN est une donnée sensible (règles §6 : logs masquent l'IBAN — mais l'API le sert à tous). **Fix** : `@Roles('TRESORIER','COMPTABLE','DAF','SUPER_ADMIN')` sur les lectures. **1 pt.**

#### F-S8-20 🟡 Templates de reporting lisibles par tous
`reporting.controller.ts:58,64` : lectures sans garde alors que toutes les autres lectures du controller en ont. Config non sensible mais incohérent. **Fix** : aligner. **0,5 pt.**

_Points conformes : aucune écriture plus ouverte que sa lecture ; les routes détail sans `@Roles` de procurement/invoicing passent toutes l'acteur au service (404 obscurité) — défense en profondeur OK._

### Axe G — Contrats front↔API

#### F-S8-21 🔴 « Confirmer réception fournisseur » (BC) : 400 systématique — DTO jamais satisfait
- Front : `acknowledgePurchaseOrder` envoie `{ contactEmail }` (`lib/api/procurement.ts:520-530`) — et la fiche BC appelle `ackM.mutateAsync(undefined)` (`purchase-orders/[id]/page.tsx:300`) → corps réel `{}`.
- API : `AcknowledgePoDto` strict exige `{ ackRef: string min(1) }` (`create-po.dto.ts:57-63`).
- → **chaque clic sur « Confirmer réception fournisseur » est un 400 Zod** ; `contactEmail` n'a aucun répondant serveur (champ mort). **Fix** : dialog front avec saisie `ackRef` (réf. accusé fournisseur) alignée DTO. **1 pt.**

#### F-S8-22 🔴 Édition d'une ligne GR (fiche détail) : 400 systématique — enveloppe `lines` manquante
- Front : `updateGrLine` poste l'objet **nu** `{lineId, quantity, …}` (`lib/api/procurement.ts:598-608`) — câblé sur le bouton « Sauver » par ligne (`goods-receipts/[id]/page.tsx:78-93`).
- API : `UpdateGrLinesSchema` strict exige `{ lines: [ … ] }` (`create-gr.dto.ts:57-63`).
- Le batch `updateGrLines` (réception-rapide) est, lui, correct. **Fix** : envelopper (`{ lines: [input] }`) dans `updateGrLine`. **0,5 pt.**

#### F-S8-23 🟡 `GET /goods-receipts/:id/lines` (404 prod) : absent du code front COURANT
Recherche exhaustive : seuls deux **POST** existent vers ce chemin ; les lignes sont lues via `GET /goods-receipts/:id` (embarque `lines[]`). Le 404 prod provient d'un build antérieur ou d'un préfetch navigateur — **à re-capturer avec la méthode HTTP exacte** si ça se reproduit. Pas de fix code.

_Informatif : routes API sans client front (candidates démo/UI future ou code mort à trancher) : `POST /purchase-orders/from-prs`, `/purchase-orders/:id/resend`, `GET /purchase-orders/:poId/receipts`, `GET /purchase-orders/:poId/invoices`, `POST /invoices` (création manuelle), `POST /purchase-requests/:id/settle`, lectures trésorerie `:id/journal-entries`·`payments/:id`·`invoices/:id/payments`, `POST/DELETE /payment-runs/:id/invoices` ; contrôleurs entiers sans UI : note-techniques, overhead-rules, gl-accounts, cash-boxes, exchange-rates, tax-codes, analytical-axes._

### Axe H — Pages sans navigation (complète F-S8-05)

#### F-S8-24 🟠 Recensement complet des orphelines
- **Orphelines strictes** (URL directe seulement) : `/procurement/purchase-orders` (liste — cf. B5) et `/pilotage/analytics` (aucun lien entrant dans toute l'app alors que la permission `canViewAnalytics` existe).
- **Orpheline conditionnelle au rôle** : `/procurement/goods-receipts` (liste) — seul MAGASINIER/SA y accède (Réception → « Mes réceptions ») ; ACHETEUR/COMPTABLE/CONTROLEUR/DAF sont autorisés par le `@Roles` API mais n'ont **aucun chemin de navigation**.
- **Rebond-seulement assumé** : `/pilotage/my-projects` (dispatcher `/pilotage`), pages `new`/`edit`/détails (normales).
- Vérifiées **non** orphelines : invoices/upload, payment-runs/new, templates, reception-rapide, inventaire-scan.
**Fix proposé (avec F-S8-05)** : groupe Opérations enrichi — entrées « Bons de commande » et « Réceptions » (gating `canListPurchaseOrders`/`canListGoodsReceipts`) + entrée « Analytique » dans Pilotage (gating `canViewAnalytics`). **2 pts.**

---

## Synthèse — Top 5 par impact utilisateur

1. **Aperçu PDF cassé partout** (F-S8-01) — toute consultation de document échoue ; fix d'une ligne (retrait `sandbox`), gain immédiat maximal.
2. **Chaîne import facture inutilisable** (F-S8-04 → 02 → 03) — l'OCR pose une TVA fausse avec confidence 95, crée 0 ligne, la facture passe « Rapprochée » à tort puis bloque à la comptabilisation avec une erreur trompeuse. C'est le parcours métier P2A central.
3. **Deux actions de workflow 100 % cassées** (F-S8-21 acknowledge BC, F-S8-22 édition ligne GR) — 400 garanti à chaque clic, invisible tant qu'on ne clique pas.
4. **Fuites RBAC** (F-S8-17 détail paiements/fournisseurs payés lisibles par BAILLEUR, F-S8-18 états financiers téléchargeables par tous, F-S8-19 IBAN) — confidentialité, exigence bailleur.
5. **Intégrité comptable et ADR-005** (F-S8-07 reject sur facture comptabilisée ; F-S8-14 triplets XOF jamais persistés — l'infobulle US-068 lit NULL ; F-S8-10/13 chaîne de conversion budgétaire en float).

## Proposition de découpage Sprint S8 (~37 pts, cadence 36-47)

| Lot | Contenu | Pts |
|---|---|---|
| **S8-L1 — Hotfixes actions cassées** (à livrer en premier, indépendants) | F-S8-01 sandbox iframe (1) · F-S8-21 ackRef (1) · F-S8-22 enveloppe lines (0,5) · F-S8-15/16 formats PDF reporting + emails (1,5) | **4** |
| **S8-L2 — Chaîne import facture fiable** | F-S8-04 OCR (TVA sans %, cohérence HT+TVA≈TTC, ligne de repli, devise près des totaux) (5) · F-S8-02+06 gardes matching 0-ligne/totaux (3) · F-S8-03 exception métier + gating bouton (2) | **10** |
| **S8-L3 — RBAC & intégrité d'états** | F-S8-17 (1) · F-S8-18 (2) · F-S8-19 (1) · F-S8-20 (0,5) · F-S8-07 reject posted (2) · F-S8-08 GR→PO (2) · F-S8-09 payment run transactionnel (3) | **11,5** |
| **S8-L4 — Dette ADR-005 (montants)** | F-S8-14 triplets XOF + backfill (5) · F-S8-10+13 convertToXof/agrégats Decimal (5) · F-S8-11/12 totaux DA/simulateur (2) | **12** |
| **S8-L5 — Navigation** | F-S8-05+24 sidebar BC/Réceptions/Analytique (2) | **2** |

Ordre conseillé : **L1 → L2 → L3 → L5 → L4** (L4 sécable vers S9 si la cadence l'exige — L1/L2/L3/L5 = 27,5 pts, cœur utilisateur).

---

_Audit réalisé le 2026-07-17 (assisté Claude Code — 3 balayages parallèles + instruction directe des 5 bugs). Aucune modification de code. Données prod complémentaires attendues (B1 : status/content-type/console de la requête PDF ; F-S8-23 : méthode HTTP exacte du 404 GR/lines)._

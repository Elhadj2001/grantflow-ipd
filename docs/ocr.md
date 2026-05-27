# OCR factures — Architecture multi-provider (sprint F-OCR-VISION)

> Ce document décrit l'architecture OCR introduite par le sprint
> **F-OCR-VISION**. Pour le rapprochement 3-way et le cycle de vie d'une
> facture, voir [invoice-matching.md](./invoice-matching.md).

## 1. Vue d'ensemble

Le module `Invoicing` extrait les champs d'une facture PDF via une
**façade** `OcrService` qui délègue à un **provider** au choix. Tous les
providers respectent le contrat `OcrProvider.extractFromPdf(buffer)` →
`Promise<OcrResult>`, ce qui garantit qu'`InvoiceService` (le seul
consommateur) n'a aucune logique de branchement.

```
┌──────────────────┐
│  InvoiceService  │  (consommateur unique du résultat OCR)
└────────┬─────────┘
         │ extractFromPdf(buffer)
         ▼
┌──────────────────┐
│   OcrService     │  ← façade — choisit le provider via env OCR_PROVIDER
│   (façade)       │
└─┬──────────────┬─┘
  │              │
  ▼              ▼
┌────────────┐  ┌──────────────────────┐
│ pdfparse   │  │ vision (opt-in)      │
│ (local)    │  │ Claude API (Anthropic)│
└────────────┘  └──────────────────────┘
```

### Providers

| Nom        | Implémentation                          | Confidentialité | Couverture                                                                |
|------------|-----------------------------------------|-----------------|---------------------------------------------------------------------------|
| `pdfparse` | `PdfParseOcrProvider` (lib `pdf-parse`) | 100% local      | PDF émis électroniquement (Sage, EBP, Odoo, NetSuite…) avec couche texte. |
| `vision`   | `ClaudeVisionOcrProvider` (API Claude)  | Envoi à un tiers (Anthropic) | PDF scannés / images / sans couche texte ; structure variable.          |

## 2. Contrat — `OcrResult`

Le contrat est figé (voir `apps/api/src/invoicing/services/ocr/ocr-provider.interface.ts`) :

```ts
export interface OcrResult {
  /** Texte brut extrait (vide pour Vision). */
  rawText: string;
  /** true si pdfparse n'a rien extrait → bascule vers Vision possible. */
  isImageScan: boolean;
  /** Confiance globale 0-100 (moyenne pondérée des champs). */
  confidence: number;
  /** Champs structurés extraits (subset selon le PDF). */
  fields: OcrFields;
  /** Confiance par champ 0-100. */
  fieldConfidence: Record<string, number>;
}
```

Les deux providers produisent strictement la même forme — l'aval ne sait
pas qui a parlé.

## 3. Sélection du provider (env)

```env
# DÉFAUT : 100% local, 0 coût, 0 PII envoyée
OCR_PROVIDER=pdfparse

# OPT-IN : Vision activé (clé requise)
OCR_PROVIDER=vision
ANTHROPIC_API_KEY=sk-ant-...

# AUTO : pdfparse d'abord, bascule Vision si nécessaire
OCR_PROVIDER=auto
ANTHROPIC_API_KEY=sk-ant-...
OCR_VISION_FALLBACK_THRESHOLD=50   # 0-100
```

### Mode `auto` — algorithme de bascule

```
1. exécuter pdfparse(buffer) → result1
2. si result1.isImageScan === true       → bascule vers vision
3. ou si result1.confidence < THRESHOLD  → bascule vers vision
4. sinon                                  → retourner result1
```

La bascule n'a lieu que si `OCR_VISION_PROVIDER` a été instancié (clé
présente). Sinon on retourne le résultat pdfparse même dégradé — l'upload
n'est jamais bloqué.

### Garde-fou erreur Vision

Si Vision échoue (réseau, 429, 500, réponse mal formée), `OcrService`
**ne propage pas** l'erreur : il retombe sur `pdfparse` (ou retourne le
result1 déjà calculé en mode auto). L'utilisateur final n'est jamais
bloqué par une indisponibilité de l'API Anthropic.

## 4. Confidentialité — règles non négociables

⚠ Activer `OCR_PROVIDER=vision` (ou `auto`) **envoie le PDF de la facture
à l'API Anthropic**. À traiter comme un sous-traitant au sens RGPD.

| Règle                                              | Implémentation                                                            |
|----------------------------------------------------|---------------------------------------------------------------------------|
| Clé API jamais en dur                              | `ANTHROPIC_API_KEY` lue via `ConfigService` ; en prod : secret manager.   |
| Clé API jamais loggée                              | Le logger n'imprime que `status`, `bodyPrefix` (200c max), latence.       |
| Contenu de facture jamais loggé                    | Aucun log de `rawText`, `fields`, `buffer` ni du bloc `document.data`.    |
| Garde-fou taille                                   | `OCR_VISION_MAX_BYTES` (défaut 5 Mo) → refus avant envoi.                 |
| Test automatique anti-fuite                        | `claude-vision-ocr.provider.spec.ts` assert que clé+buffer absents du log.|

**Recommandations opérationnelles** :

- En dev/test : activer Vision avec une clé restreinte (quota faible).
- En prod : `OCR_PROVIDER=pdfparse` par défaut, ne basculer en `auto` que
  pour les centres de coût qui reçoivent beaucoup de factures scannées,
  après revue DPO + IT.
- Surveiller la latence Anthropic (P95 ~5-15s sur PDF de quelques pages).

## 5. Mapping Vision → `OcrResult`

Le provider Vision utilise le mécanisme `tool_use` de l'API Messages
d'Anthropic pour forcer une sortie JSON déterministe (cf. schéma
`INVOICE_EXTRACTION_TOOL_SCHEMA` dans
`apps/api/src/invoicing/services/ocr/claude-vision-ocr.provider.ts`).

Mappings notables :

| Sortie Claude              | OcrResult                              |
|----------------------------|----------------------------------------|
| `invoiceNumber`            | `fields.invoiceNumber`                 |
| `invoiceDate` (ISO 8601)   | `fields.invoiceDate` (`Date`)          |
| `dueDate` (ISO 8601)       | `fields.dueDate` (`Date`)              |
| `supplierName`             | `fields.supplierName`                  |
| `currency` (3 lettres)     | `fields.currency` (forcé upper-case)   |
| `totalHt`                  | `fields.totalHt`                       |
| `vatAmount`                | `fields.totalVat`                      |
| `totalTtc`                 | `fields.totalTtc`                      |
| `poReference`              | `fields.poReference`                   |
| `lines[]`                  | `fields.lines[]` (lineTotal calculé si quantity+unitPrice) |
| `perFieldConfidence`       | `fieldConfidence` (défaut 85 si absent)|

Les champs absents du JSON Claude restent absents de `OcrResult.fields`
(pas de `null` ni `undefined` — propriétés strictement non définies). Cela
préserve l'égalité de comportement avec `pdfparse` et évite les
faux-positifs côté UI.

## 6. Approbation humaine — invariant maintenu

Le sprint F-OCR-VISION **n'affaiblit pas** le contrôle humain : quel que
soit le provider, le résultat OCR alimente le statut `captured`, et la
facture suit toujours le workflow `captured → submit → matching 3-way →
matched → ...`. Aucun statut `matched` n'est attribué automatiquement par
l'OCR. La séparation des tâches (saisisseur ≠ valideur) reste inchangée.

## 7. TODO — pistes d'optimisation futures

- **Asynchrone via BullMQ** : aujourd'hui l'OCR est synchrone (upload
  attend le résultat). Pour des PDF lourds ou des appels Vision lents, on
  pourrait déporter l'extraction sur un job worker (`invoicing-ocr`
  queue). Statut intermédiaire `ocr_pending` + WebSocket pour notifier.
- **Cache** : hash SHA-256 du PDF → cache du résultat OCR (idempotence
  des re-uploads, économie d'appels Vision).
- **Provider configurable par fournisseur** : certaines factures
  proviennent toujours du même éditeur (Sage XML), un provider dédié
  pourrait être plus précis et 100% local.
- **Métriques** : exposer Prometheus counter `ocr_provider_total{provider,outcome}`
  + histogramme latence pour piloter la bascule fine-grain.

---

_Dernière mise à jour : sprint F-OCR-VISION (mai 2026)._

# Fonctionnalités de démonstration — GRANTFLOW IPD

> Ce document décrit les dispositifs activables **uniquement en
> environnement de démonstration** (jamais en production). Ils sont tous
> gardés par un flag d'environnement, OFF par défaut.

## 1. Simulateur de facture fournisseur (sprint F-INVOICE-SIM)

### Problème résolu

La démo du cycle Procure-to-Account a besoin d'une **facture fournisseur**
pour enchaîner sur le rapprochement 3-way et la comptabilisation. En
démo, on n'a pas toujours un vrai fournisseur sous la main pour émettre
une vraie facture. Le simulateur génère une facture PDF cohérente avec un
Bon de Commande déjà `sent`.

> ⚠️ Le flux de **production NORMAL reste intact** : un vrai fournisseur
> envoie sa facture, le comptable l'upload via *Comptabilité › Factures*,
> et l'OCR (pdf-parse ou Vision) en extrait les champs. Le simulateur est
> un raccourci de démo, pas un remplacement.

### Les deux modes

Depuis la fiche d'un BC en statut `sent`, le bouton **« Simuler la facture
fournisseur (démo) »** ouvre un dialog avec deux choix :

| Mode | Bouton | Effet | Quand l'utiliser |
|------|--------|-------|------------------|
| **A — Télécharger** | 📥 Télécharger la facture simulée | Renvoie le PDF. L'utilisateur le re-upload via *Comptabilité › Factures* → l'OCR Vision s'exécute. | Démo jury : montre l'OCR en action (effet « waouh »). |
| **B — Injecter direct** | ⚡ Injecter directement (statut Capturée) | Stocke le PDF + crée une Invoice `captured` avec les champs déjà remplis (skip OCR). | Répétitions / mises en place rapides : on saute l'étape OCR. |

Dans les deux cas, la facture générée est **cohérente avec le BC** :
- en-tête fournisseur (nom, adresse, NINEA depuis `ref.supplier`) ;
- n° de facture `FAC-SIM-{poNumber}-{seq}` ;
- date du jour, échéance = date + `paymentTermsDays` du fournisseur ;
- **référence BC pré-remplie** (le matching 3-way retrouve donc le BC) ;
- lignes identiques au BC ;
- TVA 18 % calculée (HT/TVA/TTC cohérents).

Le PDF porte un bandeau visible « DOCUMENT DE DÉMONSTRATION — aucune valeur
juridique ». En mode inject, l'Invoice porte un marqueur
`capturedPayload.sourceType = 'DEMO_SIMULATOR'` (traçabilité, aucune modif
du schéma de base).

### Activation (DEV uniquement)

```env
# apps/api/.env (ou .env racine) — voir .env.example
ENABLE_DEMO_INVOICE_SIMULATOR=true
```

- Quand `true` : l'endpoint `POST /purchase-orders/:id/simulate-invoice`
  existe (rôles `SUPER_ADMIN`, `CONTROLEUR`, `DAF`), et le frontend
  affiche le bouton (via `GET /health/features`).
- Quand absent ou `≠ 'true'` : l'endpoint répond **404
  `DEMO_FEATURE_DISABLED`** (il « n'existe pas » du point de vue d'un
  client) et le bouton est masqué.

### Production : LAISSER OFF

`ENABLE_DEMO_INVOICE_SIMULATOR` doit rester `false` (ou non défini) en
production. Une facture doit toujours provenir d'un vrai fournisseur.
Le gating est double : flag runtime côté API (404) **et** masquage du
bouton côté UI.

### Architecture (pour le mémoire)

```
Page BC (sent)  ──"Simuler"──►  POST /purchase-orders/:id/simulate-invoice { mode }
                                         │  (gating : @Roles + flag runtime → 404 si off)
                                         ▼
                          PurchaseOrderService.simulateInvoice()
                              │  valide statut sent, recalcule HT/TVA 18%/TTC
                              ▼
                   SupplierInvoicePdfService.generate()  → PDF (pdfkit)
                              │
              ┌───────────────┴────────────────┐
        mode 'download'                    mode 'inject'
              │                                 │
        renvoie le PDF              StorageService.putObject (bucket factures)
        (re-upload → OCR)                       │
                                   InvoiceService.createFromSimulatedPdf()
                                        → Invoice `captured` (skip OCR)
```

Côté mémoire MIAGE : présenter ce dispositif comme un **« simulateur de
flux activable uniquement en environnement de démonstration »**, isolé du
chemin de production par un flag d'environnement et un double gating
(serveur + UI). Il illustre la testabilité du cycle Procure-to-Account
de bout en bout sans dépendance à un tiers externe.

### Sécurité / confidentialité

- Aucun secret n'est requis par cette feature (juste un booléen d'env).
- Les logs n'exposent pas de PII (n° de facture + ids techniques uniquement).
- Le flag est exposé au front via `/health/features` qui ne renvoie QUE
  des booléens de feature (pas de valeur sensible).

---

_Dernière mise à jour : sprint F-INVOICE-SIM (mai 2026)._

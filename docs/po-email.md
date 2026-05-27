# Envoi du Bon de Commande au fournisseur par e-mail — Sprint F-PO-EMAIL

> Ce document décrit le flux d'envoi automatique du PDF du BC au fournisseur
> lors de la transition `sent`. Pour le cycle de vie complet du BC, voir
> [purchase-order.md](./purchase-order.md).

## 1. Vue d'ensemble

À l'action **« Envoyer le BC »** (`POST /api/v1/purchase-orders/:id/send`),
le backend exécute, dans l'ordre :

1. **Génération PDF** (`PoPdfService.generate()`) — buffer en mémoire.
2. **Upload MinIO** (bucket `grantflow-pos`).
3. **Écriture comptable d'engagement** (classe 8, `posting.createCommitmentEntry`).
4. **Envoi e-mail au fournisseur** *(best-effort, voir §2)* — PDF en pièce jointe.
5. **Persist** : `status = sent`, `sentAt`, `pdfObjectKey`, et si l'envoi a réussi
   `emailSentAt` + `emailSentTo`.

> ⚠️ L'**écriture comptable est la source de vérité** : elle est créée **avant**
> la tentative d'envoi e-mail. Aucun échec SMTP ne peut la rollback.

## 2. Best-effort : règle d'or

L'envoi e-mail est **non bloquant**. Trois cas possibles :

| Cas                          | `emailDispatched` | `emailSkippedReason`  | Statut BC après | Engagement classe 8 |
|------------------------------|:-----------------:|-----------------------|:---------------:|:-------------------:|
| Envoi OK                     | `true`            | `null`                | `sent`          | ✓ créé              |
| Fournisseur sans `contactEmail` | `false`        | `'no-contact-email'`  | `sent`          | ✓ créé              |
| SMTP en échec (timeout, auth…) | `false`         | `'smtp-error'`        | `sent`          | ✓ créé              |

Dans les 3 cas, le BC passe en `sent` et l'écriture comptable est créée. La
différence est uniquement informative (et permet à l'UI d'afficher un toast
explicite et de proposer le re-send).

### Pourquoi best-effort ?

- Le bailleur, le contrôleur de gestion et l'auditeur s'appuient sur
  l'écriture d'engagement (classe 8) pour le suivi budgétaire. Cette
  écriture ne doit JAMAIS être manquante à cause d'un problème d'infra.
- Le fournisseur peut être notifié par d'autres canaux (téléphone, BC papier,
  EDI). L'ACHETEUR a aussi un endpoint `POST :id/resend` pour réessayer.
- L'e-mail est une commodité, pas une garantie juridique d'émission.

## 3. Configuration SMTP

Variables `.env` (cf. [.env.example](../.env.example) section `# ---- Mail`) :

```env
SMTP_HOST=localhost      # DEV: MailHog ; PROD: smtp.example.org
SMTP_PORT=1025           # DEV: 1025 ; PROD: 587 (STARTTLS) ou 465 (TLS)
SMTP_USER=               # PROD seulement
SMTP_PASS=               # PROD seulement — JAMAIS committer
SMTP_SECURE=false        # PROD: true pour TLS implicite (port 465)
MAIL_FROM="GRANTFLOW IPD <no-reply@pasteur.sn>"
```

**Dev / démo** : [MailHog](https://github.com/mailhog/MailHog) tourne en
container Docker (cf. `docker-compose.yml`). Le port SMTP local est `1025`,
l'UI de visualisation est sur http://localhost:8025.

**Prod** : utiliser un secret manager (Vault, Doppler, GitHub Actions
secrets) pour `SMTP_PASS`. La règle de CLAUDE.md (« pas de mot de passe
en clair dans le code ») s'applique strictement.

## 4. Recette MailHog (procédure)

1. Démarrer la stack : `docker compose up -d postgres mailhog`.
2. Démarrer l'API : `cd apps/api && npm run start:dev`.
3. Démarrer le web : `cd apps/web && npm run dev`.
4. Créer/éditer un fournisseur avec un `contactEmail` (ex.
   `achats@biomed-sn.demo`).
5. Créer un Bon de Commande lié à une DA approuvée.
6. Cliquer **« Envoyer »** sur la page du BC.
7. **Vérifications** :
   - Toast vert *« BC envoyé au fournisseur — PDF expédié par e-mail
     (a*****@biomed-sn.demo) »* (l'e-mail est masqué dans le toast pour
     préserver la PII visuelle).
   - L'écriture comptable classe 8 (OD-2026-XXXX) est visible dans le
     journal général.
   - Le BC est en statut `sent` dans la liste.
   - http://localhost:8025 affiche un e-mail dans l'inbox avec la pièce
     jointe `BC-2026-XXXX.pdf`.

## 5. Confidentialité — masquage e-mail dans les logs

> Règle CLAUDE.md : « Logs jamais contenir de PII (e-mails masqués, IBAN
> partiel) ».

L'utilitaire `apps/api/src/common/utils/mask-email.util.ts` transforme
toute adresse en `<1er char><étoiles>@<domain>` avant log :

| Input                       | Output dans le log         |
|-----------------------------|----------------------------|
| `achats@biomed-sn.demo`     | `a*****@biomed-sn.demo`    |
| `x@y.com`                   | `*@y.com`                  |
| `null` / `undefined` / `""` | `(none)`                   |
| `pas-un-mail`               | `***`                      |

Tous les logs `purchase-order.service` utilisent ce helper. L'API expose
aussi `SendPoResponse.emailDispatchedTo` (déjà masqué) pour que le
frontend puisse l'afficher dans le toast sans masquer côté UI.

> Note : le `MailService` central (Nest) logue actuellement l'adresse en
> clair côté SMTP transport. Hors-scope de ce sprint ; sera adressé dans
> un sprint dédié à la confidentialité globale des logs.

## 6. Re-send (endpoint séparé)

Si l'envoi initial échoue (cas `smtp-error` ou `no-contact-email`), un
endpoint dédié permet de réessayer **sans recréer ni le PDF ni l'écriture
comptable** :

```http
POST /api/v1/purchase-orders/:id/resend
```

Le PDF est relu depuis MinIO (clé `pdfObjectKey`), l'e-mail du fournisseur
est résolu à la volée (donc si l'ACHETEUR vient juste d'ajouter
`contactEmail` à la fiche, le resend marche). Aucune nouvelle ligne
comptable n'est créée — c'est une simple commodité de notification.

## 7. Endpoints

| Méthode | Path                                | Rôles                              |
|---------|-------------------------------------|------------------------------------|
| POST    | `/purchase-orders/:id/send`         | ACHETEUR, CONTROLEUR, DAF, SUPER_ADMIN |
| POST    | `/purchase-orders/:id/resend`       | ACHETEUR, CONTROLEUR, DAF, SUPER_ADMIN |

## 8. TODO — pistes d'optimisation futures

- **Asynchrone via BullMQ** : aujourd'hui l'envoi e-mail est synchrone
  (l'API attend la réponse SMTP). Pour des destinataires nombreux ou des
  SMTP lents, on pourrait déporter `MailService.send()` sur un worker
  (`mail-dispatch` queue) avec retry exponentiel automatique.
- **Webhook delivery report** : intégrer un endpoint SMTP bounce / DSN
  pour invalider `emailSentAt` si l'e-mail revient (NDR).
- **Template e-mail riche** : aujourd'hui le HTML est inline dans
  `buildEmailHtml`. À terme : templates MJML versionnés dans MinIO ou en
  base, avec i18n FR/EN selon `supplier.country`.
- **Signature électronique du PDF** : pour les BC > seuil DAF, signer le
  PDF (Lib digsig) avant l'envoi pour garantir l'intégrité côté
  fournisseur.

---

_Dernière mise à jour : sprint F-PO-EMAIL (mai 2026)._

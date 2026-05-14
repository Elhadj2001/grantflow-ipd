# ANTIGRAVITY_PROMPTS.md

> Prompts prêts à l'emploi à coller dans **Google Antigravity** (IDE agentique) pour générer les modules de GRANTFLOW IPD étape par étape. Chaque prompt suppose que le contexte `CLAUDE.md` est déjà chargé dans le projet (Antigravity le lit automatiquement à la racine).

---

## 🌱 Sprint 0 — Bootstrap technique

### Prompt 0.1 — Initialisation Prisma

```
Génère le schéma Prisma complet (apps/api/prisma/schema.prisma) pour GRANTFLOW IPD à partir du fichier docs/grantflow_ddl_postgresql.sql.

Contraintes :
- Datasource PostgreSQL avec multiSchema activé
- Schémas : auth, ref, procurement, ap, gl, co, reporting, audit
- Tous les types et énumérations doivent matcher le DDL
- Générer également apps/api/prisma/seed.ts qui charge :
  * Plan comptable SYSCEBNL (utiliser fixture seed/syscebnl-accounts.json)
  * 9 rôles (SUPER_ADMIN, DAF, CONTROLEUR, COMPTABLE, TRESORIER, ACHETEUR, MAGASINIER, PI, DEMANDEUR, BAILLEUR)
  * 9 bailleurs (BMGF, EDCTP, UE, AFD, GAVI, CEPI, WHO, USAID, IPD)
  * 5 utilisateurs de test avec rôles assignés
- Penser à la convention naming : tables snake_case pluriel, modèles Prisma en PascalCase singulier (avec @@map)
```

### Prompt 0.2 — Docker Compose dev

```
Valide et complète l'infrastructure dev :

1. Vérifie que docker-compose.yml référence bien :
   - postgres:16-alpine (5432, db grantflow_dev, user/pwd grantflow/grantflow)
   - redis:7-alpine (6379)
   - minio (9000/9001, accès minio/minio12345)
   - keycloak:24.0 (8080, admin/admin) avec import de docker/keycloak/realm.json
   - mailhog (1025/8025)
   Healthchecks sur tous les services. Volume persistant uniquement pour postgres.

2. Vérifie que docker/keycloak/realm.json est présent et expose :
   - realm "grantflow"
   - 10 rôles (SUPER_ADMIN, DAF, CONTROLEUR, COMPTABLE, TRESORIER, ACHETEUR, MAGASINIER, PI, DEMANDEUR, BAILLEUR)
   - 2 clients (grantflow-api bearer-only, grantflow-web public PKCE)
   - 6 utilisateurs de test avec mots de passe non-temporaires

3. Lance la stack et valide l'init de bout en bout :
   docker compose up -d
   psql -h localhost -U grantflow -d grantflow_dev -f docs/grantflow_ddl_postgresql.sql
   cd apps/api && npm run prisma:generate && npm run prisma:seed
   npm run start:dev

4. Vérifie en parallèle :
   - http://localhost:4000/api/v1/health → { status: "ok" }
   - http://localhost:8080/realms/grantflow/.well-known/openid-configuration → 200
   - http://localhost:9001 (MinIO console) → login OK
   - psql : SELECT count(*) FROM ref.gl_account; → 55

Si une étape échoue, propose le correctif minimal sans toucher au DDL ni aux fixtures.
```

---

### Prompt 0.3 — Authentification Keycloak + RBAC + Audit log

```
Implémente le socle d'authentification et d'autorisation de l'API.

Contexte :
- Keycloak réalise l'auth (OIDC) et émet des JWT signés RS256
- L'API NestJS vérifie les JWT via la JWKS endpoint de Keycloak
- Les rôles sont portés par le claim `roles` du JWT (mappé dans realm.json)
- Toute action mutative doit générer une entrée dans audit.event_log

Livrables :

1. apps/api/src/auth/strategies/jwt.strategy.ts
   - Strategy passport-jwt-keycloak (ou passport-jwt + jwks-rsa)
   - Vérifie issuer = http://localhost:8080/realms/grantflow
   - Vérifie audience = grantflow-api
   - Extrait sub, email, name, roles dans req.user

2. apps/api/src/auth/guards/
   - JwtAuthGuard : applique la stratégie ci-dessus
   - RolesGuard : lit la metadata @Roles() et vérifie req.user.roles ⊇ requis
   - Décorateur @Public() pour exempter /health et /docs

3. apps/api/src/auth/decorators/
   - @CurrentUser() : injection du req.user
   - @Roles('DAF','CONTROLEUR') : liste de rôles requis (OR logique)
   - @Public() : marqueur skip-auth

4. apps/api/src/auth/auth.module.ts (refactor)
   - Importe ConfigModule, JwtModule (config dynamique), PassportModule
   - Expose les guards et décorateurs
   - APP_GUARD global pour JwtAuthGuard (avec exception @Public)

5. apps/api/src/common/interceptors/audit-log.interceptor.ts
   - Intercepteur global qui, après une mutation réussie (POST/PUT/PATCH/DELETE),
     écrit une ligne dans audit.event_log
   - Capture : actorId (sub), actorEmail, action (METHOD + route), entityType, entityId, payloadBefore (si dispo), payloadAfter, ipAddress, userAgent
   - Le trigger PostgreSQL compute_hash_chain s'occupe du chaînage SHA-256 — ne pas le réimplémenter

6. apps/api/src/auth/auth.controller.ts
   - GET /api/v1/auth/me → retourne le profil de req.user (sub, email, name, roles)
   - Protégé par JwtAuthGuard

7. Mise à jour de purchase-request.controller.ts existant :
   - Remplacer le placeholder userId par @CurrentUser() user
   - Ajouter @Roles('DEMANDEUR','PI','SUPER_ADMIN') sur POST /purchase-requests
   - Ajouter @Roles('PI','CONTROLEUR','DAF','SUPER_ADMIN') sur POST /:id/submit

Variables .env à utiliser (déjà présentes) :
- KEYCLOAK_URL, KEYCLOAK_REALM, KEYCLOAK_CLIENT_ID, KEYCLOAK_CLIENT_SECRET

Tests :
- Tests unitaires des guards (mock du JwtService et reflector)
- Test d'intégration : GET /api/v1/auth/me sans token → 401, avec token valide → profil, avec token expiré → 401
- Test : POST /api/v1/purchase-requests sans rôle DEMANDEUR → 403

Respecter strictement :
- Section 6 (Sécurité) et 9 (DDL-first) de CLAUDE.md
- Logs ne doivent JAMAIS contenir le JWT en clair (utiliser le redact pino existant)
- Le BusinessException maison doit être étendu si besoin pour 401/403 typés
```

---

## 🧩 Sprint 1 — Module Référentiels (M1)

### Prompt 1.1 — Module Donor

```
Crée le module Donor dans apps/api/src/referential/donor :
- entity (Prisma Donor model existe déjà)
- controller REST sous /api/v1/donors avec CRUD complet
- service avec injection PrismaService
- DTO Zod : CreateDonorDto, UpdateDonorDto
- Garde @RequireRole(['CONTROLEUR','DAF','SUPER_ADMIN']) pour POST/PUT/DELETE
- GET ouvert à tous les utilisateurs authentifiés
- Tests unitaires Jest pour le service (mock Prisma)
- Tests intégration Supertest pour le controller

Respecter les règles d'or de CLAUDE.md : Zod validation, BusinessException, audit log auto.
```

### Prompt 1.2 — Module Project + Grant + BudgetLine

```
Crée les modules Project, GrantAgreement et BudgetLine :
- Relations : 1 Project — N GrantAgreement — N BudgetLine
- Pour GrantAgreement, ajouter une méthode calculateOverhead(eligibleBase) qui retourne base * overhead_rate
- Endpoint POST /api/v1/grants/:id/budget-lines/bulk pour charger en masse depuis Excel
- Endpoint GET /api/v1/grants/:id/dashboard qui retourne budget total, engagé, consommé, reste à dépenser
- View Prisma (raw query) sur co.v_budget_tracking pour les lignes budgétaires

Inclure tests + documentation OpenAPI (NestJS Swagger).
```

---

## 📝 Sprint 2 — Module Demandes d'Achat (M2)

### Prompt 2.1 — Workflow d'approbation

```
Implémente le module PurchaseRequest avec workflow d'approbation :

Routes :
- POST /api/v1/purchase-requests              → créer (status DRAFT)
- POST /api/v1/purchase-requests/:id/submit   → soumettre (DRAFT → PENDING_PI)
- POST /api/v1/purchase-requests/:id/approve  → approuver (avance dans le workflow)
- POST /api/v1/purchase-requests/:id/reject   → refuser (avec motif obligatoire)

Workflow selon montant :
- < 500 000 XOF : approbation PI seul
- 500k–5M XOF : approbation PI + Contrôleur de gestion
- > 5M XOF : approbation PI + CG + DAF

Règles :
- Bloquer la soumission si budget insuffisant sur la budgetLine
- Détecter fractionnement : > 3 DA du même demandeur pour même fournisseur en 30 jours → alerte
- À l'approbation finale, réserver le budget (procurement.budget_reservation)
- Tout changement de statut → entry audit log + notification email + websocket

Tests E2E Playwright à venir dans le sprint suivant.
```

### Prompt 2.2 — Formulaire frontend de DA

```
Crée la page apps/web/app/(authenticated)/procurement/purchase-requests/new/page.tsx :

- Server Component avec récupération des projets de l'utilisateur connecté
- Client Component pour le formulaire React Hook Form + Zod
- Sections (cards) :
  1) Informations générales : N° (auto), date, date souhaitée, description
  2) Imputation analytique : projet → grant (filtré) → budget line (filtré) + cost center + activity
  3) Lignes : array de PurchaseRequestLine avec ajout/suppression dynamique
  4) Résumé : total HT, devise (héritée du grant), affichage du solde disponible
- Live validation : appeler GET /api/v1/grants/:id/budget-lines/:lineId/available à chaque saisie
- Boutons : Enregistrer brouillon (gris) + Soumettre à validation (primary, désactivé si erreurs)
- Style : voir wireframe Écran 4 du document Wireframes_GRANTFLOW_IPD.html

Composants shadcn/ui à utiliser : Form, Card, Input, Select, Textarea, Button, Badge, Progress.
```

---

## 📦 Sprint 3 — Bons de commande (M3)

### Prompt 3.1 — Génération PO depuis PR

```
Implémente l'endpoint POST /api/v1/purchase-orders/from-pr/:prId :
- Pré-requis : PR doit être en status APPROVED
- Créer le PO en status DRAFT avec recopie des lignes
- L'acheteur choisit le fournisseur via une liste
- Lors du passage en SENT :
  * Crée l'écriture comptable d'engagement (classe 8, compte 801) — voir module gl
  * Décrémente budget_reservation et incrémente budget_committed sur la budgetLine
  * Envoie un PDF au fournisseur via mailing service

Le PDF du PO doit être généré avec pdf-lib en respectant la charte IPD (logo dans assets/).
```

---

## 🤖 Sprint 4 — OCR & rapprochement facture (M5)

### Prompt 4.1 — Service d'ingestion

```
Crée apps/api/src/invoicing/ingestion/ :

Flow :
1. Endpoint POST /api/v1/invoices/upload (multipart) qui :
   - Vérifie type MIME (pdf/png/jpg)
   - Stocke dans MinIO (bucket grantflow-invoices, key invoices/{year}/{month}/{uuid}.pdf)
   - Crée Invoice en status CAPTURED avec pdfObjectKey
   - Push job 'ocr-extract' dans BullMQ (queue 'invoice-processing')
2. Worker OCR (apps/api/src/invoicing/ocr.worker.ts) qui :
   - Récupère le PDF depuis MinIO
   - Appelle Tesseract pour le texte brut
   - Appelle Mistral via API (clé dans MISTRAL_API_KEY) pour structurer en JSON :
     { supplier_name, invoice_number, invoice_date, due_date,
       total_ht, total_vat, total_ttc, currency,
       po_reference, lines: [{ description, qty, unit_price, total }] }
   - Met à jour l'Invoice avec capturedPayload et ocrConfidence
   - Si po_reference détecté → status MATCHING, sinon → status CAPTURED en attente
3. Tests : mock Mistral API avec un payload JSON fixture
```

### Prompt 4.2 — Rapprochement 3 voies

```
Service apps/api/src/invoicing/matching.service.ts avec méthode matchInvoice(invoiceId) :
- Récupérer Invoice + InvoiceLines
- Récupérer PO référencé + POLines + GRLines associés
- Pour chaque InvoiceLine :
  * Trouver la POLine correspondante (description/order)
  * Calculer qty_variance = qtyInvoiced - qtyReceived
  * Calculer price_variance = priceInvoiced - priceOrdered
  * Tolérance config : ±2 % sur le prix, ±5 % sur la quantité
  * Si dans tolérance → match_result = 'OK'
  * Sinon → 'EXCEPTION_PRICE' ou 'EXCEPTION_QTY'
- Si toutes les lignes OK → Invoice status = MATCHED
- Sinon → status correspondant à l'exception majeure + notification comptable

Persister dans ap.invoice_match.
```

---

## 💼 Sprint 5 — Comptabilité (M7 + M8)

### Prompt 5.1 — Génération d'écriture comptable

```
Service apps/api/src/accounting/posting.service.ts :

postInvoice(invoiceId) :
- Construit l'écriture :
  Débit  : 6xx (compte déterminé par règle, défaut = budgetLine.defaultAccount)
  Crédit : 401 Fournisseurs (auxiliaire = supplier.code)
  + ligne TVA si applicable (445)
- Chaque ligne de débit porte l'imputation analytique héritée de PO/PR
- Vérifie balance (somme débit = somme crédit)
- Crée gl.journal_entry status DRAFT puis POSTED si tout OK
- Met à jour invoice.status = POSTED
- Calcule overhead bailleur si éligible → écriture séparée prête à passer en clôture

Toujours respecter SYSCEBNL : pas de modification sur période close.
```

### Prompt 5.2 — Vue analytique temps réel

```
Crée la page apps/web/app/(authenticated)/analytics/projects/[code]/page.tsx selon le wireframe Écran 5 :
- KPI cards : budget total, engagé, consommé, reste à dépenser
- Tableau des lignes budgétaires avec barre de progression
- Graphique line chart (recharts) : consommation cumulée vs budget cumulé par mois
- Alertes : lignes > 85 %, échéances bailleur < 30j, overhead non passé

Endpoint API : GET /api/v1/analytics/projects/:code avec query SQL optimisée (utiliser la vue co.v_budget_tracking).
```

---

## 📊 Sprint 6 — Reporting bailleur (M9)

### Prompt 6.1 — Génération PDF rapport BMGF

```
Service apps/api/src/reporting/donor-report.service.ts :

generateReport({ templateId, grantId, periodId }) :
- Récupère le template depuis reporting.report_template
- Compute les agrégats : budget vs actual par catégorie sur la période
- Génère le PDF avec pdfmake (logo IPD + logo bailleur)
- Génère également Excel avec exceljs (un onglet par section)
- Pour la narrative section : appeler Mistral avec un prompt structuré décrivant les variances
- Stocke PDF + XLSX dans MinIO bucket 'grantflow-reports'
- Crée reporting.report_run avec liens vers les fichiers
- Retourne URLs signées MinIO (valid 1h)

Template BMGF standard à coder en premier. Les autres templates suivront.
```

---

## 🧪 Sprint 6.5 — Tests bout-en-bout

### Prompt 6.5 — Tests Playwright

```
Crée apps/web/e2e/p2a-full-cycle.spec.ts :

Scénario : un demandeur crée une DA → PI approuve → BC envoyé → réception → facture OCR
→ rapprochement OK → comptabilisation → run de paiement.

Étapes :
1. Login demandeur, créer DA pour kits PCR (50, 142.50 €), projet MADIBA-VAC-2024
2. Vérifier que la DA est PENDING_PI
3. Logout, login PI, approuver DA
4. Login acheteur, générer BC à partir de la DA approuvée, choisir Thermo Fisher, envoyer
5. Login magasinier, scanner et valider la réception avec lot + péremption
6. Upload facture PDF (fixture test/fixtures/thermo-fisher-invoice.pdf)
7. Attendre OCR (mock Mistral pour test), vérifier MATCHED status
8. Login comptable, valider la comptabilisation
9. Login trésorier, préparer run de paiement
10. Vérifier que l'écriture analytique est bien créée

Utiliser un seed dédié à la suite E2E qui repart d'une base propre.
```

---

## 📦 Stockage et environnement

### Variables `.env` à connaître

| Variable | Description |
|---|---|
| `DATABASE_URL` | Connexion PostgreSQL |
| `REDIS_URL` | Connexion Redis |
| `MINIO_ENDPOINT` / `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` | MinIO |
| `KEYCLOAK_URL` / `KEYCLOAK_REALM` / `KEYCLOAK_CLIENT_ID` / `KEYCLOAK_CLIENT_SECRET` | OIDC |
| `MISTRAL_API_KEY` | API Mistral pour OCR/IA |
| `MAIL_FROM` / `SMTP_*` | E-mails |
| `JWT_SECRET` | Secret de signature (rotation tous les 90 j) |

---

## 🧠 Astuces de productivité avec Antigravity

1. **Toujours fixer le contexte** : ouvrir `CLAUDE.md` dans l'onglet avant de prompter.
2. **Prompts atomiques** : un seul module / fonctionnalité par prompt.
3. **Demander les tests avec le code** : éviter de revenir après pour les écrire.
4. **Demander la mise à jour du Swagger** à chaque endpoint.
5. **En cas d'erreur** : laisser Antigravity exécuter `npm run typecheck` et corriger lui-même.
6. **Revue humaine systématique** : Antigravity peut écrire 1000 lignes — lire avant de commit.

---

_Mis à jour pour chaque nouveau sprint. — El Hadj Amadou NIANG_

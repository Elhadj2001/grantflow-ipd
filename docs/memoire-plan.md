# Plan du mémoire MIAGE — GRANTFLOW IPD
## Trajectoire rédactionnelle 12 mois

**Auteur** : El Hadj Amadou NIANG
**Date** : 02 juin 2026
**Version** : 1.0
**Cible** : Soutenance MIAGE — fin mai 2027
**Volume cible** : 250-300 pages dont 80-100 d'annexes
**Format** : LaTeX préféré (template MIAGE ou similaire), repli Word avec styles stricts

---

## 1. Philosophie rédactionnelle

Le mémoire MIAGE n'est pas un rapport de stage glorifié : c'est une **production intellectuelle** qui doit démontrer trois choses :

- une **maîtrise d'un domaine** (comptabilité analytique multi-bailleurs au sens SYSCEBNL),
- une **maîtrise d'une démarche d'ingénierie** (du cadrage métier à la mise en production via architecture, implémentation et tests),
- une **capacité critique** (savoir évaluer ce qu'on a fait, identifier ses limites, proposer une trajectoire).

Le plan ci-dessous est conçu pour servir ces trois objectifs en parallèle, **chapitre par chapitre**, avec une rédaction qui avance pendant les phases techniques plutôt qu'après. La règle d'or : **un chapitre commence à être rédigé pendant la phase technique qui le concerne**, pour capter à chaud les décisions et leur justification.

## 2. Architecture du document

Le mémoire est organisé en quatre parties précédées d'une introduction et suivies d'une conclusion, plus un appareil d'annexes substantiel. Le découpage suit le flux : domaine métier → architecture → implémentation → évaluation.

### Front matter (~10 pages)

- Page de garde institutionnelle (logo IPD, logo université, titre, auteur, encadrant, jury, date).
- Page de copyright et licence du code source (MIT/Apache 2.0 à trancher).
- Remerciements (1-2 pages).
- Résumé français (1 page, ~300 mots) + Abstract anglais (1 page).
- Mots-clés français + anglais.
- Sommaire détaillé (3-4 pages).
- Liste des abréviations et acronymes (1-2 pages).
- Liste des figures (1-2 pages).
- Liste des tableaux (1-2 pages).

### Introduction (10-15 pages)

**Chapitre 0 — Introduction générale**

- 0.1 Contexte institutionnel — l'Institut Pasteur de Dakar et son écosystème de financement par conventions de recherche.
- 0.2 Problématique — quels défis pose la gestion financière multi-bailleurs sous contrainte SYSCEBNL ? Pourquoi les outils actuels (Excel + Sage généraliste) sont-ils insuffisants ?
- 0.3 Questions de recherche — formalisation des questions auxquelles le mémoire répond.
- 0.4 Objectifs du projet GRANTFLOW IPD — fonctionnels, techniques, organisationnels.
- 0.5 Hypothèses et postulats — explicitation des hypothèses méthodologiques (cf. §3 de la note de cadrage Phase 0).
- 0.6 Méthodologie — démarche d'ingénierie itérative, cycle agile, validation par confrontation aux patterns ERP standards.
- 0.7 Contributions — ce que le projet apporte de spécifique (modèle Grant Office + Note Technique, eligibility engine adapté NGO, multi-devise tripartite ancrée SYSCEBNL).
- 0.8 Plan du mémoire — guide de lecture.

**Phase de rédaction associée** : Phase 0 (semaines 1-4).

---

### Partie I — État de l'art (40-50 pages)

**Chapitre 1 — Le référentiel SYSCEBNL et la comptabilité des organisations à but non lucratif** (~15 pages)

- 1.1 L'Acte uniforme OHADA relatif aux entités à but non lucratif — origines, périmètre, philosophie.
- 1.2 Le plan comptable SYSCEBNL — structure des classes 1 à 9.
- 1.3 Spécificités vs SYSCOA/SYSCOHADA — fonds dédiés, conventions de financement, contributions sur fonds propres.
- 1.4 Les états réglementaires — Bilan, Compte de Résultat, Tableau des Emplois et Ressources (TER), état des fonds dédiés.
- 1.5 Articulation avec la fiscalité sénégalaise — TVA déductible, exonérations sur fonds de recherche, conventions multilatérales.

**Phase de rédaction associée** : Phase 6 (semaines 43-46), pendant l'étude comparative.

**Chapitre 2 — Les ERP du secteur recherche et NGO — étude documentaire** (~20-25 pages)

- 2.1 Panorama du marché — segmentation par taille, secteur, géographie.
- 2.2 Analyse approfondie de cinq ERP de référence — SAP Public Sector Management (Funds Management, Grants Management), Oracle Federal Financials / Grants Accounting, Sage Intacct Nonprofit, Serenic Navigator (Microsoft Dynamics), FundEZ.
- 2.3 Patterns communs identifiés — multi-dimensional accounting, commitment ledger, fund accounting, donor reporting, indirect cost allocation, approval workflows par seuil.
- 2.4 Limitations observées — coût d'acquisition, vendor lock-in, complexité d'implémentation, inadéquation au contexte africain et OHADA.
- 2.5 Synthèse — positionnement attendu d'un système open-source ancré SYSCEBNL.

**Phase de rédaction associée** : Phase 6 (semaines 43-46), comme produit direct de l'étude comparative.

**Chapitre 3 — Le cycle Procure-to-Account et les contrôles internes** (~10 pages)

- 3.1 Le cycle P2A en théorie — Demande d'achat → Bon de commande → Réception → Facturation → Paiement → Comptabilisation.
- 3.2 Les contrôles internes attendus — référentiels COSO 2013 et ISA 315.
- 3.3 La séparation des tâches (SoD) — typologie des incompatibilités, jurisprudence d'audit.
- 3.4 La piste d'audit — exigences ISA 230, traçabilité, immutabilité.
- 3.5 Les contraintes spécifiques au secteur recherche — fonds dédiés, éligibilité, reporting bailleur, audit conventionnel.

**Phase de rédaction associée** : Phase 0 + Phase 3 (semaines 1-4 puis 15-18).

---

### Partie II — Spécification et conception (60-80 pages)

**Chapitre 4 — Le domaine métier IPD : acteurs, conventions et processus** (~20 pages)

- 4.1 L'IPD dans le réseau Pasteur International — gouvernance, financements, activités.
- 4.2 La Direction Administrative et Financière — organigramme fonctionnel.
- 4.3 Les acteurs du cycle financier — PI, GO, DAF, Directeur, CG, Comptable, Trésorier, Caissier, Magasinier, Acheteur, Demandeur, Auditeur externe.
- 4.4 Le cycle de vie d'une convention de recherche — de la réception à la clôture, en passant par la rédaction de la Note Technique par le Grant Office.
- 4.5 Les workflows clés — activation budgétaire, Procure-to-Account, reporting bailleur, audit, clôture périodique.
- 4.6 Les contrôles internes spécifiques IPD — le catalogue des « à ne pas faire » converti en règles système.

**Phase de rédaction associée** : Phase 0 (semaines 1-4), à partir du PPT IPD et de la note de cadrage.

**Chapitre 5 — Architecture logicielle et patterns appliqués** (~20 pages)

- 5.1 Vue d'ensemble — monolithe modulaire en NestJS + Next.js + PostgreSQL.
- 5.2 Découpage en bounded contexts — auth, referential, procurement, ap, gl, co, treasury, reporting, audit, grant_office, compliance_audit.
- 5.3 Le pattern Controller → Service → Repository — application stricte, exceptions documentées.
- 5.4 La gestion des erreurs — catalogue `BusinessException` (~150 sous-classes), pattern « comply or document ».
- 5.5 La piste d'audit applicative — Pino logging structuré, correlation-id, `audit.event_log` au niveau domaine.
- 5.6 Le pattern « DDL-first » — synthèse de l'ADR-001.
- 5.7 Les Architecture Decision Records — méthodologie, catalogue des 15 ADRs.

**Phase de rédaction associée** : Phase 4 (semaines 19-24).

**Chapitre 6 — Modèle de données et invariants comptables** (~15 pages)

- 6.1 Vue d'ensemble du modèle — 8 schémas Postgres, ~50 tables principales.
- 6.2 Les invariants protégés au niveau DB — équilibre débit-crédit (trigger), période close (trigger), chaînage hash audit (trigger), colonnes générées (line_total, overhead_amount).
- 6.3 Les vues de pilotage — `co.v_budget_tracking`, `gl.v_general_balance`.
- 6.4 L'évolution du modèle — workflow DDL-first, migrations idempotentes.
- 6.5 Diagramme entité-association global — vue de haut.
- 6.6 Diagrammes UML détaillés par bounded context — referential, procurement, gl, etc.

**Phase de rédaction associée** : Phase 4 (semaines 19-24).

**Chapitre 7 — Architecture multidevise et alignement SYSCEBNL** (~20-25 pages)

- 7.1 Le défi multi-devises dans une organisation NGO sous SYSCEBNL.
- 7.2 Le pattern Currency Types — SAP Financial Accounting, IAS 21, application à GRANTFLOW.
- 7.3 Le triplet `*_amount` / `*_currency` / `*_amount_xof` / `*_fx_rate` / `*_fx_rate_date`.
- 7.4 Le service `ExchangeRateService` — source unique, parité BCEAO fixe, fallback indicatif.
- 7.5 La conversion sur les hot paths — routage par seuil, contrôle budgétaire, limites caisse, engagement classe 8.
- 7.6 La précision numérique — `Prisma.Decimal` vs `Number`, conséquences sur les agrégats.
- 7.7 L'audit-trail des conversions — Pino structuré, reproductibilité d'audit.
- 7.8 Synthèse de l'ADR-005.

**Phase de rédaction associée** : Phase 1 (semaines 5-14), chapitre majeur écrit en parallèle de l'implémentation.

---

### Partie III — Implémentation et validation (60-80 pages)

**Chapitre 8 — Implémentation technique** (~15 pages)

- 8.1 Stack technique retenue et justifications — NestJS 10, Next.js 14 App Router, PostgreSQL 16, Prisma 5, Redis + BullMQ, MinIO/R2, Keycloak.
- 8.2 Le déploiement multi-environnements — dev local Docker, démo cloud (Render + Vercel + Neon), cible IPD on-premise.
- 8.3 La CI/CD — branch protection, gates lint+typecheck+test+e2e, preview deploys.
- 8.4 L'observabilité — Pino structuré, correlation-id, métriques business.
- 8.5 La sécurité — Helmet, CORS strict, rate limiting, JWT, MFA via Keycloak, séparation des tâches.
- 8.6 Le stockage des pièces — Cloudflare R2 single bucket avec routing par préfixe, immutabilité par object-lock.

**Phase de rédaction associée** : Phase 5B (semaines 39-42).

**Chapitre 9 — Modules métier spécifiques au secteur recherche / NGO** (~30-35 pages)

- 9.1 Grant Office et Note Technique — modélisation, workflow, ergonomie. *Synthèse de l'ADR-006.*
- 9.2 Eligibility Engine — règles, performances, audit. *Synthèse de l'ADR-007.*
- 9.3 Maquettes bailleur configurables et génération de rapports — multi-format, multi-langue, signature électronique.
- 9.4 Versioning des rapports et colonne d'ajustement — immutabilité du transmis. *Synthèse de l'ADR-011.*
- 9.5 Module Audit conventionnel — mission letters, rapports auditeurs, co-signatures.
- 9.6 Refacturation inter-pôles IPD — écritures miroirs au consolidé.
- 9.7 Contribution sur fonds propres — catégorie de fonds dédiée.
- 9.8 Justificatifs typés par nature de dépense — contrôle de complétude.
- 9.9 États SYSCEBNL réglementaires — TER, état des fonds dédiés, bilan formaté.

**Phase de rédaction associée** : Phase 5A (semaines 25-38), chapitre central du mémoire.

**Chapitre 10 — Gouvernance, contrôle interne et conformité ISA 315 / COSO 2013** (~15-20 pages)

- 10.1 La séparation des tâches enforced par identité. *Synthèse de l'ADR-009.*
- 10.2 La matrice de visibilité et le pattern `canActorViewPr`.
- 10.3 L'audit-trail SHA-256 chaîné au niveau du moteur PostgreSQL.
- 10.4 Le mécanisme de break-glass SUPER_ADMIN et le tableau de bord des bypass.
- 10.5 Le pentest interne OWASP — méthodologie, résultats, corrections.
- 10.6 Conformité aux exigences bailleurs — USAID 2 CFR 200, Wellcome, EU Horizon.

**Phase de rédaction associée** : Phase 3 (semaines 15-18).

**Chapitre 11 — Tests, qualité et validation** (~10-15 pages)

- 11.1 La pyramide de tests retenue — Unit > Integration > E2E.
- 11.2 Couverture cible et résultats — > 70 % API, > 50 % web.
- 11.3 Les tests d'éligibilité — un test par règle métier issue du PPT IPD.
- 11.4 Les tests d'intégration multidevise — combinaisons devise × seuil × type DA.
- 11.5 Les tests E2E Playwright — 5-7 parcours principaux.
- 11.6 La stabilité de la suite — migration `mockDeep<PrismaService>()`, mock horloge, dataset déterministe.
- 11.7 L'audit transversal du 02 juin 2026 — méthodologie 6-axes, 28 findings, plan de résorption.

**Phase de rédaction associée** : Phase 2 (semaines 7-10) + reprise Phase 8.

---

### Partie IV — Évaluation et perspectives (30-40 pages)

**Chapitre 12 — Étude comparative et positionnement** (~25-30 pages)

- 12.1 Méthodologie de l'étude comparative — choix des ERP, grille d'évaluation 80-100 critères, sources.
- 12.2 Tableau comparatif détaillé — SAP PSM, Oracle Grants, Sage Intacct, Serenic, FundEZ, EBP, Sage X3, GRANTFLOW IPD.
- 12.3 Positionnement GRANTFLOW — forces, faiblesses, niches.
- 12.4 Argumentaire d'adoption IPD — TCO comparatif, time-to-deploy, customization, vendor lock-in, alignement SYSCEBNL.
- 12.5 Les ERP commerciaux comme cible long-terme ? — réflexion sur la trajectoire d'évolution potentielle.

**Phase de rédaction associée** : Phase 6 (semaines 43-46), chapitre fort différenciant.

**Chapitre 13 — Évaluation critique du système livré** (~10 pages)

- 13.1 Les acquis structurels — DDL-first respecté, invariants protégés, audit-trail SHA-256, séparation des tâches enforced, multi-devise tripartite, modules NGO-spécifiques.
- 13.2 Les limites identifiées par l'audit transversal — couverture des 28 findings, état au moment de la soutenance.
- 13.3 Les limites résiduelles non levées — dette consciemment acceptée, justifications.
- 13.4 Les retours d'expérience du développement — sprints, décisions, retours en arrière, mort-vivants.

**Phase de rédaction associée** : Phase 8 (semaines 51-52).

**Chapitre 14 — Roadmap et perspectives d'adoption IPD** (~10 pages)

- 14.1 La trajectoire post-soutenance — du livrable mémoire au pilote IPD.
- 14.2 Le plan de change management — phases d'adoption, formation, accompagnement.
- 14.3 Les évolutions techniques planifiées — multi-tenant, micro-services extraits, mobile native, IA pour OCR avancé.
- 14.4 L'ouverture à la communauté Pasteur International — possibilité d'utilisation par d'autres instituts du réseau.
- 14.5 Les pistes de valorisation académique — publication, open source, partenariats.

**Phase de rédaction associée** : Phase 7 (semaines 47-50).

---

### Conclusion générale (5-10 pages)

**Chapitre 15 — Conclusion**

- 15.1 Synthèse des contributions.
- 15.2 Réponse aux questions de recherche posées en introduction.
- 15.3 Limites du travail.
- 15.4 Perspectives.

**Phase de rédaction associée** : Phase 8 (semaines 51-52).

---

### Annexes (80-100 pages)

- **Annexe A** — Glossaire IPD et lexique technique (5 pages).
- **Annexe B** — Audit transversal du 02 juin 2026, version complète (10-15 pages).
- **Annexe C** — Catalogue Architecture Decision Records (20-30 pages — les 15 ADRs).
- **Annexe D** — Tableau comparatif ERP détaillé, 80-100 critères (10-15 pages).
- **Annexe E** — Schémas UML — diagrammes de cas d'usage, de séquence, de classes, d'activité (10-15 pages).
- **Annexe F** — DDL PostgreSQL — extraits structurants et commentés (10 pages).
- **Annexe G** — Backlog initial sprintable et trajectoire effective (5-10 pages).
- **Annexe H** — Documentation utilisateur — extraits illustratifs (10 pages).
- **Annexe I** — Captures d'écran de la démonstration end-to-end (5-10 pages).

### Bibliographie (5-10 pages)

Toutes les sources citées, classées par type :

- Ouvrages académiques (livres, manuels).
- Articles de revues à comité de lecture.
- Normes et référentiels (OHADA, ISA, COSO, IFRS).
- Documentation ERP (SAP Help, Oracle docs, Sage docs).
- Guidelines bailleurs (USAID, Wellcome, EU).
- Documentation technique (NestJS, Prisma, Next.js, PostgreSQL).
- Sources web — avec date de consultation.

---

## 3. Trajectoire de rédaction par phase

Le tableau suivant donne, pour chaque phase technique du plan d'action 12 mois, le chapitre du mémoire à rédiger en parallèle. La rédaction commence pendant la phase et est consolidée à la fin.

| Phase | Période | Chapitres à rédiger en parallèle | Volume estimé |
|---|---|---|---|
| **Phase 0** | Juin 26 | Introduction (0) + Chapitre 4 (domaine IPD) + Chapitre 3 (cycle P2A) | 35-45 p. |
| **Phase 1** | Juil-Sept 26 | Chapitre 7 (multidevise et SYSCEBNL) | 20-25 p. |
| **Phase 2** | Juil-Août 26 (//) | Chapitre 11 (tests et qualité) | 10-15 p. |
| **Phase 3** | Sept-Oct 26 | Chapitre 10 (gouvernance et contrôle interne) | 15-20 p. |
| **Phase 4** | Oct-Nov 26 | Chapitres 5 (architecture) + 6 (modèle de données) | 35 p. |
| **Phase 5A** | Nov 26 - Fév 27 | Chapitre 9 (modules métier NGO) | 30-35 p. |
| **Phase 5B** | Mars 27 | Chapitre 8 (implémentation technique) | 15 p. |
| **Phase 6** | Mars-Avr 27 | Chapitres 1 (SYSCEBNL) + 2 (ERP étude) + 12 (comparatif) | 60-75 p. |
| **Phase 7** | Avr-Mai 27 | Chapitre 14 (roadmap) + artefacts persuasion | 10 p. |
| **Phase 8** | Mai 27 | Chapitre 13 (éval critique) + Conclusion + Front matter + Annexes consolidées + Bibliographie | 30-50 p. |

**Total estimé** : 260-325 pages, dans la fourchette cible.

---

## 4. Normes typographiques et bibliographiques

### Mise en page

- **Police de corps** : Garamond ou Times New Roman 11 pt. *Choix arrêté en Phase 0.*
- **Police de titres** : Garamond, Calibri ou Roboto 14-18 pt selon niveau.
- **Police monospace** (code) : JetBrains Mono ou Fira Code 9 pt, fonds gris léger.
- **Interligne** : 1,5 pour le corps, simple pour les blocs de code et les notes de bas de page.
- **Marges** : 2,5 cm en haut/bas, 3 cm à gauche (reliure), 2,5 cm à droite.
- **Alignement** : justifié pour le corps, gauche pour les titres et légendes.
- **Pagination** : numérotation romaine (i, ii…) pour le front matter, arabe (1, 2…) à partir de l'introduction.

### Numérotation et titrage

- Maximum 3 niveaux de titre dans le corps : Chapitre (1.), Section (1.1), Sous-section (1.1.1). Pas de quatrième niveau, préférer le découpage en sections.
- Numérotation continue des figures et tableaux dans le mémoire — *Figure 5.3 : Diagramme de séquence de l'approbation DA multi-niveaux*.

### Citations et références bibliographiques

- **Style retenu** : norme **APA 7e édition** (auteur-date). Justification : standard académique en sciences de gestion et systèmes d'information.
- **Citation in-line** : « comme le souligne Newman (2021, p. 87)… » ou « (Newman, 2021, p. 87) ».
- **Citation longue** (> 4 lignes) : bloc indenté sans guillemets, taille de police réduite (10 pt).
- **Notes de bas de page** : réservées aux précisions techniques ou contextuelles, pas aux références bibliographiques.
- **Bibliographie** : classée par ordre alphabétique d'auteur, format APA.

Exemples :

```
Newman, S. (2021). Building Microservices: Designing Fine-Grained Systems (2nd ed.). O'Reilly Media.

Fowler, M. (2015). Monolith First. martinfowler.com. https://martinfowler.com/bliki/MonolithFirst.html (consulté le 02 juin 2026).

OHADA. (2017). Acte uniforme relatif au droit comptable et à l'information financière. Journal Officiel OHADA, n° 30.

USAID. (2014). 2 CFR Part 200 — Uniform Administrative Requirements, Cost Principles, and Audit Requirements for Federal Awards. U.S. Government Publishing Office.
```

### Schémas et figures

- Tous les schémas d'architecture sont produits en **PlantUML** ou **draw.io**, exportés en **SVG** ou **PDF vectoriel** pour préserver la qualité d'impression.
- Les captures d'écran de l'application sont prises à **résolution Retina** (au moins 1920×1080), exportées en **PNG sans compression** ou **WebP haute qualité**.
- Les diagrammes UML respectent la norme UML 2.5.
- Chaque figure porte une légende explicative en italique, sous la figure.
- Chaque tableau a un titre en gras au-dessus, et ses colonnes alignées (texte à gauche, nombres à droite, en-têtes centrés).

### Code source

- Les extraits de code dans le corps du mémoire sont **limités à l'essentiel** (max 20 lignes par bloc).
- Coloration syntaxique activée (TypeScript, SQL).
- Les fichiers complets sont placés en annexe ou référencés dans le dépôt GitHub.
- Chaque extrait est précédé d'un commentaire explicatif et suivi d'une analyse.

---

## 5. Outils de rédaction recommandés

| Usage | Outil principal | Outil de repli |
|---|---|---|
| Rédaction | LaTeX (Overleaf) | Microsoft Word + styles stricts |
| Diagrammes | PlantUML, draw.io | Lucidchart |
| Schémas comptables | Excel + capture | LibreOffice Calc |
| Gestion bibliographique | Zotero | Mendeley |
| Captures d'écran | ShareX (Windows) | macOS Screenshot |
| Vidéos de démo | OBS Studio | QuickTime |
| Revue | Grammalecte (FR) + Antidote 11 | LanguageTool |

**Workflow rédactionnel** :

1. Premier jet en Markdown dans `docs/memoire/chapitres/chap-XX-titre.md` pendant la phase technique.
2. Réécriture LaTeX en fin de phase, intégration dans le document mémoire principal.
3. Revue typographique et grammaticale par Antidote ou Grammalecte.
4. Relecture humaine par le directeur de mémoire à chaque jalon de phase.
5. Consolidation finale en Phase 8, exports PDF + impression.

---

## 6. Jalons de validation

| Jalon | Date | Livrable |
|---|---|---|
| J1 — Cadrage validé | 30 juin 2026 | Note de cadrage + plan mémoire validés par le directeur |
| J2 — Mi-parcours technique | 30 sept 2026 | Démonstration Phase 1 + chapitre 7 brouillon |
| J3 — Architecture stabilisée | 30 nov 2026 | Phase 4 terminée + chapitres 5-6 brouillon |
| J4 — Modules métier livrés | 28 fév 2027 | Phase 5A terminée + chapitre 9 brouillon |
| J5 — Système complet | 30 avr 2027 | Phase 6 terminée + comparatif et étude de l'art prêts |
| J6 — Pré-soutenance | 15 mai 2027 | Mémoire complet relu, slides prêtes |
| J7 — Soutenance | fin mai 2027 | — |

À chaque jalon, **rendre une version PDF** du mémoire en l'état au directeur de mémoire, même incomplète. La rétroaction continue vaut mieux qu'une remise finale qui découvre tardivement des écarts.

---

## 7. Risques rédactionnels et leur mitigation

| Risque | Probabilité | Impact | Mitigation |
|---|---|---|---|
| Procrastination — rédaction repoussée à la fin | Élevée | Très élevé | Discipline 4h/semaine minimum dédiées rédaction dès Phase 0 ; jalons trimestriels |
| Hyper-perfectionnisme — réécriture sans fin | Moyenne | Moyen | Règle « jamais plus de 3 passes par chapitre avant relecture directeur » |
| Bloc rédactionnel sur un chapitre | Moyenne | Moyen | Switch sur un autre chapitre, retour plus tard ; outline détaillée avant rédaction |
| Style trop technique pour le jury | Moyenne | Élevé | Relecture par un pair non-MIAGE après chaque chapitre |
| Bibliographie sous-fournie | Faible | Moyen | Tenue continue dans Zotero dès Phase 0, objectif 80+ références |
| Schémas illisibles à l'impression | Élevée | Faible | Test d'impression en couleur ET noir et blanc à J3 |
| Mémoire trop long ou trop court | Moyenne | Faible | Suivi du compteur de pages par chapitre tous les jalons |
| Perte de fichiers | Faible | Très élevé | Git + sauvegarde Overleaf + backup hebdomadaire externe |

---

## 8. Indicateurs de pilotage

À tenir à jour dans un tableau de bord personnel (peut être un Excel ou un fichier Markdown):

- Nombre de pages écrites par semaine.
- Nombre de chapitres au statut **brouillon / révisé / final**.
- Nombre de références dans Zotero.
- Nombre de schémas et figures produits.
- Avancement du dépôt GitHub vs. plan.
- Niveau de rouge / vert sur les jalons J1 à J7.

Une review hebdomadaire de ces indicateurs (15 min le vendredi) suffit à maintenir le cap sur 12 mois.

---

## 9. Synthèse

Le mémoire GRANTFLOW IPD est conçu comme un produit intégré : code, documentation, et écriture progressent ensemble. La rédaction est **distribuée sur les 12 mois** plutôt que concentrée à la fin, ce qui permet de capter à chaud les décisions et de produire une argumentation ancrée dans le réel des décisions de développement plutôt que dans un récit reconstitué a posteriori.

Le plan ci-dessus est une **base de discussion avec le directeur de mémoire** et doit être affiné dès le J1 selon ses préférences (volume cible, style attendu, axes de fond à privilégier). Il sert également d'outil de pilotage personnel pour s'assurer qu'aucun chapitre n'est oublié ou sous-traité.

---

*Plan du mémoire MIAGE — Version 1.0 — 02 juin 2026*
*Auteur : El Hadj Amadou NIANG — GRANTFLOW IPD*

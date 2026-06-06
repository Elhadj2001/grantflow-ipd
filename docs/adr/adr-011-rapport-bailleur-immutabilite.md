# ADR-011 — Immutabilité des rapports publiés et versioning par colonne d'ajustement

**Statut** : accepted
**Date** : 2026-06-02
**Auteur** : El Hadj Amadou NIANG

## Contexte

Le PPT IPD énonce en slide 7 une règle structurante de comptabilité réglementaire NGO :

> *« Ne pas modifier les comptes rendus financiers déjà transmis ; au besoin ajouter une colonne d'ajustement et présenter un nouveau total. »*

Cette règle traduit un principe d'**immutabilité du publié** : un rapport financier transmis à un bailleur ne peut pas être réécrit a posteriori, car il a valeur juridique et engage la responsabilité du DAF et du Directeur qui l'ont co-signé. Si une correction devient nécessaire (erreur d'imputation détectée tardivement, dépense rejetée par le bailleur, refacturation inter-pôles tardive), elle doit être matérialisée comme une **modification explicite** dans une nouvelle version du rapport, et non comme une réécriture silencieuse.

Cette pratique est conforme aux standards internationaux :

- **ISA 230 — Audit Documentation** : la documentation des modifications après finalisation doit être identifiable et tracée.
- **USAID FFR Federal Financial Report** : les amendements sont demandés via SF-425A avec mention de la période ajustée.
- **EU Horizon Form C** : les corrections doivent être présentées en colonne séparée avec justification.
- **Wellcome Trust** : les rapports révisés portent un suffixe de version et incluent un cover letter explicatif.

L'audit GRANTFLOW du 02 juin 2026 a confirmé que cette logique d'immutabilité avec versioning par ajustement **n'est pas implémentée** dans le système actuel. Aujourd'hui, un rapport généré peut être ré-généré à tout moment avec des valeurs différentes — comportement inacceptable en contexte réel IPD.

Trois approches étaient possibles : (a) **rapports re-générables sans contrainte** (statu quo), (b) **rapports figés une fois générés, modification interdite**, (c) **rapports immuables une fois transmis, avec versioning explicite par ajustement**.

## Décision

GRANTFLOW IPD implémente en Phase 5A un modèle de **versioning des rapports bailleur avec immutabilité du transmis et colonne d'ajustement**.

**Entité `ReportVersion`** (cf. note de cadrage §13.5) :

```
report_version
├── id UUID PK
├── donor_report_assignment_id UUID FK → donor_report_assignment
├── version INT NOT NULL  (1, 2, 3...)
├── status TEXT CHECK IN ('draft', 'signed_daf', 'signed_director', 'transmitted', 'superseded')
├── generated_at TIMESTAMP NOT NULL
├── pdf_storage_key TEXT NULL
├── xlsx_storage_key TEXT NULL
├── daf_signature_at TIMESTAMP NULL
├── daf_signed_by_user_id UUID FK NULL
├── director_signature_at TIMESTAMP NULL
├── director_signed_by_user_id UUID FK NULL
├── transmitted_at TIMESTAMP NULL
├── transmitted_by_user_id UUID FK NULL
├── adjustment_column_notes TEXT NULL
├── supersedes_version_id UUID FK → report_version NULL
├── UNIQUE (donor_report_assignment_id, version)
```

**Workflow** :

1. **draft** : version créée par le GO. Modifiable librement (régénération PDF/Excel à volonté).
2. **signed_daf** : le DAF a apposé sa signature électronique. Statut figé sauf retour explicite en draft (action loggée).
3. **signed_director** : le Directeur a apposé sa signature après le DAF. Idem.
4. **transmitted** : le GO marque la transmission au bailleur (avec date, canal, accusé de réception). À partir de ce moment :
   - Le PDF et l'Excel sont **immuables** (clé MinIO/R2 ne peut plus être écrasée, vérifié au niveau application + idéalement bucket policy).
   - Aucune modification de la version n'est possible.
   - Une vue de la version reste consultable.
5. **superseded** : la version est marquée comme remplacée par une version postérieure (v2, v3...).

**Création d'une version d'ajustement** :

Quand un GO doit corriger un rapport transmis, il crée une **nouvelle version** (v2) avec :

- `supersedes_version_id` pointant sur la version transmise (v1).
- Une **colonne d'ajustement** dans le rapport généré, présentant pour chaque ligne :
  - Colonne A : montant tel que transmis en v1.
  - Colonne B : ajustement (positif ou négatif).
  - Colonne C : nouveau total (A + B).
- Un champ `adjustment_column_notes` qui justifie chaque ajustement matériel.
- Un cover note PDF généré automatiquement qui résume les ajustements pour le bailleur.

La version v2 suit le même workflow draft → signed_daf → signed_director → transmitted. Une fois v2 transmise, v1 passe automatiquement en `superseded`.

**Contraintes DDL** :

- Trigger PostgreSQL `report_version_immutability` qui interdit `UPDATE` sur une version `transmitted` (sauf transition `→ superseded` qui est uniquement déclenchée par l'application).
- Trigger `report_version_unique_active` qui garantit qu'au plus une version par assignment est dans un état `transmitted` actif (toutes les autres `transmitted` doivent être `superseded`).

**Implémentation stockage** :

- Une fois une version transmise, son PDF et son Excel sont copiés dans un préfixe `reports/transmitted/<assignment_id>/v<version>/` du bucket R2 avec policy de lecture seule (`object-lock` si disponible).
- Le bucket R2 est configuré avec versioning natif activé pour défense en profondeur.

## Conséquences

### Positives

- **Conformité réglementaire** explicite : le système respecte la règle PPT IPD et les standards bailleurs (USAID, Wellcome, EU).
- **Audit-trail complet** : chaque version et chaque ajustement laisse une trace, exploitable par les auditeurs externes.
- **Crédibilité institutionnelle** auprès des bailleurs : un système qui fige les rapports transmis est perçu comme plus fiable qu'un système où l'historique peut bouger.
- **Mémoire** : pattern défendable, aligné avec la pratique professionnelle, exemple concret de traduction d'une exigence métier en architecture technique.
- **Tracabilité incidents** : si un bailleur conteste un montant, la version exacte transmise est reproductible bit-à-bit.

### Négatives

- **Complexité workflow** : l'utilisateur doit comprendre la différence entre version draft librement modifiable et version transmise figée. Mitigation : UI claire avec badges colorés par statut, documentation utilisateur.
- **Stockage augmenté** : chaque version transmise occupe un slot R2 immuable. Coût marginal acceptable (estimé < 100 Mo/an pour l'IPD).
- **Génération de la colonne d'ajustement** : implémentation non triviale, doit prendre en compte les évolutions de la maquette bailleur entre v1 et v2. Pour la v1 de l'implémentation, on pourra ne supporter que les maquettes stables.
- **Risque de prolifération de versions** si les ajustements sont trop fréquents. Mitigation : alerte si > 3 versions par assignment, signal d'un problème de processus en amont.

## Alternatives considérées

- **Statu quo** (rapports re-générables) — rejeté. Non-conformité à la règle PPT IPD et aux standards bailleurs. Disqualifiant pour l'adoption.
- **Rapports figés une fois générés, modification totalement interdite** — rejeté. Trop rigide : empêche les corrections légitimes (erreurs d'imputation détectées tardivement, refacturations inter-pôles, rejets bailleur).
- **Modification avec audit log uniquement** — rejeté. Viole l'esprit de l'immutabilité : un rapport signé et transmis doit rester bit-à-bit identique, même si l'audit log trace la modification.
- **Versioning automatique sans colonne d'ajustement** — rejeté. La colonne d'ajustement est explicitement demandée par le PPT IPD et constitue la **valeur informative** ajoutée à la nouvelle version. Sans elle, le bailleur ne peut pas comprendre ce qui a changé.

## Références

- PPT IPD *Présentation Gestion de Projet et Conventions de Recherche*, slide 7 (« à ne pas faire »).
- ISA 230 — Audit Documentation, §A20-A23 (modifications après finalisation).
- USAID FFR SF-425 et SF-425A (Revised Federal Financial Report).
- EU Horizon Europe Grant Agreement, Article 21 — Reporting.
- Wellcome Trust Grants Conditions, Section 11 — Financial Reporting.
- Note de cadrage Phase 0, §2.4, §13.5.
- ADR-014 (à venir) — Stratégie de stockage immuable Cloudflare R2 avec object-lock.

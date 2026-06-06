# ADR-009 — Séparation des tâches enforced par identité avec dérogation explicite

**Statut** : accepted
**Date** : 2026-06-02
**Auteur** : El Hadj Amadou NIANG

## Contexte

La séparation des tâches (Segregation of Duties, SoD) est un **contrôle interne fondamental** dans tout système comptable, codifié par :

- COSO Internal Control Framework (2013), Principe 10 : « The organization selects and develops control activities that contribute to the mitigation of risks. »
- ISA 315 (révisée 2019), §A98-A111, identifie la SoD comme contrôle clé pour prévenir les fraudes et erreurs.
- Les guidelines USAID 2 CFR 200.303(b), Wellcome Trust Grants Conditions, EU Horizon Grant Agreement : tous exigent l'absence de cumul des fonctions incompatibles sur la même opération.

L'audit du 02 juin 2026 a identifié dans GRANTFLOW IPD un défaut systémique : la séparation est enforced **uniquement par rôle**, pas **par identité**. Conséquence : un utilisateur cumulant les rôles `DEMANDEUR` et `PI` peut créer une DA puis l'approuver lui-même. Idem pour `payment_run` (préparateur ≠ approbateur non vérifié) et pour le posting (créateur ≠ valideur d'écriture non vérifié).

Cette faille n'est pas marginale : elle est **disqualifiante** dans le secteur recherche/NGO sous audit externe, où les bailleurs vérifient explicitement la SoD pendant leurs audits. Un système qui ne l'enforce pas est non-conforme à USAID 2 CFR 200, ce qui peut entraîner la perte d'éligibilité aux subventions fédérales américaines.

Cependant, l'IPD est une structure de taille moyenne où certains rôles peuvent ponctuellement être cumulés (un petit projet sans CG dédié, un PI qui gère seul son projet de bout en bout). Une SoD enforcée sans dérogation rendrait le système inutilisable en pratique.

Trois approches étaient envisageables : (a) **statu quo** (SoD par rôle uniquement), (b) **SoD stricte par identité sans dérogation**, (c) **SoD par identité par défaut avec dérogation explicite documentée**.

## Décision

GRANTFLOW IPD enforce la **Segregation of Duties par identité** sur les opérations sensibles, avec un mécanisme de **dérogation explicite à deux niveaux** :

**Règles de SoD enforced** :

| Opération sensible | Garde |
|---|---|
| Approbation DA | `actor.id !== pr.requestedById` |
| Approbation BC | `actor.id !== po.createdById` |
| Validation Goods Receipt | `actor.id !== gr.requestedById` |
| Validation facture | `actor.id !== invoice.recordedById` |
| Approbation payment run | `actor.id !== paymentRun.preparedById` |
| Validation écriture comptable (`posted`) | `actor.id !== entry.createdById` |
| Co-signature rapport bailleur (DAF + Directeur) | identités distinctes |

**Catalogue d'exceptions** :

```typescript
export class SegregationOfDutiesException extends BusinessException {
  constructor(
    public readonly operation: string,
    public readonly actorId: string,
    public readonly creatorId: string,
    public readonly bypassAvailable: boolean,
  ) {
    super(
      `SEGREGATION_OF_DUTIES_VIOLATION`,
      `L'utilisateur ${actorId} ne peut pas ${operation} une opération qu'il a lui-même initiée (créateur: ${creatorId}).`,
      403,
    );
  }
}
```

**Mécanisme de dérogation à deux niveaux** :

**Niveau 1 — Convention `single_actor_authorized`** : la convention bailleur peut explicitement autoriser un mode dégradé (`grant.single_actor_authorized = TRUE`). Ce flag est validé par le DAF au moment de la création/activation de la Note Technique (cf. ADR-006), avec justification écrite dans le champ `single_actor_justification`. Une fois activé, les gardes SoD ne bloquent plus pour les opérations sur ce grant.

**Niveau 2 — Break-glass SUPER_ADMIN** : un utilisateur avec rôle `SUPER_ADMIN` peut court-circuiter toutes les gardes SoD en passant un header `X-Bypass-SoD-Reason: <texte>` avec un motif obligatoire (min 20 caractères). Chaque bypass est :

- **Loggué loud** dans `audit.event_log` avec marqueur `event_type = 'sod_bypass'`, `bypass_reason` obligatoire, identité de l'utilisateur, opération concernée.
- **Visible** dans un tableau de bord DAF dédié « Bypass SoD du mois ».
- **Compté** dans un KPI mensuel : nombre de bypass, par utilisateur, par opération. Objectif : < 5 bypass/mois en régime de croisière.

**Implémentation** :

- Décorateur `@RequireDifferentActor(creatorField: keyof Entity)` appliqué aux endpoints d'approbation.
- Guard NestJS `SegregationOfDutiesGuard` qui inspecte le décorateur, vérifie la convention, intercepte le header break-glass.
- Tests d'intégration : un cas par règle, un cas convention-autorisé, un cas break-glass tracé.

## Conséquences

### Positives

- **Conformité COSO / ISA 315 / USAID 2 CFR 200** atteinte — argument fort pour l'éligibilité aux subventions fédérales américaines et européennes.
- **Audit-friendly** : le tableau de bord SoD bypass devient une **section directe du rapport d'audit interne** mensuel.
- **Évolutivité** : la dérogation à deux niveaux préserve l'utilisabilité pour les petites équipes tout en gardant la rigueur pour les grandes conventions.
- **Mémoire** : pattern aligné avec la littérature ISA et NGO, défendable académiquement.
- **Crédibilité institutionnelle** : argument fort de l'adoption IPD — la DFC peut présenter ce contrôle aux bailleurs lors des audits.

### Négatives

- **Friction utilisateur** sur les petites équipes : le mode `single_actor_authorized` doit être activé conventionnellement, ce qui ajoute une étape. Mitigation : documentation utilisateur dédiée + onboarding DAF.
- **Risque d'abus du break-glass** : si la culture interne tolère des bypass routiniers, la SoD perd son sens. Mitigation : le KPI mensuel et l'alerte automatique si > 5 bypass/mois (envoyée au Directeur) créent une boucle de feedback dissuasive.
- **Impact UI** : il faut afficher clairement à l'utilisateur quand un bypass est en cours, et tracer ces opérations différemment dans les listes (badge orange « Bypass SoD »).
- **Tests plus nombreux** : chaque endpoint d'approbation nécessite désormais 3-4 cas de test (cas nominal, créateur cherche à approuver, convention autorisée, break-glass).

## Alternatives considérées

- **Statu quo** (SoD par rôle uniquement) — rejeté. Non-conformité COSO/ISA/USAID, disqualifiant pour l'adoption IPD réelle.
- **SoD stricte sans dérogation** — rejeté. Bloquerait les petites équipes IPD où un PI gère seul son projet. Sortirait du champ d'usage réel.
- **Dérogation au cas par cas par action** (chaque approbation peut demander un bypass) — rejeté. Granularité trop fine, multiplie les opportunités d'abus, complexifie l'UI.
- **Dérogation purement organisationnelle** (procédure papier, pas dans le système) — rejeté. Pas de trace numérique, pas de tableau de bord, pas d'audit-trail.

## Références

- COSO Internal Control — Integrated Framework (2013), Principle 10.
- ISA 315 (revised 2019), §A98-A111.
- USAID 2 CFR 200.303(b) — Internal Controls.
- Wellcome Trust Grants Conditions — section Financial Controls.
- EU Horizon Europe Grant Agreement — Articles on financial management.
- Audit GRANTFLOW IPD du 02 juin 2026, finding F3.
- Note de cadrage Phase 0, §9.
- ADR-006 — Note Technique (porte le flag `single_actor_authorized`).

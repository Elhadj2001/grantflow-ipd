# `seed/` — Fixtures de données initiales

Ce dossier contient les **données métier de référence** chargées à l'initialisation de la base, séparées du code TypeScript pour faciliter la revue par les experts comptables et la mise à jour réglementaire.

## Fichiers

| Fichier | Contenu | Modèle Prisma cible |
|---|---|---|
| `syscebnl-accounts.json` | Plan comptable SYSCEBNL — classes 1 à 9 | `GlAccount` |
| `donors.json` | 9 bailleurs typiques de l'IPD | `Donor` |
| `roles.json` | 10 rôles RBAC | `Role` |
| `tax-codes.json` | Codes TVA et retenues Sénégal | `TaxCode` |
| `fiscal-periods-2026.json` | Périodes fiscales 2026 (an, trimestres, mois) | `FiscalPeriod` |

## Utilisation depuis `apps/api/prisma/seed.ts`

```typescript
import accountsJson from '../../../seed/syscebnl-accounts.json';
import donorsJson   from '../../../seed/donors.json';
import rolesJson    from '../../../seed/roles.json';

for (const a of accountsJson.accounts) {
  await prisma.glAccount.upsert({
    where: { code: a.code },
    update: {},
    create: {
      code: a.code,
      label: a.label,
      class: a.class,
      isMovement: a.is_movement,
      syscebnlSpecific: a.syscebnl_specific,
      description: a.description ?? null,
    },
  });
}
```

> **Important** : ces fichiers sont la source unique de vérité. Toute modification du plan comptable doit passer par ce JSON, puis être validée par le contrôle de gestion avant ré-exécution du seed.

## Pour Claude Code / Antigravity

Quand on génère ou met à jour `seed.ts`, on ne **duplique jamais** les données : on **importe** depuis ces JSON. Cela permet de :

1. Maintenir une source unique
2. Faire valider le plan comptable par le DAF sans toucher au code
3. Versionner indépendamment règles techniques et données réglementaires

<!-- Merci pour votre contribution à GRANTFLOW IPD !
     Remplissez ce template pour faciliter la revue. -->

## 📋 Description

<!-- Décrire ce que la PR change, en une ou deux phrases. -->

## 🎯 Issue liée

<!-- Mentionner l'issue principale. Remplacer #N par le numéro. -->
Closes #N

## 🧩 Type de changement

<!-- Cochez tout ce qui s'applique. -->

- [ ] 🆕 Nouvelle fonctionnalité (`feat`)
- [ ] 🐛 Correction de bug (`fix`)
- [ ] 📖 Documentation (`docs`)
- [ ] 🧹 Refactorisation (`refactor`)
- [ ] 🚀 Performance (`perf`)
- [ ] 🧪 Tests (`test`)
- [ ] 🛠️ Outillage / CI (`chore` / `ci`)
- [ ] 💥 Breaking change

## 🧠 Contexte métier / décisions

<!-- Si la PR a un impact métier (comptabilité, SYSCEBNL, bailleur), expliquer pourquoi.
     Toute écriture comptable doit-elle être imputée analytiquement ? OUI -->

## ✅ Checklist

- [ ] Mon code respecte les conventions du projet (`CLAUDE.md`)
- [ ] J'ai lancé `npm run lint` localement — aucun warning
- [ ] J'ai lancé `npm run typecheck` localement
- [ ] J'ai lancé `npm run test` localement — tous verts
- [ ] J'ai ajouté/mis à jour les tests pour mes changements
- [ ] J'ai mis à jour la documentation impactée
- [ ] Aucune écriture dans une colonne `GENERATED` (line_total, overhead_amount)
- [ ] Aucune utilisation de `prisma migrate dev` — DDL-first respecté
- [ ] Aucune donnée sensible (clé, IBAN, e-mail réel IPD) dans le code ou les tests

## 🗄️ Impact base de données

- [ ] Aucun
- [ ] Modification du DDL `docs/grantflow_ddl_postgresql.sql` (puis `prisma db pull` effectué)
- [ ] Ajout / modification de fixtures `seed/*.json`
- [ ] Nouveau modèle Prisma (issu de `db pull`)

## 🔐 Impact sécurité

- [ ] Aucun
- [ ] Nouveau endpoint protégé par `@Roles(...)`
- [ ] Modification du système d'authentification ou RBAC
- [ ] Nouvelle entrée dans l'audit log

## 📸 Captures d'écran (si UI)

<!-- Coller avant/après pour les changements visuels. -->

## 🧪 Comment tester

```bash
# Étapes pour reproduire / valider en local
git checkout <cette-branche>
npm install
npm run dev:api
# puis...
```

## 📚 Pour le mémoire

<!-- Si cette PR introduit un concept à expliquer dans le mémoire,
     préciser ici la section concernée. -->

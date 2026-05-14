# 🤝 CONTRIBUTING — GRANTFLOW IPD

> Guide rapide pour contribuer au projet. Pour le contexte métier complet, lire d'abord [`CLAUDE.md`](./CLAUDE.md). Pour le workflow GitHub détaillé, voir [`docs/GITHUB_SETUP.md`](./docs/GITHUB_SETUP.md).

## Pré-requis

- Node.js 22 LTS
- Docker Desktop (WSL2 sur Windows)
- PostgreSQL client (`psql`) — optionnel
- Un compte GitHub avec accès au dépôt
- Une clé SSH configurée (`ssh -T git@github.com` → OK)

## Démarrage rapide

```bash
git clone git@github.com:<owner>/grantflow-ipd.git
cd grantflow-ipd
cp .env.example .env
npm install
docker compose up -d
docker compose exec -T postgres psql -U grantflow -d grantflow_dev < docs/grantflow_ddl_postgresql.sql
cd apps/api && npm run prisma:generate && npm run prisma:seed
npm run dev:api    # un terminal
npm run dev:web    # autre terminal
bash scripts/validate-stack.sh   # confirme que tout est OK
```

## Workflow

1. **Toujours partir de la branche du sprint en cours** (`sprint-N`), jamais de `main`.
2. **Créer une branche feature** : `feat/<scope>-<verbe>` (kebab-case).
3. **Commits atomiques** au format [Conventional Commits](https://www.conventionalcommits.org/fr/).
4. **Lancer en local** avant push :
   ```bash
   npm run lint
   npm run typecheck
   npm run test
   ```
5. **Ouvrir une PR** vers la branche sprint (pas `main`).
6. **Lier l'issue** dans la PR : `Closes #N`.
7. **Attendre la CI verte** avant de merger.

## Règles d'or

Voir [`CLAUDE.md`](./CLAUDE.md), section 2.

- ✅ Imputation analytique obligatoire à la source.
- ✅ Comptabilité d'engagement (BC → classe 8).
- ✅ Contrôle budgétaire bloquant avant soumission DA.
- ✅ Piste d'audit immuable, hash chain SHA-256.
- ❌ Pas de `prisma migrate dev` — DDL-first uniquement.
- ❌ Pas d'écriture dans les colonnes `GENERATED`.
- ❌ Pas de secret en clair, jamais.

## Style de code

- TypeScript strict, `any` interdit.
- ESLint + Prettier configurés à la racine.
- Tests Jest pour les services, Supertest pour les controllers, Playwright pour le E2E.
- Convention de nommage : `camelCase` (variables), `PascalCase` (types/classes), `kebab-case` (fichiers), `snake_case` (colonnes SQL).

## Travailler avec Claude Code / Cowork

- Avant de prompter, vérifier que `CLAUDE.md` est ouvert dans l'IDE (Antigravity le lit automatiquement).
- Prompts atomiques : une feature par prompt (voir [`ANTIGRAVITY_PROMPTS.md`](./ANTIGRAVITY_PROMPTS.md)).
- En cas de doute métier, consulter Cowork (Claude) plutôt que laisser l'agent inventer.
- Toujours relire le code généré avant de commiter.

## Signaler un bug

Utiliser l'issue template **🐛 Bug report**. Inclure : version Docker, sortie de `docker compose ps`, logs Prisma, capture si UI.

## Proposer une fonctionnalité

Utiliser l'issue template **🎯 Tâche de sprint** et l'assigner au bon sprint dans le Project Board.

## Sécurité

Si vous découvrez une vulnérabilité, **ne pas ouvrir d'issue publique**. Contacter directement le mainteneur : `eniang68@gmail.com`.

---

Merci de respecter ces conventions — elles font partie intégrante de l'évaluation du mémoire MIAGE et de la viabilité du projet pour l'IPD.

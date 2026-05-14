# 🐙 Configuration GitHub pour GRANTFLOW IPD

Guide complet pour mettre en place le dépôt GitHub du projet, dans une logique professionnelle adaptée à un mémoire MIAGE consultable par jury et encadrant.

---

## 1. Création du dépôt GitHub

### 1.1. Compte GitHub

Si vous n'avez pas encore de compte : https://github.com/signup
- Utilisez votre adresse `eniang68@gmail.com` (ou un mail pro étudiant).
- **Activez la 2FA** dans Settings → Password & Authentication (TOTP via Google Authenticator par exemple). Obligatoire pour la sécurité d'un projet qui contiendra des références financières.

### 1.2. Créer le dépôt **PRIVÉ**

1. https://github.com/new
2. Renseignez :
   - **Repository name** : `grantflow-ipd` (kebab-case, lowercase)
   - **Description** : `Plateforme d'automatisation Procure-to-Account et de comptabilité analytique multi-bailleurs — Institut Pasteur de Dakar (mémoire MIAGE)`
   - **Visibility** : ✅ **Private** (pendant le stage)
   - **NE COCHEZ PAS** « Add a README », « Add .gitignore », « Choose a license » — votre repo local en contient déjà.
3. Cliquez **Create repository**.

GitHub vous affiche alors les commandes pour pousser depuis votre local. Ne les exécutez pas encore, suivez les étapes ci-dessous.

### 1.3. Inviter votre encadrant et le maître de stage (plus tard)

Settings → Collaborators → Add people. Donnez-leur le rôle **Read** au début (passage en Write seulement s'ils contribuent).

---

## 2. Initialisation Git locale

Depuis la racine du projet (`grantflow-ipd-skeleton/`) :

```bash
# Configurer une fois votre identité Git (si pas déjà fait)
git config --global user.name "El Hadj Amadou NIANG"
git config --global user.email "eniang68@gmail.com"
git config --global init.defaultBranch main
git config --global pull.rebase false

# Initialiser le dépôt
git init
git add .
git commit -m "chore: initial commit — squelette du projet GRANTFLOW IPD"

# Lier au repo distant (remplacer par votre URL GitHub)
git remote add origin git@github.com:<votre-username>/grantflow-ipd.git
# OU en HTTPS si vous n'avez pas configuré SSH :
# git remote add origin https://github.com/<votre-username>/grantflow-ipd.git

git branch -M main
git push -u origin main
```

### 2.1. Configurer SSH (recommandé)

Pour ne pas saisir votre mot de passe à chaque push :

```bash
ssh-keygen -t ed25519 -C "eniang68@gmail.com"
# Appuyer sur Entrée pour le path par défaut, choisir une passphrase
cat ~/.ssh/id_ed25519.pub
# Copier le contenu
```

Puis sur GitHub : Settings → SSH and GPG keys → New SSH key → coller.

Test :

```bash
ssh -T git@github.com
# Doit afficher : "Hi <username>! You've successfully authenticated..."
```

---

## 3. Stratégie de branches

Le projet utilise un workflow **simplifié GitHub Flow + sprint branches** :

```text
main             ●─────────●─────────●─────────●─────●       (production, toujours stable)
                 │ merge   │ merge   │ merge   │
sprint-0        ●─●─●─●    │         │
sprint-1                ●─●─●─●─●    │
sprint-2                            ●─●─●─●─●
feat/auth-jwt                          ●─●─●  (branche fonctionnalité)
hotfix/login-bug                                    ●─●
```

### Règles

| Type de branche | Préfixe | Cas d'usage | Mergée dans |
|---|---|---|---|
| Sprint | `sprint-N` | Tronc de sprint, ouverte 2 semaines | `main` (1 PR par sprint) |
| Fonctionnalité | `feat/...` | Une feature précise | la branche sprint en cours |
| Correction | `fix/...` | Bug non urgent | la branche sprint en cours |
| Hotfix | `hotfix/...` | Bug critique en prod | `main` direct + back-merge dans sprint |
| Chore | `chore/...` | Tooling, dépendances | sprint courant |
| Doc | `docs/...` | Documentation pure | sprint courant ou `main` direct |
| Mémoire | `memoire/...` | Rédaction du mémoire | `main` |

### Commandes courantes

```bash
# Démarrer un nouveau sprint
git checkout main
git pull
git checkout -b sprint-1
git push -u origin sprint-1

# Démarrer une feature DANS un sprint
git checkout sprint-1
git pull
git checkout -b feat/donor-crud

# Terminer la feature → PR vers la branche sprint
git push -u origin feat/donor-crud
# Ouvrir une PR sur GitHub : feat/donor-crud → sprint-1

# À la fin du sprint, ouvrir une PR sprint-1 → main
```

---

## 4. Conventions de commits

Le projet utilise [Conventional Commits](https://www.conventionalcommits.org/fr/) :

```text
<type>(<scope>): <description courte>

[corps optionnel — pourquoi, pas comment]

[footer optionnel — refs issues, breaking changes]
```

### Types autorisés

| Type | Quand l'utiliser |
|---|---|
| `feat` | Nouvelle fonctionnalité (côté utilisateur) |
| `fix` | Correction de bug |
| `docs` | Documentation pure |
| `style` | Formatage, point-virgule, espaces (pas de logique) |
| `refactor` | Réorganisation du code sans changer le comportement |
| `perf` | Amélioration de performance |
| `test` | Ajout / modification de tests |
| `chore` | Outillage, dépendances, config |
| `ci` | Pipeline GitHub Actions |
| `revert` | Annulation d'un commit |

### Scopes typiques GRANTFLOW

`auth`, `procurement`, `ap`, `gl`, `co`, `reporting`, `treasury`, `referential`, `web`, `api`, `shared`, `docker`, `prisma`, `seed`, `deps`.

### Exemples corrects

```text
feat(procurement): add purchase request approval workflow
fix(ap): correct 3-way matching when invoice has no PO reference
docs(github): document branch strategy and commit conventions
chore(deps): bump @nestjs/core to 10.3.5
test(gl): cover journal entry balance constraint violation
refactor(shared): extract Currency enum from CreatePurchaseRequestDto
ci: add typecheck step to pull request workflow

feat(co): support overhead rate by donor
BREAKING CHANGE: GrantAgreement.overheadRate moves from app code to convention table
```

### À éviter

```text
❌ Update files
❌ fix
❌ wip
❌ amadou commit
❌ ouf ça marche
```

---

## 5. Templates et fichiers GitHub

Votre repo inclut déjà les fichiers suivants (présents dans `.github/`) :

| Fichier | Rôle |
|---|---|
| `.github/workflows/ci.yml` | Pipeline CI (lint + typecheck + tests) |
| `.github/pull_request_template.md` | Template auto-rempli à chaque PR |
| `.github/ISSUE_TEMPLATE/sprint-task.yml` | Issue de tâche de sprint |
| `.github/ISSUE_TEMPLATE/bug-report.yml` | Issue de bug |
| `.github/ISSUE_TEMPLATE/config.yml` | Désactive les issues vierges |
| `.github/CODEOWNERS` | Désigne le propriétaire par défaut |
| `CONTRIBUTING.md` | Guide rapide pour contribuer |

Aucune action de votre part — ces fichiers prendront effet automatiquement au prochain push.

---

## 6. Secrets et variables sensibles

### 6.1. Ne JAMAIS commiter `.env`

Le fichier `.gitignore` du projet exclut déjà `.env`, `.env.local`, etc. Vérifiez :

```bash
git status   # .env ne doit jamais apparaître
```

Si vous l'avez accidentellement ajouté :

```bash
git rm --cached .env
echo ".env" >> .gitignore
git add .gitignore
git commit -m "chore: exclude .env from versioning"
```

### 6.2. Configurer les secrets GitHub Actions

Settings → Secrets and variables → Actions → New repository secret. Ajoutez :

| Secret | Valeur |
|---|---|
| `MISTRAL_API_KEY` | (vide pour l'instant — quand vous aurez la clé) |
| `KEYCLOAK_CLIENT_SECRET` | À ne renseigner qu'en environnement de prod |
| `DOCKER_HUB_TOKEN` | Optionnel si vous publiez des images |

Les workflows GitHub Actions y accéderont via `${{ secrets.MISTRAL_API_KEY }}`.

### 6.3. Activer Dependabot (gratuit)

Settings → Security → Code security and analysis → activez :
- **Dependabot alerts** (alertes sur vulnérabilités des dépendances)
- **Dependabot security updates** (PRs auto pour corriger)
- **Secret scanning** (détection accidentelle de secrets dans le code)

---

## 7. Protection de la branche `main`

Essentiel pour éviter qu'un push direct ne casse la branche stable.

Settings → Branches → Add branch protection rule :

- **Branch name pattern** : `main`
- ✅ Require a pull request before merging
  - ✅ Require approvals : 1 (vous-même au début, votre encadrant plus tard)
- ✅ Require status checks to pass before merging
  - Cocher `ci / lint-typecheck-test` (apparaîtra après votre 1er run CI)
- ✅ Require linear history (pas de merge commits, rebase uniquement)
- ✅ Do not allow bypassing the above settings
- ❌ Allow force pushes (laisser décoché)

Cliquez **Create**.

---

## 8. GitHub Projects (suivi des sprints)

### 8.1. Créer le project

1. Onglet **Projects** de votre dépôt → New project → **Board** (kanban)
2. Nom : `GRANTFLOW Sprints`
3. Visibility : Private

### 8.2. Colonnes recommandées

| Colonne | Rôle |
|---|---|
| 📋 Backlog | Tâches non encore planifiées |
| 🎯 Sprint en cours | Tâches du sprint actif |
| 🚧 En cours | Tâche actuellement travaillée |
| 🔍 Revue | PR ouverte en attente de revue |
| ✅ Terminé | Mergé dans la branche sprint |

### 8.3. Custom fields à ajouter

- **Sprint** : Single select → `Sprint 0`, `Sprint 1`, ..., `Sprint 6`
- **Module** : Single select → `M1 Référentiels`, `M2 DA`, ..., `M9 Reporting`
- **Story points** : Number (1, 2, 3, 5, 8, 13)
- **Type** : Single select → `Feature`, `Bug`, `Tech`, `Doc`, `Mémoire`

### 8.4. Automation utile

Project settings → Workflows → activez :
- « Item added to project → status Backlog »
- « PR linked to issue → status Revue »
- « Closed → status Terminé »

### 8.5. Créer les issues du Sprint 0 maintenant

Une fois le projet créé, créez les 4 issues du Sprint 0 :

| Titre | Type | SP |
|---|---|---|
| [Sprint 0] Schéma Prisma + seed depuis fixtures JSON | Feature | 5 |
| [Sprint 0] Docker Compose dev + Keycloak realm | Tech | 3 |
| [Sprint 0] Authentification Keycloak + RBAC + audit log | Feature | 8 |
| [Sprint 0] Documentation initiale (Setup Windows, Cowork) | Doc | 2 |

Pour chaque issue, utilisez le template **Sprint Task** qui s'auto-remplit avec les critères d'acceptation. Vous pouvez cocher la 1re et la 2e (déjà faites) et fermer la PR correspondante.

---

## 9. Workflow type d'une fonctionnalité

Exemple : implémenter le module Donor (Sprint 1).

```bash
# 1. Synchroniser
git checkout sprint-1
git pull

# 2. Créer la branche feature
git checkout -b feat/donor-crud

# 3. Coder, tester, lint
npm run lint
npm run typecheck
npm run test

# 4. Commits atomiques avec messages conventionnels
git add apps/api/src/referential/donor
git commit -m "feat(referential): add Donor CRUD endpoints and service"

git add apps/api/test/donor
git commit -m "test(referential): cover Donor service with mock Prisma"

git add docs/api/donors.md
git commit -m "docs(referential): document Donor endpoints"

# 5. Pousser et ouvrir une PR vers sprint-1
git push -u origin feat/donor-crud
# → GitHub propose un lien « Compare & pull request »

# 6. Sur GitHub : ouvrir la PR
#    - Le template se remplit automatiquement
#    - Lier à l'issue : "Closes #12"
#    - Attendre que la CI passe (lint+typecheck+test verts)
#    - S'auto-approuver (au début) puis merger

# 7. Récupérer en local et nettoyer
git checkout sprint-1
git pull
git branch -d feat/donor-crud
```

---

## 10. Releases et tags (à la fin du sprint pilote)

Quand vous aurez un pilote fonctionnel :

```bash
git checkout main
git tag -a v0.1.0-pilot -m "GRANTFLOW IPD — Pilote interne IPD"
git push origin v0.1.0-pilot
```

GitHub → Releases → Draft a new release → choisir le tag → décrire les modules livrés.

Convention de versioning :
- `v0.1.0-sprint-0` à `v0.6.0-sprint-6` : versions de sprint
- `v0.x.0-pilot` : pilote IPD
- `v1.0.0-memoire` : version au moment du dépôt du mémoire
- `v1.0.0` : production validée

---

## 11. Hygiène du repo

À faire de temps en temps :

```bash
# Nettoyer les branches mergées
git branch --merged | grep -v "main\|sprint-" | xargs -n 1 git branch -d
git remote prune origin

# Mettre à jour les dépendances (laissez Dependabot s'en occuper sur GitHub)
npm outdated

# Vérifier la taille du repo
git count-objects -vH
```

---

## 12. Sécurité supplémentaire (optionnel mais recommandé)

### 12.1. Signed commits

Pour authentifier vos commits avec une clé GPG ou SSH :

```bash
# Avec SSH (le plus simple si déjà configuré)
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
```

Puis sur GitHub : Settings → SSH and GPG keys → New SSH key → cochez **Signing key** lors de l'ajout.

### 12.2. CODEOWNERS

Le fichier `.github/CODEOWNERS` désigne par défaut le mainteneur de chaque dossier. Une PR touchant ces fichiers requerra automatiquement leur revue. Voir le fichier dans le repo pour personnalisation.

---

## 13. Mémoire : capitaliser sur votre repo GitHub

Pour valoriser votre dépôt dans le mémoire et la soutenance :

- **README.md soigné** (déjà présent) — la première impression.
- **Captures du Project Board** dans la partie « gestion de projet ».
- **Statistiques GitHub** (Insights → Pulse, Contributors) — preuves d'activité régulière.
- **Lien vers le repo** dans le mémoire (avec accès en lecture pour le jury).
- **Tags annotés** sur les jalons importants (`v0.1.0-pilot`, etc.).
- **Issues fermées** comme journal de bord du projet.

---

_Si vous bloquez sur une étape, partagez la sortie de la commande dans Cowork — je vous débloque._

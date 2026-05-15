# 🪟 Installation de l'environnement de développement sur Windows 11

Ce guide pas-à-pas vous permet de monter l'infra locale de GRANTFLOW IPD sur **Windows 11** en moins d'une heure.

## 1. Installer WSL2 (recommandé)

Docker Desktop fonctionne mieux avec WSL2 (Windows Subsystem for Linux 2). Dans une **PowerShell admin** :

```powershell
wsl --install -d Ubuntu
```

Redémarrez la machine. À la fin du redémarrage, Ubuntu se lance et vous demande de créer un utilisateur/mot de passe Linux. Ce sera votre environnement bash recommandé pour les commandes du projet.

## 2. Installer Docker Desktop

1. Téléchargez Docker Desktop : https://www.docker.com/products/docker-desktop/
2. Lancez l'installateur (laissez l'option « Use WSL 2 instead of Hyper-V » cochée).
3. Redémarrez si demandé.
4. Au premier lancement, dans **Settings → Resources → WSL Integration**, activez l'intégration avec votre distribution Ubuntu.

Vérification :

```bash
docker --version              # → Docker version 27.x
docker compose version        # → Docker Compose version v2.x
docker run --rm hello-world   # → Hello from Docker!
```

## 3. Installer Node.js 22 LTS

Le plus simple : depuis https://nodejs.org/, choisir la version LTS (22.x).

Vérification :

```bash
node --version    # → v22.x.x
npm --version     # → 10.x ou 11.x
```

## 4. (Optionnel) Installer psql en local

`psql` n'est pas indispensable puisqu'on peut exécuter les commandes via le conteneur Postgres. Mais si vous voulez les avoir sur votre machine :

- Téléchargez les "Command Line Tools" depuis https://www.postgresql.org/download/windows/
- Ou via `winget` : `winget install PostgreSQL.PostgreSQL`

Sans psql local, l'init DDL se fait via :

```bash
docker compose exec -T postgres psql -U grantflow -d grantflow_dev < docs/grantflow_ddl_postgresql.sql
```

## 5. Cloner et installer le projet

Dans votre dossier de travail :

```bash
git clone <url-du-repo> grantflow-ipd
cd grantflow-ipd
cp .env.example .env
npm install
```

## 6. Lancer la stack

```bash
# 1) Démarrer l'infra
docker compose up -d

# 2) Attendre 30 secondes que Postgres et Keycloak finissent leur init
docker compose ps
# → Tous les services doivent être "Up" ou "healthy"

# 3) Charger le DDL (source de vérité)
docker compose exec -T postgres \
  psql -U grantflow -d grantflow_dev < docs/grantflow_ddl_postgresql.sql

# 4) Générer le client Prisma et lancer le seed
cd apps/api
npm run prisma:generate
npm run prisma:seed
cd ..

# 5) Démarrer l'API et le front (deux terminaux séparés)
npm run dev:api    # → http://localhost:4000/api/v1
npm run dev:web    # → http://localhost:3000
```

## 7. Vérification automatique

Lancez le script de validation pour confirmer que tout est en ordre :

```bash
bash scripts/validate-stack.sh
```

Vous devriez voir : `✅ Tous les contrôles ont passé (14/14).`

## 8. Comptes par défaut (Keycloak)

| Rôle | E-mail | Mot de passe |
|---|---|---|
| Super admin | admin@pasteur.sn | Admin#2026 |
| DAF | daf@pasteur.sn | Daf#2026 |
| Comptable | compta@pasteur.sn | Compta#2026 |
| Trésorier | tres@pasteur.sn | Tres#2026 |
| PI | pi@pasteur.sn | Pi#2026 |
| Demandeur (vous) | amadou@pasteur.sn | Demandeur#2026 |

Admin Keycloak : http://localhost:8080 — login `admin` / mdp `admin`.

## 9. Pièges classiques sur Windows

| Symptôme | Cause probable | Solution |
|---|---|---|
| `bash: docker: command not found` | Docker Desktop pas démarré ou WSL non configuré | Démarrer Docker Desktop, vérifier l'intégration WSL |
| Postgres redémarre en boucle | Le volume `apps/api/prisma/init/` est introuvable | Vérifier que le fichier `apps/api/prisma/init/.gitkeep` existe |
| Keycloak ne charge pas le realm | Mauvais nom de fichier ou JSON invalide | Vérifier `docker compose logs keycloak` |
| Port 5432 déjà utilisé | Un Postgres local tourne déjà | **Le projet utilise déjà 5433 côté host pour éviter ce conflit** — voir le bloc "Postgres natif Windows" ci-dessous |
| Lenteur extrême sur certaines opérations | Antivirus qui scanne node_modules | Exclure le dossier projet de l'analyse temps réel |

### Postgres natif Windows — conflit de port

**Symptôme** : Prisma renvoie au seed `Authentication failed against database server at localhost, the provided database credentials for (not available) are not valid` alors que `docker compose exec postgres psql ...` fonctionne.

**Cause** : un PostgreSQL natif Windows (typiquement `postgresql-x64-18`) écoute sur `0.0.0.0:5432` et capte les connexions du host avant que Docker n'y arrive. Le rejet d'auth vient du Postgres natif, pas de Docker.

**Solution déjà appliquée dans ce repo** :
- `docker-compose.yml` mappe le conteneur sur le port host `5433` (ligne `5433:5432`)
- `.env.example` et donc le `.env` cible `postgresql://...:5433/...`
- Les connexions intra-conteneur (autres services Docker, healthchecks, `docker compose exec psql`) restent sur le port standard `5432` interne

**Vérifier qui occupe `5432` sur ton host** (PowerShell) :

```powershell
Get-NetTCPConnection -LocalPort 5432 -State Listen |
  Select-Object LocalAddress,OwningProcess
Get-Process -Id <PID> | Select-Object Id,ProcessName,Path
```

Si tu veux que ton Postgres natif libère le port (optionnel — pas nécessaire grâce au remap 5433) :

```powershell
Stop-Service -Name postgresql-x64-18
# Ou désactiver le démarrage automatique :
Set-Service -Name postgresql-x64-18 -StartupType Manual
```

## 10. Arrêt et nettoyage

```bash
docker compose down              # Arrête tous les services (volumes conservés)
docker compose down -v           # Arrête ET supprime les volumes (reset complet)
```

---

_Si vous bloquez, partagez la sortie de `docker compose ps` et `docker compose logs <service>` dans Cowork pour aide._

# Keycloak — Setup du client `grantflow-web` (sprint F1)

> Le realm `grantflow` est créé au démarrage du conteneur via
> `docker/keycloak/realm.json`. Ce document décrit la création du
> **client public Next.js** consommé par `apps/web` (next-auth v5).

## 1. Prérequis

- Docker Compose up : `docker compose up -d keycloak` (port 8080).
- Realm `grantflow` chargé avec ses utilisateurs seeds (admin, daf, …).
- Variables d'env côté front (`apps/web/.env.local`) :
  ```env
  NEXTAUTH_URL=http://localhost:3000
  NEXTAUTH_SECRET=<openssl rand -base64 32>
  KEYCLOAK_ID=grantflow-web
  KEYCLOAK_SECRET=<récupéré à l'étape 3>
  KEYCLOAK_ISSUER=http://localhost:8080/realms/grantflow
  ```

## 2. Création via Admin Console (manuel)

1. Connectez-vous à `http://localhost:8080` (admin / admin).
2. Sélectionnez le realm **`grantflow`** (top-left dropdown).
3. **Clients** → **Create client** :
   - Client type : **OpenID Connect**
   - Client ID : `grantflow-web`
   - Name : `GRANTFLOW Web (Next.js)`
   - Next →
4. **Capability config** :
   - Client authentication : **ON** (= confidential, secret requis)
   - Authentication flow : **Standard flow** (PKCE inclus par défaut)
   - Direct access grants : **ON** (utile en debug curl & tests E2E)
   - Service account roles : **OFF**
   - Next →
5. **Login settings** :
   - Root URL : `http://localhost:3000`
   - Home URL : `http://localhost:3000`
   - **Valid redirect URIs** : `http://localhost:3000/api/auth/callback/keycloak`
   - **Valid post logout redirect URIs** : `http://localhost:3000/login`
   - **Web origins** : `http://localhost:3000` (ou `+` pour autoriser tous les Root URLs)
   - Save.
6. Onglet **Credentials** : copier la valeur de **Client secret** et
   la coller dans `KEYCLOAK_SECRET` de `apps/web/.env.local`.
7. Onglet **Client scopes** → vérifier que `roles` est bien dans les
   default scopes (sinon `realm_access.roles` ne sera pas inclus dans
   le token et `session.roles` sera vide côté front).

## 3. Création scriptée (kcadm.sh)

Si vous voulez reproduire ces étapes sans cliquer (CI, onboarding) :

```bash
# Dans le conteneur Keycloak :
docker exec -it grantflow-keycloak bash

# Auth admin
/opt/keycloak/bin/kcadm.sh config credentials \
  --server http://localhost:8080 \
  --realm master \
  --user admin --password admin

# Création du client
/opt/keycloak/bin/kcadm.sh create clients -r grantflow \
  -s clientId=grantflow-web \
  -s name='GRANTFLOW Web (Next.js)' \
  -s 'redirectUris=["http://localhost:3000/api/auth/callback/keycloak"]' \
  -s 'webOrigins=["http://localhost:3000"]' \
  -s 'attributes={"post.logout.redirect.uris":"http://localhost:3000/login"}' \
  -s publicClient=false \
  -s standardFlowEnabled=true \
  -s directAccessGrantsEnabled=true

# Récupérer l'UUID du client puis son secret
CLIENT_UUID=$(/opt/keycloak/bin/kcadm.sh get clients -r grantflow \
  -q clientId=grantflow-web --fields id --format csv --noquotes | tail -1)
/opt/keycloak/bin/kcadm.sh get clients/$CLIENT_UUID/client-secret -r grantflow \
  --fields value --format csv --noquotes
```

> Le secret affiché est à recopier dans `KEYCLOAK_SECRET`.

## 4. Test manuel

```bash
# Démarrer le front
cd apps/web && npm run dev

# Ouvrir http://localhost:3000
# → redirection vers /login
# → cliquer "Se connecter avec Keycloak"
# → écran Keycloak (login form)
# → saisir admin@pasteur.sn / Admin#2026
# → retour sur /dashboard avec le nom dans le header
```

## 5. Test E2E Playwright

```bash
# Avec stack complète (Keycloak + API) :
STACK_UP=1 npx playwright test --workspace=apps/web

# Personnaliser les credentials :
STACK_UP=1 KC_USER=daf@pasteur.sn KC_PASS=Daf#2026-IPD npx playwright test
```

## 6. Dépannage

### 6.1. Diagnostic automatique (recommandé en premier)

```bash
./scripts/check-keycloak-client.sh
```

Vérifie en 6 étapes : OIDC discovery, token admin, config client, secret,
direct grant login, et présence du provider côté Next.js. Renvoie 1 si
au moins un check est KO + indique la commande de fix.

### 6.2. Récupérer le secret après régénération

Quand vous cliquez **Regenerate** dans Admin Console (Clients →
grantflow-web → Credentials), l'ancien secret est invalidé immédiatement.
Sans nouvelle copie dans `.env.local`, le login renverra `unauthorized_client`.

```bash
# Via kcadm.sh (sans Admin Console)
docker exec -it grantflow-keycloak /opt/keycloak/bin/kcadm.sh \
  config credentials --server http://localhost:8080 \
  --realm master --user admin --password admin

CLIENT_UUID=$(docker exec grantflow-keycloak /opt/keycloak/bin/kcadm.sh \
  get clients -r grantflow -q clientId=grantflow-web \
  --fields id --format csv --noquotes | tail -1)

# Lecture du secret actuel (sans régénérer)
docker exec grantflow-keycloak /opt/keycloak/bin/kcadm.sh \
  get clients/$CLIENT_UUID/client-secret -r grantflow \
  --fields value --format csv --noquotes

# Régénération (invalidate l'ancien)
docker exec grantflow-keycloak /opt/keycloak/bin/kcadm.sh \
  create clients/$CLIENT_UUID/client-secret -r grantflow
```

Puis MAJ `apps/web/.env.local` :

```env
KEYCLOAK_SECRET=<nouveau-secret-collé-ici>
```

**Important** : redémarrer `npm run dev` après modification de `.env.local`
(Next.js ne hot-reload pas les variables d'environnement).

Vérification : le log debug doit afficher le bon préfixe :

```
[next-auth][debug] KEYCLOAK_ID=grantflow-web, secret prefix=HYhz... (len=36), KEYCLOAK_ISSUER=http://localhost:8080/realms/grantflow
```

### 6.3. Forcer un set-password sur les 8 users seedés

Si les utilisateurs ont été créés avec `temporaryPassword=true` (ou si
vous avez oublié les credentials), forcez un reset propre :

```bash
docker exec -it grantflow-keycloak /opt/keycloak/bin/kcadm.sh \
  config credentials --server http://localhost:8080 \
  --realm master --user admin --password admin

# Liste des 8 utilisateurs seedés (cf. docker/keycloak/realm.json)
USERS="admin@pasteur.sn daf@pasteur.sn cg@pasteur.sn comptable@pasteur.sn \
       tres@pasteur.sn pi@pasteur.sn ach@pasteur.sn bailleur@pasteur.sn"

for U in $USERS; do
  docker exec grantflow-keycloak /opt/keycloak/bin/kcadm.sh \
    set-password -r grantflow --username "$U" \
    --new-password "Pasteur2026!" --temporary=false
  echo "OK $U"
done
```

(Ajustez le mot de passe selon votre convention — celui-ci aligne tous
les seeds sur `Pasteur2026!`.)

### 6.4. Troubleshooting par code d'erreur OAuth

| Symptôme | Cause probable | Fix |
|---|---|---|
| `unauthorized_client` (POST /token) | Client secret invalide OU `Client authentication=OFF` côté Keycloak | Vérifier `publicClient=false` + recopier le secret (cf. 6.2) |
| `invalid_client` | clientId incorrect dans `.env.local` | Vérifier `KEYCLOAK_ID=grantflow-web` |
| `invalid_grant` | username/password incorrect, ou temporary password | Cf. 6.3 — forcer set-password |
| `invalid_redirect_uri` (sur Keycloak) | Callback URL pas whitelistée côté client | Ajouter exactement `http://localhost:3000/api/auth/callback/keycloak` (pas de slash final) dans Valid redirect URIs |
| `Configuration` côté NextAuth | Issuer inaccessible ou OIDC discovery KO | `curl http://localhost:8080/realms/grantflow/.well-known/openid-configuration` doit retourner du JSON |
| `session.roles` vide | Client scope `roles` désactivé OU claim filtré côté front | Vérifier que `realm_access.roles` apparaît dans le userinfo : `curl -H "Authorization: Bearer $TOKEN" $ISSUER/protocol/openid-connect/userinfo` |
| 502 sur `/api/auth/session` | `NEXTAUTH_SECRET` absent | `openssl rand -base64 32 > .env.local` |
| Logout reste sur `/api/auth/signin` | Post logout redirect URI non whitelistée | Ajouter `http://localhost:3000/login` dans Valid post logout redirect URIs |
| Debug log absent au démarrage Next.js | `NODE_ENV=production` ou variables non chargées | Vérifier `.env.local` présent + redémarrer `npm run dev` |
| Login OK mais boucle vers /login | Le rewrite `/api/*` interceptait `/api/auth/*` | Vérifier que `next.config.js` n'a PAS de rewrite sur `/api/:path*` (corrigé F1.1) |

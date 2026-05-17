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

| Symptôme | Cause probable | Fix |
|---|---|---|
| Redirect URI mismatch | URL de callback non whitelistée | Ajouter `http://localhost:3000/api/auth/callback/keycloak` dans Valid redirect URIs |
| `session.roles` vide | Client scope `roles` désactivé ou claim filtré | Activer le scope `roles` + vérifier que `realm_access.roles` apparaît dans `/realms/grantflow/protocol/openid-connect/userinfo` |
| 502 sur `/api/auth/session` | NEXTAUTH_SECRET absent | Générer un secret et l'ajouter dans `.env.local` |
| `Cannot read property 'access_token'` côté front | KEYCLOAK_SECRET incorrect | Recopier depuis Credentials → Regenerate si besoin |
| Logout reste sur `/api/auth/signin` | Post logout redirect URI non whitelistée | Ajouter `http://localhost:3000/login` |

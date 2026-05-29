# Déploiement Vercel — GRANTFLOW IPD (Frontend Next.js)

> Vercel héberge **uniquement le frontend Next.js** (`apps/web`). L'API
> NestJS et Keycloak sont sur Render (cf. [render.md](./render.md)).
> Pour l'ordre global d'exécution, voir [00-runbook.md](./00-runbook.md).

## 1. Import du projet (déjà fait)

L'utilisateur a déjà importé le repo dans Vercel avec :
- **Root Directory** : `apps/web`
- **Framework Preset** : Next.js (auto-détecté)
- **Build Command** : par défaut (`npm run build`)
- **Install Command** : par défaut (`npm install` → Vercel détecte
  les workspaces)
- **Output Directory** : par défaut (`.next`)

Le premier build a échoué — c'est attendu : aucune variable d'env n'est
encore renseignée et l'app référence `NEXT_PUBLIC_API_URL`, `KEYCLOAK_*`,
`NEXTAUTH_*` au build.

## 2. Variables d'environnement

Dashboard Vercel → projet `grantflow-ipd` → **Settings → Environment Variables**.

Coller pour **Production** ET **Preview** (pour que les PR previews
fonctionnent aussi) :

| Variable | Valeur | Source |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `https://<URL Render api>/api/v1` | Render dashboard → service `grantflow-api` → URL publique, suffixée `/api/v1` |
| `NEXTAUTH_URL` | `https://<URL Vercel>` (ex. `https://grantflow-ipd.vercel.app`) | Visible dans le dashboard Vercel après le 1er déploiement |
| `NEXTAUTH_SECRET` | Le secret que tu as généré localement (`openssl rand -base64 32`) | Générateur local — **ne le copie pas dans le repo** |
| `KEYCLOAK_ID` | `grantflow-web` | Constante |
| `KEYCLOAK_SECRET` | **Vide** | Le client `grantflow-web` est `publicClient: true` dans le realm.json — pas de secret |
| `KEYCLOAK_ISSUER` | `https://<URL Render keycloak>/realms/grantflow` | URL Render Keycloak + suffixe `/realms/grantflow` |
| `KEYCLOAK_FORCE_LOGIN_PROMPT` | `true` | Démo : force l'écran login Keycloak à chaque `/api/auth/signin` (utile pour les tests multi-profils jury) |

> ⚠️ Poule-œuf : `NEXTAUTH_URL` requiert l'URL Vercel, qui n'est connue
> qu'après le 1er déploiement. Soluce : déployer une 1ère fois avec
> `NEXTAUTH_URL` placeholder (ex. `https://placeholder.vercel.app`), noter
> l'URL réelle, l'écrire dans la var, redéployer.

## 3. `next.config.js` — vérifier `output: 'standalone'`

Le repo livre déjà `apps/web/next.config.js` avec
`output: 'standalone'` (cf. sprint F-DEPLOY-CLOUD Lot A). Vercel ignore
cette option (leur pipeline a son propre packager), donc aucun impact.
Présente pour le Dockerfile web optionnel (phase 2 IPD).

## 4. Redéployer

Après avoir collé toutes les vars :
1. Vercel dashboard → projet → **Deployments** → triple dots sur le
   dernier déploiement → **Redeploy** → cocher "Use existing Build Cache"
   (plus rapide).
2. Surveiller les logs jusqu'au `Compiled successfully`.
3. Visiter `https://<URL Vercel>` — la page d'accueil doit s'afficher
   (login Keycloak attendu si on tente d'accéder à `/dashboard`).

## 5. Mettre à jour Keycloak avec l'URL Vercel

Une fois l'URL Vercel connue, retourner sur **Keycloak admin** et ajouter
cette URL dans :

- `grantflow-web` → Settings → **Valid redirect URIs** : `https://<URL Vercel>/*`
- `grantflow-web` → Settings → **Valid post logout redirect URIs** : `https://<URL Vercel>/*`
- `grantflow-web` → Settings → **Web Origins** : `https://<URL Vercel>`

(Cf. [render.md](./render.md) §6 — c'est la même procédure.)

## 6. Smoke test final

1. Aller sur `https://<URL Vercel>/login`.
2. Cliquer "Se connecter avec Keycloak" → redirection sur l'URL Keycloak.
3. S'authentifier avec un compte de seed (cf. `seed/users.json`).
4. Retour sur `https://<URL Vercel>/dashboard` — voir les KPIs réels
   (chargés depuis l'API Render).

## 7. Limitations Vercel free tier connues

| Limite | Impact | Workaround |
|---|---|---|
| 100 GB-h bandwidth/mois | Largement suffisant pour une démo | — |
| Pas de cold start (vs Render free) | OK | — |
| 1 environnement de production + N previews | Suffisant | — |
| Pas de domaine custom HTTPS gratuit | URL `.vercel.app` uniquement | Acceptable pour démo jury |

Pour la phase 2 (serveur IPD avec domaine custom), voir
[migration-to-ipd-cloud.md](./migration-to-ipd-cloud.md).

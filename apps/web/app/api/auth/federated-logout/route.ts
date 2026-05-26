import { NextResponse } from 'next/server';
import { auth, signOut } from '@/lib/auth';

/**
 * Route handler GET `/api/auth/federated-logout` — RP-Initiated Logout
 * OIDC complet : tue à la fois la session applicative (next-auth) ET la
 * session SSO côté Keycloak.
 *
 * Sans ce flux, `signOut()` next-auth ne fait qu'effacer le cookie de
 * session de l'app — la session Keycloak reste active, et le prochain
 * /api/auth/signin ré-authentifie silencieusement le même utilisateur
 * (SSO transparent). Pour les tests multi-profils, ce n'est pas le
 * comportement voulu : on veut que le login suivant REDEMANDE
 * identifiants + mot de passe.
 *
 * Flux :
 *  1. `auth()` lit la session côté serveur pour récupérer l'`id_token`
 *     persisté dans le JWT (cf. callback jwt de lib/auth.ts).
 *  2. `signOut({ redirect: false })` purge le cookie next-auth — l'app
 *     n'est plus authentifiée côté Next.js dès cette étape.
 *  3. On construit l'URL Keycloak `end_session_endpoint` avec :
 *       - `id_token_hint` : prouve à Keycloak qu'on connaît la session
 *         à fermer → pas d'écran de confirmation, redirection silencieuse.
 *       - `post_logout_redirect_uri` : où Keycloak renvoie l'utilisateur
 *         après destruction de la session (= `/login` de l'app).
 *  4. 302 vers Keycloak. Keycloak détruit ses cookies SSO puis 302 vers
 *     `/login`. Le user voit l'écran de connexion.
 *
 * Cas dégradé : si `idToken` est absent de la session (ex. session
 * incomplète, restart du serveur), on saute `id_token_hint` — Keycloak
 * affichera son écran de confirmation. Le `client_id` reste passé pour
 * que Keycloak reconnaisse l'initiateur.
 *
 * Pré-requis Keycloak (cf. docker/keycloak/realm.json client
 * grantflow-web) : `post.logout.redirect.uris` autorise `/login`.
 */
export async function GET() {
  const session = await auth();
  const idToken = session?.idToken;

  // Origine canonique pour construire le redirect post-logout. NEXTAUTH_URL
  // gagne en prod / derrière proxy ; fallback localhost en dev.
  const appOrigin = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
  const postLogoutRedirect = `${appOrigin}/login`;

  // Issuer Keycloak — même valeur que celle utilisée par next-auth pour
  // le sign-in (DRY : un seul env var KEYCLOAK_ISSUER).
  const issuer =
    process.env.KEYCLOAK_ISSUER ?? 'http://localhost:8080/realms/grantflow';
  const clientId = process.env.KEYCLOAK_ID ?? 'grantflow-web';

  // Construit l'URL Keycloak end_session
  const params = new URLSearchParams();
  if (idToken) {
    // id_token_hint = redirection silencieuse + meilleure UX
    params.set('id_token_hint', idToken);
  } else {
    // Sans id_token, Keycloak peut afficher un écran de confirmation —
    // on lui donne au moins le client_id pour qu'il sache quelle session
    // fermer.
    params.set('client_id', clientId);
  }
  params.set('post_logout_redirect_uri', postLogoutRedirect);

  const endSessionUrl = `${issuer}/protocol/openid-connect/logout?${params.toString()}`;

  // 1) Purge la session next-auth (cookie HTTP-Only). `redirect: false`
  //    évite que signOut renvoie un Response 302 — on veut contrôler la
  //    redirection nous-mêmes vers Keycloak.
  await signOut({ redirect: false });

  // 2) 302 vers Keycloak end_session. Pas de cache (chaque logout
  //    construit un id_token_hint distinct).
  return NextResponse.redirect(endSessionUrl, {
    status: 302,
    headers: { 'Cache-Control': 'no-store' },
  });
}

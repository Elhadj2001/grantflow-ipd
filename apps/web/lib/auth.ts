import NextAuth, { type DefaultSession } from 'next-auth';
import Keycloak from 'next-auth/providers/keycloak';

/**
 * Configuration next-auth v5 — provider Keycloak OIDC.
 *
 * Le realm `grantflow` (cf. docker/keycloak/) doit héberger un client
 * `grantflow-web` avec :
 *   - public/confidential = confidential (client secret requis)
 *   - access type = OpenID Connect
 *   - valid redirect URI = http://localhost:3000/api/auth/callback/keycloak
 *   - web origins = http://localhost:3000
 *
 * Voir docs/keycloak-setup.md pour le setup manuel et le script
 * `docker/keycloak/setup-web-client.sh` (à exécuter avec kcadm.sh).
 *
 * On stocke l'`access_token` Keycloak dans le JWT next-auth pour
 * pouvoir le réutiliser comme Bearer auprès de l'API NestJS
 * (`apps/api` valide ce même token via JwtBridge).
 *
 * Les rôles sont extraits du claim `realm_access.roles` (convention
 * Keycloak) puis filtrés sur les rôles connus de GRANTFLOW (cf.
 * apps/api/src/auth/types/roles.ts).
 */

export interface KeycloakProfile {
  sub: string;
  email?: string;
  preferred_username?: string;
  given_name?: string;
  family_name?: string;
  name?: string;
  realm_access?: { roles?: string[] };
  resource_access?: Record<string, { roles?: string[] }>;
}

/**
 * Liste fermée des rôles GRANTFLOW reconnus côté front. Garde-fou
 * contre des rôles techniques Keycloak (`offline_access`,
 * `uma_authorization`, etc.).
 */
const GRANTFLOW_ROLES = [
  'SUPER_ADMIN',
  'DAF',
  'CONTROLEUR',
  'COMPTABLE',
  'TRESORIER',
  'ACHETEUR',
  'MAGASINIER',
  'PI',
  'DEMANDEUR',
  'BAILLEUR',
  'CAISSIER',
  // US-065 — Grant Office (Notes Techniques, ADR-006)
  'GO',
] as const;
export type GrantflowRole = (typeof GRANTFLOW_ROLES)[number];

function filterRoles(claims: string[] | undefined): GrantflowRole[] {
  if (!claims) return [];
  return claims.filter((r): r is GrantflowRole => (GRANTFLOW_ROLES as readonly string[]).includes(r));
}

/**
 * Décode la partie payload d'un JWT (sans vérifier la signature).
 * Sert UNIQUEMENT à extraire les rôles realm de l'access_token Keycloak
 * quand le mapper "realm roles" n'est pas activé "Add to ID token".
 * On ne fait pas confiance à cette donnée pour autorisation côté API —
 * c'est apps/api qui valide la signature via JwtBridge.
 */
function decodeJwtPayload(jwt: string | undefined): Record<string, unknown> | null {
  if (!jwt) return null;
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    const payload = Buffer.from(parts[1], 'base64url').toString('utf-8');
    return JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Extrait les rôles realm Keycloak en priorité depuis le profile
 * (id_token), avec fallback sur l'access_token décodé. Cette double
 * lecture rend la conf Keycloak résiliente : "Add to ID token" du mapper
 * realm roles peut être ON ou OFF, on récupère les rôles dans les deux cas.
 */
function extractRealmRoles(
  profile: KeycloakProfile | undefined,
  accessToken: string | undefined,
): string[] | undefined {
  // 1) id_token / userinfo via profile
  const fromProfile = profile?.realm_access?.roles;
  if (fromProfile && fromProfile.length > 0) return fromProfile;
  // 2) Fallback : decode payload access_token
  const payload = decodeJwtPayload(accessToken);
  if (!payload) return undefined;
  const realmAccess = payload['realm_access'] as { roles?: string[] } | undefined;
  return realmAccess?.roles;
}

const KEYCLOAK_ID = process.env.KEYCLOAK_ID ?? 'grantflow-web';
const KEYCLOAK_SECRET = process.env.KEYCLOAK_SECRET ?? '';
const KEYCLOAK_ISSUER = process.env.KEYCLOAK_ISSUER ?? 'http://localhost:8080/realms/grantflow';
/**
 * Sprint F-LOGOUT — si `KEYCLOAK_FORCE_LOGIN_PROMPT=true`, on ajoute
 * `prompt=login` aux paramètres d'autorisation OIDC. Conséquence : Keycloak
 * AFFICHE TOUJOURS l'écran de saisie identifiants, même si une session SSO
 * résiduelle existe. Recommandé en DEV pour les tests multi-profils ; à
 * laisser à `false` (= SSO standard) en prod où le RP-Initiated Logout
 * suffit à fermer la session inter-onglets.
 */
const KEYCLOAK_FORCE_LOGIN_PROMPT = process.env.KEYCLOAK_FORCE_LOGIN_PROMPT === 'true';

// Sprint F1.1 — debug logs pour diagnostiquer les unauthorized_client.
// Imprimé une fois au démarrage du serveur Next.js (chaque appel handler
// recharge ce module). Préfixe les premiers 4 caractères du secret pour
// que l'utilisateur confirme que le secret en .env.local est bien celui
// renvoyé par Keycloak après régénération. JAMAIS en prod.
if (process.env.NODE_ENV !== 'production' && typeof window === 'undefined') {
  const secretPrefix = KEYCLOAK_SECRET ? KEYCLOAK_SECRET.slice(0, 4) : '(empty)';
  const secretLen = KEYCLOAK_SECRET.length;
  // eslint-disable-next-line no-console
  console.log(
    `[next-auth][debug] KEYCLOAK_ID=${KEYCLOAK_ID}, ` +
      `secret prefix=${secretPrefix}... (len=${secretLen}), ` +
      `KEYCLOAK_ISSUER=${KEYCLOAK_ISSUER}`,
  );
  if (!KEYCLOAK_SECRET) {
    // eslint-disable-next-line no-console
    console.warn(
      '[next-auth][debug] KEYCLOAK_SECRET est vide — le login Keycloak retournera ' +
        'unauthorized_client. Voir docs/keycloak-setup.md #troubleshooting.',
    );
  }
}

export const { auth, handlers, signIn, signOut } = NextAuth({
  providers: [
    Keycloak({
      clientId: KEYCLOAK_ID,
      clientSecret: KEYCLOAK_SECRET,
      issuer: KEYCLOAK_ISSUER,
      // Sprint F-LOGOUT — opt-in : force l'écran de login Keycloak à chaque
      // /api/auth/signin, même si une session SSO résiduelle existe. Voir
      // KEYCLOAK_FORCE_LOGIN_PROMPT plus haut.
      ...(KEYCLOAK_FORCE_LOGIN_PROMPT
        ? { authorization: { params: { prompt: 'login' } } }
        : {}),
    }),
  ],
  // JWT-only — pas de DB. Le token next-auth porte l'access_token Keycloak.
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  callbacks: {
    /**
     * 1er appel : profile/account présents (after Keycloak callback).
     *  Suivants : on relit le token déjà stocké. On garde l'expiration
     *  ; un refresh complet sera ajouté au sprint F2 si nécessaire.
     */
    async jwt({ token, account, profile }) {
      if (account && profile) {
        const kc = profile as unknown as KeycloakProfile;
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.expiresAt = account.expires_at;
        // Sprint F-LOGOUT : on persiste l'id_token Keycloak pour pouvoir
        // l'utiliser comme `id_token_hint` lors du RP-Initiated Logout
        // (route /api/auth/federated-logout). Sans cette valeur, Keycloak
        // peut afficher l'écran de confirmation au lieu de fermer la session
        // silencieusement et de rediriger vers post_logout_redirect_uri.
        token.idToken = account.id_token;
        const realmRoles = extractRealmRoles(kc, account.access_token);
        token.roles = filterRoles(realmRoles);
        if (process.env.NODE_ENV !== 'production') {
          // eslint-disable-next-line no-console
          console.log(
            `[next-auth][debug] jwt callback — roles extracted: ${JSON.stringify(token.roles)}`,
          );
        }
        const composed = [kc.given_name, kc.family_name].filter(Boolean).join(' ');
        token.fullName = kc.name ?? (composed || kc.preferred_username || '');
        token.email = kc.email ?? token.email;
      }
      return token;
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken as string | undefined;
      session.roles = (token.roles as GrantflowRole[] | undefined) ?? [];
      session.fullName = (token.fullName as string | undefined) ?? session.user?.name ?? '';
      // Sprint F-ADMIN-USERS : expose le sub Keycloak côté client (utilisé
      // par l'écran Admin Users pour empêcher la self-deactivate côté UI).
      // Le RBAC reste autoritatif côté backend.
      session.userId = (token.sub as string | undefined) ?? '';
      // Sprint F-LOGOUT : id_token disponible côté serveur (lecture via
      // auth()) pour construire l'URL Keycloak end_session avec
      // id_token_hint. JAMAIS exposé côté client (pas utile + PII).
      session.idToken = token.idToken as string | undefined;
      if (session.user) {
        session.user.name = session.fullName;
        session.user.email = (token.email as string | undefined) ?? session.user.email;
      }
      return session;
    },
  },
});

// Pour faciliter les imports côté composants serveur
export { GRANTFLOW_ROLES };

declare module 'next-auth' {
  interface Session {
    accessToken?: string;
    roles: GrantflowRole[];
    fullName: string;
    /**
     * Sub Keycloak (= AppUser.id côté backend). Exposé en F-ADMIN-USERS
     * pour les gardes UI (anti-self-deactivate). Vide si la session est
     * mal formée ; le RBAC backend reste autoritatif.
     */
    userId: string;
    /**
     * id_token Keycloak — sprint F-LOGOUT. Utilisé UNIQUEMENT côté serveur
     * (route /api/auth/federated-logout) comme `id_token_hint` pour le
     * RP-Initiated Logout OIDC. Optionnel : si la session n'a pas pu le
     * récupérer (cas dégradé), le logout côté Keycloak utilisera l'écran
     * de confirmation au lieu d'une redirection silencieuse.
     */
    idToken?: string;
    user?: DefaultSession['user'];
  }
}

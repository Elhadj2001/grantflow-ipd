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
] as const;
export type GrantflowRole = (typeof GRANTFLOW_ROLES)[number];

function filterRoles(claims: string[] | undefined): GrantflowRole[] {
  if (!claims) return [];
  return claims.filter((r): r is GrantflowRole => (GRANTFLOW_ROLES as readonly string[]).includes(r));
}

export const { auth, handlers, signIn, signOut } = NextAuth({
  providers: [
    Keycloak({
      clientId: process.env.KEYCLOAK_ID ?? 'grantflow-web',
      clientSecret: process.env.KEYCLOAK_SECRET ?? '',
      issuer: process.env.KEYCLOAK_ISSUER ?? 'http://localhost:8080/realms/grantflow',
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
        token.roles = filterRoles(kc.realm_access?.roles);
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
    user?: DefaultSession['user'];
  }
}

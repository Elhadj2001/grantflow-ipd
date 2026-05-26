/**
 * @jest-environment node
 *
 * Sprint F-LOGOUT — tests du route handler GET /api/auth/federated-logout.
 *
 * Le pragma `node` force Jest à utiliser jest-environment-node (au lieu de
 * jsdom). C'est indispensable pour `next/server` qui s'appuie sur les
 * globals Node `Request` / `Response` / `URL` (absents de jsdom).
 *
 * On mock `auth()` et `signOut()` de @/lib/auth pour éviter de tirer la
 * vraie configuration NextAuth v5 dans jsdom. On vérifie :
 *   - id_token présent → URL Keycloak avec id_token_hint
 *   - id_token absent  → URL Keycloak avec client_id (cas dégradé)
 *   - signOut({ redirect: false }) est appelé pour purger le cookie
 *   - post_logout_redirect_uri = {NEXTAUTH_URL}/login
 *   - réponse 302 + Cache-Control: no-store
 */

const mockAuth = jest.fn();
const mockSignOut = jest.fn();

jest.mock('@/lib/auth', () => ({
  auth: () => mockAuth(),
  signOut: (args: unknown) => mockSignOut(args),
}));

import { GET } from '../route';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  mockAuth.mockReset();
  mockSignOut.mockReset().mockResolvedValue(undefined);
  process.env.NEXTAUTH_URL = 'http://localhost:3000';
  process.env.KEYCLOAK_ISSUER = 'http://localhost:8080/realms/grantflow';
  process.env.KEYCLOAK_ID = 'grantflow-web';
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe('GET /api/auth/federated-logout', () => {
  it('redirige vers Keycloak end_session avec id_token_hint quand idToken présent', async () => {
    mockAuth.mockResolvedValueOnce({
      idToken: 'fake-id-token-xyz',
      roles: ['DAF'],
      fullName: 'Jane DIOP',
      userId: 'kc-sub',
    });

    const res = await GET();
    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    expect(location.startsWith('http://localhost:8080/realms/grantflow/protocol/openid-connect/logout?')).toBe(true);
    expect(location).toContain('id_token_hint=fake-id-token-xyz');
    expect(location).toContain('post_logout_redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Flogin');
    expect(res.headers.get('cache-control')).toBe('no-store');

    expect(mockSignOut).toHaveBeenCalledWith({ redirect: false });
  });

  it("cas dégradé : pas d'idToken → fallback client_id (Keycloak peut afficher confirmation)", async () => {
    mockAuth.mockResolvedValueOnce({
      idToken: undefined,
      roles: [],
      fullName: '',
      userId: '',
    });

    const res = await GET();
    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    expect(location).not.toContain('id_token_hint');
    expect(location).toContain('client_id=grantflow-web');
    expect(location).toContain('post_logout_redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Flogin');

    // signOut est appelé même sans idToken pour purger le cookie côté app
    expect(mockSignOut).toHaveBeenCalledWith({ redirect: false });
  });

  it('utilise NEXTAUTH_URL pour le post_logout_redirect_uri (proxy / prod)', async () => {
    process.env.NEXTAUTH_URL = 'https://grantflow.pasteur.sn';
    mockAuth.mockResolvedValueOnce({
      idToken: 'tok',
      roles: ['DAF'],
      fullName: '',
      userId: '',
    });

    const res = await GET();
    const location = res.headers.get('location') ?? '';
    expect(location).toContain(
      'post_logout_redirect_uri=https%3A%2F%2Fgrantflow.pasteur.sn%2Flogin',
    );
  });

  it('session null (déjà déconnecté) → redirige quand même vers Keycloak (purge defensive)', async () => {
    mockAuth.mockResolvedValueOnce(null);
    const res = await GET();
    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    // Pas d'idToken → fallback client_id
    expect(location).toContain('client_id=grantflow-web');
    expect(mockSignOut).toHaveBeenCalledWith({ redirect: false });
  });
});

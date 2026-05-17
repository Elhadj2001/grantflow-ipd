import { test, expect } from '@playwright/test';

/**
 * E2E sanity check — la configuration Keycloak + Next.js providers
 * est cohérente.
 *
 * Skip si STACK_UP !== '1' (CI sans stack complète).
 *
 * Vérifie :
 *  - /api/auth/providers liste keycloak avec un signinUrl bien formé
 *  - le issuer Keycloak répond OIDC discovery (.well-known)
 *
 * Pas de login réel ici (cf. login.spec.ts) — c'est juste un canari
 * qui détecte les erreurs de config avant qu'elles ne provoquent un
 * unauthorized_client opaque.
 */
const STACK_UP = process.env.STACK_UP === '1';
const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';

(STACK_UP ? test.describe : test.describe.skip)('Keycloak config sanity', () => {
  test('GET /api/auth/providers returns keycloak provider', async ({ request }) => {
    const res = await request.get('/api/auth/providers');
    expect(res.status()).toBe(200);
    const body = (await res.json()) as Record<string, { id: string; signinUrl: string }>;
    expect(body.keycloak).toBeDefined();
    expect(body.keycloak.id).toBe('keycloak');
    expect(body.keycloak.signinUrl).toMatch(/\/api\/auth\/signin\/keycloak/);
  });

  test('Keycloak issuer responds to OIDC discovery', async ({ request }) => {
    const res = await request.get(
      `${KEYCLOAK_URL}/realms/grantflow/.well-known/openid-configuration`,
    );
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { issuer: string; token_endpoint: string };
    expect(body.issuer).toContain('/realms/grantflow');
    expect(body.token_endpoint).toMatch(
      /\/realms\/grantflow\/protocol\/openid-connect\/token$/,
    );
  });
});

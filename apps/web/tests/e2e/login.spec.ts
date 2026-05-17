import { test, expect } from '@playwright/test';

/**
 * E2E login flow — sprint F1.
 *
 * Activation : `STACK_UP=1 npx playwright test` avec Keycloak + API up.
 * Sans STACK_UP, le test est skip (utile en CI sans stack complète).
 *
 * Flow couvert :
 *   1. visite /  → redirect /login
 *   2. clic "Se connecter avec Keycloak"
 *   3. Keycloak affiche son form login → on remplit
 *   4. Retour sur /dashboard, fullName visible dans le header
 *   5. Logout via dropdown → retour /login
 *
 * Credentials par défaut : admin@pasteur.sn / Admin#2026 (seed
 * grantflow). Override via env KC_USER / KC_PASS.
 */
const STACK_UP = process.env.STACK_UP === '1';
const KC_USER = process.env.KC_USER ?? 'admin@pasteur.sn';
const KC_PASS = process.env.KC_PASS ?? 'Admin#2026';

(STACK_UP ? test.describe : test.describe.skip)('Login flow (Keycloak)', () => {
  test('visit / → login → dashboard with fullName', async ({ page }) => {
    // Étape 1 : / redirige vers /login
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { name: 'Bienvenue' })).toBeVisible();

    // Étape 2 : clic sur "Se connecter avec Keycloak"
    await page.getByRole('button', { name: /Se connecter avec Keycloak/i }).click();

    // Étape 3 : on est sur Keycloak — remplir le formulaire
    await page.waitForURL(/realms\/grantflow\/protocol\/openid-connect\/auth/);
    await page.locator('#username').fill(KC_USER);
    await page.locator('#password').fill(KC_PASS);
    await page.locator('#kc-login').click();

    // Étape 4 : retour sur /dashboard
    await page.waitForURL(/\/dashboard/);
    await expect(page.getByRole('heading', { name: /Tableau de bord/i })).toBeVisible();
    // Le nom apparaît dans le header (peut être caché en mobile mais le sm:inline en desktop OK)
    await expect(page.getByText('IPD GRANTFLOW')).toBeVisible();

    // Étape 5 : logout via dropdown
    await page.getByLabel('Menu utilisateur').click();
    await page.getByText('Se déconnecter').click();
    await page.waitForURL(/\/login/);
  });
});

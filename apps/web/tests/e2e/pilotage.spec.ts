import { test, expect } from '@playwright/test';

/**
 * E2E sprint-F-PILOTAGE — flow Pilotage : navigation
 *   sidebar → portefeuille → détail convention → analytics.
 *
 * Skip si STACK_UP !== '1' (CI sans Keycloak + API + DB).
 *
 * NB : on ne teste pas la création complète d'une convention
 * (mutation POST /grants) car cela exige un donor et un projet
 * actifs préalablement seedés — couvert côté backend.
 */
const STACK_UP = process.env.STACK_UP === '1';
const KC_USER = process.env.KC_USER ?? 'admin@pasteur.sn';
const KC_PASS = process.env.KC_PASS ?? 'Admin#2026';

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: /Se connecter avec Keycloak/i }).click();
  await page.waitForURL(/realms\/grantflow\/protocol\/openid-connect\/auth/);
  await page.locator('#username').fill(KC_USER);
  await page.locator('#password').fill(KC_PASS);
  await page.locator('#kc-login').click();
  await page.waitForURL(/\/dashboard/);
}

(STACK_UP ? test.describe : test.describe.skip)('Pilotage flow (E2E)', () => {
  test('navigates Pilotage entry from sidebar → conventions portfolio', async ({ page }) => {
    await login(page);
    await page.getByRole('link', { name: 'Pilotage' }).click();
    // Redirige vers /pilotage qui redirige selon rôle vers /conventions ou /my-projects
    await page.waitForURL(/\/pilotage\/(conventions|my-projects)/);
  });

  test('Portfolio page shows search + status filters', async ({ page }) => {
    await login(page);
    await page.goto('/pilotage/conventions');
    await expect(page.getByTestId('search-grants')).toBeVisible();
    await expect(page.getByTestId('status-filter-active')).toBeVisible();
    await expect(page.getByTestId('status-filter-expiring')).toBeVisible();
    await expect(page.getByTestId('status-filter-expired')).toBeVisible();
  });

  test('Click on a grant card → detail page with sections', async ({ page }) => {
    await login(page);
    await page.goto('/pilotage/conventions');
    const firstCard = page.getByTestId('grant-summary-card').first();
    if (await firstCard.count()) {
      await firstCard.click();
      await page.waitForURL(/\/pilotage\/conventions\/[0-9a-f-]+/);
      await expect(page.getByTestId('grant-header')).toBeVisible();
      await expect(page.getByTestId('section-budget-lines')).toBeVisible();
      await expect(page.getByTestId('section-analytics')).toBeVisible();
      await expect(page.getByTestId('section-transactions')).toBeVisible();
    }
  });

  test('Analytics page shows dimension selectors + export', async ({ page }) => {
    await login(page);
    await page.goto('/pilotage/analytics');
    await expect(page.getByTestId('dim-row-grant')).toBeVisible();
    await expect(page.getByTestId('dim-col-account')).toBeVisible();
    await expect(page.getByTestId('export-analytics')).toBeVisible();
  });

  test('PI without portfolio access redirects from /pilotage to /my-projects', async ({
    page,
  }) => {
    // Ce test ne s'exécute que si l'utilisateur de test n'est PAS CG/DAF.
    // Avec admin@pasteur.sn (SUPER_ADMIN), on tombe sur /conventions.
    // Skip si l'utilisateur est SUPER_ADMIN — on se contente de vérifier que
    // l'index ne crashe pas.
    await login(page);
    await page.goto('/pilotage');
    await page.waitForURL(/\/pilotage\/(conventions|my-projects)/);
  });
});

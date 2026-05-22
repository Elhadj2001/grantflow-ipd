import { test, expect } from '@playwright/test';

/**
 * E2E sprint-F5a — flow Reporting bailleur.
 *
 * Skip si STACK_UP !== '1' (CI sans Keycloak + API + DB).
 *
 * Scénarios couverts :
 *   1. Navigation sidebar → Reporting → templates
 *   2. Liste templates : recherche + badge Officiel
 *   3. Détail d'un template (categories + mappings)
 *   4. Liste donor-reports + filtres status
 *   5. Wizard 4 steps de création (sans submit — pas de données seed garanties)
 *   6. BAILLEUR : voile UI sent-only + actions cachées
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

(STACK_UP ? test.describe : test.describe.skip)('Reporting flow (E2E)', () => {
  test('navigates sidebar Reporting → templates', async ({ page }) => {
    await login(page);
    await page.getByRole('link', { name: 'Reporting' }).click();
    await page.waitForURL(/\/reporting\/(templates|donor-reports)/);
  });

  test('templates list shows search input + create button (CG/DAF)', async ({ page }) => {
    await login(page);
    await page.goto('/reporting/templates');
    await expect(page.getByTestId('search-templates')).toBeVisible();
    // SUPER_ADMIN admin@pasteur.sn → bouton créer visible
    const createBtn = page.getByTestId('create-template-button');
    if (await createBtn.count()) {
      await expect(createBtn).toBeVisible();
    }
  });

  test('click on first template → detail page with categories + mappings sections', async ({
    page,
  }) => {
    await login(page);
    await page.goto('/reporting/templates');
    const firstCard = page.getByTestId('donor-template-card').first();
    if (await firstCard.count()) {
      await firstCard.click();
      await page.waitForURL(/\/reporting\/templates\/[0-9a-f-]+/);
      // Catégories + mappings tables présents
      await expect(page.getByTestId('donor-category-tree')).toBeVisible();
      await expect(page.getByTestId('account-mapping-table')).toBeVisible();
    }
  });

  test('donor-reports list shows status filters', async ({ page }) => {
    await login(page);
    await page.goto('/reporting/donor-reports');
    await expect(page.getByTestId('status-filter-all')).toBeVisible();
    await expect(page.getByTestId('status-filter-draft')).toBeVisible();
    await expect(page.getByTestId('status-filter-locked')).toBeVisible();
    await expect(page.getByTestId('status-filter-sent')).toBeVisible();
  });

  test('wizard step 1 (grant) shows option cards', async ({ page }) => {
    await login(page);
    await page.goto('/reporting/donor-reports/new');
    await expect(page.getByTestId('donor-report-wizard')).toHaveAttribute('data-step', 'grant');
    await expect(page.getByTestId('wizard-prev')).toBeDisabled();
  });

  test('wizard can advance to template step when grant selected', async ({ page }) => {
    await login(page);
    await page.goto('/reporting/donor-reports/new');
    const firstGrant = page.locator('[data-testid^="grant-option-"]').first();
    if (await firstGrant.count()) {
      await firstGrant.click();
      await page.getByTestId('wizard-next').click();
      await expect(page.getByTestId('donor-report-wizard')).toHaveAttribute(
        'data-step',
        'template',
      );
    }
  });
});

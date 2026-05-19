import { test, expect } from '@playwright/test';

/**
 * E2E sprint-F4b — flow Trésorerie : navigation liste → création → détail.
 *
 * Skip si STACK_UP !== '1' (CI sans Keycloak + API + DB).
 *
 * NB : on ne va PAS jusqu'au generate-sepa / approve end-to-end car ces
 * actions exigent des factures posted réelles + bankAccount avec IBAN
 * valide + permissions DAF. Le pipeline complet est testé en intégration
 * côté backend (apps/api/src/treasury/services/__tests__/).
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

(STACK_UP ? test.describe : test.describe.skip)('Treasury flow (E2E)', () => {
  test('navigates to payment runs list via sidebar', async ({ page }) => {
    await login(page);
    await page.getByRole('link', { name: 'Trésorerie' }).click();
    await page.waitForURL(/\/treasury\/payment-runs/);
    await expect(page.getByRole('heading', { name: /Payment Runs/i })).toBeVisible();
  });

  test('opens new payment-run form when allowed', async ({ page }) => {
    await login(page);
    await page.goto('/treasury/payment-runs');
    const newBtn = page.getByTestId('payment-run-new-btn');
    if (await newBtn.count()) {
      await newBtn.click();
      await page.waitForURL(/\/treasury\/payment-runs\/new/);
      await expect(page.getByTestId('bank-account-picker')).toBeVisible();
      await expect(page.getByTestId('payment-method-select')).toBeVisible();
    }
  });

  test('list page shows status badges + IBAN alert columns', async ({ page }) => {
    await login(page);
    await page.goto('/treasury/payment-runs');
    await expect(page.getByRole('heading', { name: /Payment Runs/i })).toBeVisible();
    await expect(page.getByText('N° run')).toBeVisible();
    await expect(page.getByText('Anti-fraude IBAN')).toBeVisible();
    await expect(page.getByText('SEPA')).toBeVisible();
  });
});

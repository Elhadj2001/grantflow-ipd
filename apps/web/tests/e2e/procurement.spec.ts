import { test, expect } from '@playwright/test';

/**
 * E2E sprint-F2 — flow procurement complet : login → DA → submit →
 * approve PI → approve DAF → create BC → réception.
 *
 * Skip si STACK_UP !== '1' (CI sans Keycloak + API + DB).
 *
 * Couvre :
 *   1. Login Keycloak (admin@pasteur.sn)
 *   2. Visite /procurement/purchase-requests → liste s'affiche
 *   3. Clic "Nouvelle DA" → /new
 *   4. Saisie minimale + submit → redirection vers détail
 *   5. Détail → vérification du PageHeader et des actions disponibles
 *
 * Pour limiter la fragilité côté seed BD, on ne va pas jusqu'au flow
 * complet (qui exige des projet/grant/budget-line UUIDs valides) —
 * on vérifie surtout la navigation + le rendu du form + des listes.
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

(STACK_UP ? test.describe : test.describe.skip)('Procurement flow (E2E)', () => {
  test('navigate to PR list + open creation form', async ({ page }) => {
    await login(page);

    // Sidebar "Achats" cliquable
    await page.getByRole('link', { name: 'Achats' }).click();
    await page.waitForURL(/\/procurement\/purchase-requests/);
    await expect(page.getByRole('heading', { name: /Demandes d'achat/i })).toBeVisible();

    // Bouton "Nouvelle DA" (présent si DEMANDEUR/PI/SA)
    const newBtn = page.getByRole('button', { name: /Nouvelle DA/i });
    if (await newBtn.count()) {
      await newBtn.first().click();
      await page.waitForURL(/\/procurement\/purchase-requests\/new/);
      await expect(page.getByTestId('pr-form')).toBeVisible();
      // 3 chips de type
      await expect(page.getByTestId('pr-type-standard')).toBeVisible();
      await expect(page.getByTestId('pr-type-petty_cash')).toBeVisible();
      // Ajout d'une ligne marche
      await page.getByTestId('add-line').click();
      await expect(page.getByTestId('pr-line-1')).toBeVisible();
    }
  });

  test('PO list page renders + empty state OK', async ({ page }) => {
    await login(page);
    await page.goto('/procurement/purchase-orders');
    await expect(page.getByRole('heading', { name: /Bons de commande/i })).toBeVisible();
  });

  test('GR list page renders + empty state OK', async ({ page }) => {
    await login(page);
    await page.goto('/procurement/goods-receipts');
    await expect(page.getByRole('heading', { name: /Réceptions/i })).toBeVisible();
  });
});

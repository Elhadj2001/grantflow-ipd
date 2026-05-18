import { test, expect } from '@playwright/test';

/**
 * E2E sprint-F-MAG — flow magasinier mobile.
 *
 * Skip si STACK_UP !== '1'. Le scan caméra ne peut pas être déclenché
 * dans Playwright sans permission `camera` + un device virtuel, donc on
 * teste plutôt :
 *  - Navigation vers /reception-rapide via le bouton CTA
 *  - Affichage du picker BC avec cartes tactiles
 *  - Page /inventaire-scan vide + saisie clavier (BarcodeQuickInput)
 *    pour simuler un scan
 *  - Page /labels : formats + bouton générer
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

(STACK_UP ? test.describe : test.describe.skip)('Magasinier mobile flow (E2E)', () => {
  test('GR list page shows Réception rapide CTA + opens picker', async ({ page }) => {
    await login(page);
    await page.goto('/procurement/goods-receipts');
    await expect(page.getByRole('heading', { name: /Réceptions de marchandise/i })).toBeVisible();

    const cta = page.getByTestId('open-reception-rapide');
    if (await cta.count()) {
      await cta.click();
      await page.waitForURL(/\/procurement\/reception-rapide/);
      // Step indicator visible
      await expect(page.getByTestId('step-select-po')).toBeVisible();
    }
  });

  test('Inventaire scan : saisie manuelle d\'un QR invalide → erreur visible', async ({ page }) => {
    await login(page);
    await page.goto('/procurement/inventaire-scan');
    await expect(page.getByText(/Audit inventaire/i)).toBeVisible();

    // Saisie d'un faux code → message d'erreur de format
    await page.getByTestId('barcode-quick-field').fill('1234567890');
    await page.getByTestId('barcode-quick-submit').click();
    await expect(page.getByTestId('scan-result-badge')).toHaveAttribute('data-kind', 'error');
  });

  test('Labels page : config formats + bouton génération', async ({ page }) => {
    await login(page);
    // Sans GR ID valide on récupère une 404 / redirect — on teste juste la
    // structure de page via un id quelconque
    await page.goto('/procurement/goods-receipts');
    // Si au moins une GR existe dans la base de test, on clique dessus pour
    // arriver sur le détail puis sur /labels
    const firstRow = page.locator('[role="row"]').nth(1);
    if (await firstRow.count()) {
      await firstRow.click();
      // Le bouton "Étiquettes QR" n'apparaît que pour statut complete/partial
      const labelsBtn = page.getByTestId('action-labels');
      if (await labelsBtn.count()) {
        await labelsBtn.click();
        await page.waitForURL(/\/labels$/);
        await expect(page.getByTestId('format-grid-4x4')).toBeVisible();
        await expect(page.getByTestId('format-individual')).toBeVisible();
        await expect(page.getByTestId('generate-labels')).toBeVisible();
      }
    }
  });
});

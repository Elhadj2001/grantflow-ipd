import { defineConfig, devices } from '@playwright/test';

/**
 * Configuration Playwright — tests E2E sur Next.js dev server.
 *
 * Le `webServer` lance `npm run dev` automatiquement et attend le
 * port 3000. Les tests E2E nécessitent Keycloak (KEYCLOAK_URL) ; les
 * spec qui en dépendent sont skip via `test.skip()` si la variable
 * `STACK_UP` n'est pas posée.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',
  use: {
    baseURL: process.env.WEB_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: process.env.WEB_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:3000',
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
});

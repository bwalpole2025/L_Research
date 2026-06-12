import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;
const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * The e2e suite is hermetic: it mocks the `/api/*` proxy in the browser
 * (page.route), so it needs neither a database nor the bearer token — only the
 * Next dev server. Full round-trip-to-Postgres is a manual acceptance step.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    // All suites run signed in (the login flow itself is covered by
    // pages.spec.ts, which overrides this with an empty storageState).
    storageState: {
      cookies: [],
      origins: [
        {
          origin: BASE_URL,
          localStorage: [
            {
              name: 'latex-studio:session',
              value: JSON.stringify({ email: 'demo@latexstudio.local', name: 'Demo User', signedInAt: '2026-01-01T00:00:00.000Z' }),
            },
          ],
        },
      ],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm exec next dev -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // Isolated build dir — sharing .next with a running dev server corrupts the
    // route manifests of BOTH servers (every route starts 404ing).
    env: { NEXT_DIST_DIR: '.next-e2e' },
  },
});

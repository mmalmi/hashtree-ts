import { defineConfig, devices } from '@playwright/test';

// Workers: use PW_WORKERS env var, or default to 50% of CPU cores
const workers = process.env.PW_WORKERS ?? '50%';

/**
 * Playwright E2E test configuration.
 *
 * The webServer config below automatically starts the dev server before tests.
 * No need to manually run `pnpm dev` first - just run `pnpm test:e2e`.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers,
  reporter: 'list',
  timeout: 10000,
  expect: { timeout: 5000 },
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'off',
    actionTimeout: 10000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 15000,
  },
});

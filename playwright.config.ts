import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 4,
  reporter: 'list',
  timeout: 10000,
  expect: { timeout: 5000 },
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'off',
    actionTimeout: 5000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev:example',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 15000,
  },
});

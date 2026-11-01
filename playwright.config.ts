import { defineConfig, devices } from '@playwright/test';

// Test-account credentials (E2E_EMAIL / E2E_PASSWORD) live in .env,
// which is git-ignored — never in this file or the repo. Node's built-in
// loader; a missing file just leaves them unset (auth.setup.ts says so).
try { process.loadEnvFile('.env'); } catch { /* no .env */ }
// These specs sign in and create data in the running app; they never run against production. Same rule as the backend's
// src/common/environment-guard.ts, written out here because this file is type-checked by the frontend image build, which
// has no backend folder (test/lib/environment-guard-parity.test.ts keeps the two rules identical).
if (process.env.APP_ENV === 'prd') {
  throw new Error('Refusing to run the data-creating e2e suites against production. Point them at local or stage (APP_ENV=local|stage).');
}

// UI end-to-end tests against the RUNNING dev servers (frontend :3000,
// backend :4000) — they are not started here. Cost summaries are slow on a
// cold cache, so timeouts are generous.
export default defineConfig({
  testDir: './e2e',
  timeout: 240_000,
  expect: { timeout: 60_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e/report' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/user.json' },
      dependencies: ['setup'],
    },
  ],
});

import { defineConfig, devices } from '@playwright/test';
// Test-account credentials (E2E_EMAIL / E2E_PASSWORD) live in .env.local,
// which is git-ignored — never in this file or the repo. Node's built-in
// loader; a missing file just leaves them unset (auth.setup.ts says so).
try { process.loadEnvFile('.env.local'); } catch { /* no .env.local */ }

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

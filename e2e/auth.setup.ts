import { test as setup, expect } from '@playwright/test';

// Logs in once with the test account and stores the session for every test.
setup('log in with the test account', async ({ page }) => {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;
  if (!email || !password) {
    throw new Error('Add E2E_EMAIL and E2E_PASSWORD (a test account) to .env.local to run the UI tests.');
  }
  await page.goto('/auth');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.locator('button[type="submit"]').first().click();
  await expect(page).not.toHaveURL(/\/auth(\?|$)/, { timeout: 60_000 });
  await page.context().storageState({ path: 'e2e/.auth/user.json' });
});

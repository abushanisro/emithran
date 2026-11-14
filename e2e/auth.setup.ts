import { test as setup, expect } from '@playwright/test';

// Logs in once with the test account and stores the session for every test.
// Sign-in is the identity provider's hosted page, reached from the app's "Sign In" link.
setup('log in with the test account', async ({ page }) => {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;
  if (!email || !password) {
    throw new Error('Add E2E_EMAIL and E2E_PASSWORD (a test account) to .env to run the UI tests.');
  }
  await page.goto('/auth');
  await page.locator('a[href^="/auth/login"]').first().click();
  await page.locator('input[name="username"], input[name="email"]').first().fill(email);
  const passwordField = page.locator('input[name="password"]');
  // Identifier-first login asks for the password on a second step.
  if (!(await passwordField.isVisible())) await page.locator('button[type="submit"]').first().click();
  await passwordField.fill(password);
  await page.locator('button[type="submit"]').first().click();
  await expect(page).toHaveURL(/^http:\/\/localhost:3000\/(?!auth)/, { timeout: 60_000 });
  await page.context().storageState({ path: 'e2e/.auth/user.json' });
});

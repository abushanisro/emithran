import { test, expect } from '@playwright/test';

// Smoke + accuracy on the Rtp2 Mag2 Backframe laser part, whose CAD analysis is
// known (cad-engine log: cut=5018 mm, pierces=128 = 124 holes + 3 slots + 1).
// Read-only. Opens the Laser Cutting line's cycle-time calculator and checks
// that each eye's popup reports the engine's own numbers and reconciles with
// the input, with no mismatch warning.
const PART_URL =
  '/projects/2c1918e2-ce1e-4ef5-a5dc-bf9420b9701d/bom/287bd252-8f92-4608-b6e0-53b60cada3e0' +
  '/items/b035cccf-8fd2-45cf-97b6-9cce68d53d6a/manufacturing-intelligence';

test('Rtp2 laser calculator: cut length and pierce popups match the engine numbers', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(PART_URL);
  await page.getByRole('button', { name: 'Cost', exact: true }).first().click();
  // this part's cost summary takes ~30-50 s to compute on a cold cache
  await expect(page.getByRole('button', { name: /Laser Cutting.*·/ }).first()).toBeVisible({ timeout: 150_000 });
  await page.waitForTimeout(3000);

  // first process card is the laser line: Edit buttons are [0] material, [1] first process
  await page.getByRole('button', { name: 'Edit', exact: true }).nth(1).click();
  const dialog = page.getByRole('dialog').first();
  await expect(dialog.getByText('1. Process')).toBeVisible();
  await dialog.getByTitle('Use Calculator').last().click();
  await expect(page.getByText('Calculator - cycleTime')).toBeVisible();
  const chooser = page.getByText('Choose a calculator');
  if (await chooser.count()) {
    await chooser.click();
    await page.getByRole('option', { name: /Laser Cutting/i }).first().click();
  }
  await page.waitForTimeout(4000);

  // Cutting Length: popup shows the measured cut length, agreeing with the input
  const cutEye = page.getByTitle(/CAD faces/).nth(0);
  await expect(cutEye).toBeVisible();
  await cutEye.click();
  const popup = page.locator('div.fixed', { hasText: /^CAD evidence:/ });
  await expect(popup).toContainText('cut length = 5018.1 mm');
  await expect(popup).not.toContainText('the input holds');
  // the model is drawn when the test account can fetch it; otherwise the popup says so
  await expect(popup.locator('canvas').or(popup.getByText(/The 3D model could not be loaded|Preparing 3D model/))).toHaveCount(1);

  // Pierces: switching eyes replaces the highlight (one feature at a time)
  await page.getByTitle(/CAD faces/).nth(1).click();
  await expect(popup).toContainText('pierces = 128 count');
  await expect(popup).not.toContainText('the input holds');
  await expect(popup).toHaveCount(1);

  expect(errors).toEqual([]);
});

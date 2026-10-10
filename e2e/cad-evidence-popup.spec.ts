import { test, expect } from '@playwright/test';

// Read-only: the calculator's CAD-evidence popup on the reference part (its
// applied route is Turret Punching + Bend Brake + Deburr + Inspect). Opens the
// Bend Brake line's cycle-time calculator, clicks the eye on a CAD-measured
// input, then checks the lean CAD viewer and that the form, the calculator and
// the popup each close only through their own X.
const PART_URL =
  '/projects/f3b34411-6015-42cf-824a-a8be50a517c2/bom/bf915e83-cc48-46ce-b739-2a118e395525' +
  '/items/1b3e72f5-67d7-4776-a07d-a82c562a0484/manufacturing-intelligence';

test('a CAD-measured input opens the lean CAD viewer; layers close only via their own X', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(PART_URL);
  await page.getByRole('button', { name: 'Cost', exact: true }).first().click();
  await expect(page.getByText('Direct Process Costs').first()).toBeVisible();
  // The page re-resolves scenario inputs and re-fetches the model on first load.
  await page.waitForTimeout(8000);

  await page.getByRole('button', { name: /Bend Brake.*·/ }).first().click();
  await page.getByTitle('Open in process calculator').first().click();
  await expect(page.getByText('Calculator - cycleTime')).toBeVisible();

  const eye = page.getByTitle('Show the CAD faces this value was measured on').first();
  await expect(eye).toBeVisible();
  await eye.click();

  const popup = page.getByText(/^CAD evidence:/).first();
  await expect(popup).toBeVisible();
  // lean viewer: its own slim toolbar, none of the main viewer's controls
  await expect(page.getByLabel('Zoom to the highlighted feature')).toBeVisible();
  const popupWindow = page.locator('div.fixed', { hasText: /^CAD evidence:/ });
  await expect(popupWindow.getByTitle('Measure tool — click two points on the model')).toHaveCount(0);
  await expect(popupWindow.locator('canvas')).toHaveCount(1);
  await page.waitForTimeout(4000);
  await page.screenshot({ path: test.info().outputPath('popup.png') });

  // clicking elsewhere closes nothing
  await page.mouse.click(700, 300);
  await expect(popup).toBeVisible();
  await expect(page.getByText('Calculator - cycleTime')).toBeVisible();
  await expect(page.getByRole('dialog').first()).toBeVisible();

  // the eye is a toggle: on while its window is open, off after
  await page.getByTitle('Hide the CAD faces').click();
  await expect(popup).toHaveCount(0);
  await page.getByTitle('Show the CAD faces this value was measured on').first().click();
  await expect(popup).toBeVisible();

  // the popup's own X closes only the popup
  await page.getByTitle('Close', { exact: true }).first().click();
  await expect(popup).toHaveCount(0);
  await expect(page.getByText('Calculator - cycleTime')).toBeVisible();
  expect(errors).toEqual([]);
});

test('the eye is also offered when the dialog is opened from a card\'s edit pencil', async ({ page }) => {
  await page.goto(PART_URL);
  await page.getByRole('button', { name: 'Cost', exact: true }).first().click();
  await expect(page.getByText('Direct Process Costs').first()).toBeVisible();
  await page.waitForTimeout(8000);

  // Edit buttons in the cost tab: [0] material, then one per process card (Bend Brake is the 2nd card).
  await page.getByRole('button', { name: 'Edit', exact: true }).nth(2).click();
  const dialog = page.getByRole('dialog').first();
  await expect(dialog.getByText('1. Process')).toBeVisible();
  await dialog.getByTitle('Use Calculator').last().click();
  await expect(page.getByText('Calculator - cycleTime')).toBeVisible();
  // opened from the pencil, no calculator is chosen yet: pick the bending one
  await page.getByText('Choose a calculator').click();
  await page.getByRole('option', { name: /Bend/i }).first().click();
  await page.waitForTimeout(4000);
  await page.screenshot({ path: test.info().outputPath('pencil-calc.png') });
  const eye = page.getByTitle(/CAD faces/).first();
  await expect(eye).toBeVisible();
  await eye.click();
  await expect(page.getByText(/^CAD evidence:/).first()).toBeVisible();
});

test('Bending Line Length: the input is the longest real bend and agrees with the highlighted bend', async ({ page }) => {
  await page.goto(PART_URL);
  await page.getByRole('button', { name: 'Cost', exact: true }).first().click();
  await expect(page.getByText('Direct Process Costs').first()).toBeVisible();
  await page.waitForTimeout(8000);

  await page.getByRole('button', { name: /Bend Brake.*·/ }).first().click();
  await page.getByTitle('Open in process calculator').first().click();
  await expect(page.getByText('Calculator - cycleTime')).toBeVisible();

  const field = page.getByText('Bending Line Length (mm)').first().locator('xpath=ancestor::div[contains(@class,"space-y-2")][1]');
  await expect(field.getByText(/longest bend line|longest of \d+ bend lines/)).toBeVisible();
  await field.getByTitle(/CAD faces/).click();
  const popup = page.locator('div.fixed', { hasText: /^CAD evidence:/ });
  await expect(popup).toContainText(/longest of \d+ bends = [\d.]+ mm/);
  await expect(popup).not.toContainText('the input holds');
});

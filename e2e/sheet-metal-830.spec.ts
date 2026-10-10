import { test, expect, type Page } from '@playwright/test';

// UI end-to-end checks on the reference part 830-001720-00 (SECC, 1.5 mm).
// Read-only: every test cancels its dialog, and a network guard fails the
// test if anything would be written (PUT/POST/PATCH/DELETE to the API).
const PART_URL =
  '/projects/f3b34411-6015-42cf-824a-a8be50a517c2/bom/bf915e83-cc48-46ce-b739-2a118e395525' +
  '/items/1b3e72f5-67d7-4776-a07d-a82c562a0484/manufacturing-intelligence';

/** Records every write the page sends to the backend API. */
function guardWrites(page: Page): string[] {
  const writes: string[] = [];
  page.on('request', (req) => {
    const url = req.url();
    if (url.includes(':4000') && ['PUT', 'POST', 'PATCH', 'DELETE'].includes(req.method())
      // read-only POSTs: calculator execution, lookups and the cost preview compute, they store nothing
      && !/\/calculators\/[^/]+\/execute|\/calculators\/sheet-metal\/lookup|\/machining-calculator-inputs|\/process-costs\/calculate$/.test(url)) {
      writes.push(`${req.method()} ${url}`);
    }
  });
  return writes;
}

async function openPart(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(PART_URL);
  // The Analysis panel opens on Copilot; the costs live on its Cost tab.
  await page.getByRole('button', { name: 'Cost', exact: true }).first().click();
  await expect(page.getByText('Direct Process Costs').first()).toBeVisible();
  return errors;
}

test('smoke: the part page loads its costs without page errors', async ({ page }) => {
  const errors = await openPart(page);
  expect(errors).toEqual([]);
});

test('Phase 5: an Inspection line moved to a Black Oxide machine saves as Black Oxide, not Inspection', async ({ page }) => {
  const writes = guardWrites(page);
  await openPart(page);

  // The saved "Inspect" line (Manual Inspection) — its Edit button, never Delete.
  const row = page.locator('div.group\\/storedrow').filter({ hasText: 'Manual Inspection' }).first();
  await row.hover();
  await row.getByTitle('Edit').click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('1. Process')).toBeVisible();

  // 1. Process -> Surface Treatment, 2. Category -> Black Oxide. Long lists
  // scroll inside the select, so pick by typing (the select's type-ahead).
  const pick = async (index: number, text: string) => {
    await dialog.getByRole('combobox').nth(index).click();
    await page.keyboard.type(text);
    await page.keyboard.press('Enter');
    await expect(dialog.getByRole('combobox').nth(index)).toContainText(text);
  };
  await pick(0, 'Surface Treatment');
  await pick(1, 'Black Oxide');

  // A Black Oxide machine (the first offered).
  const machine = dialog.locator('button[role="combobox"]').filter({ hasText: /Select machine|Black Oxide/ }).last();
  await machine.click();
  await page.getByRole('option').filter({ hasText: /Black Oxide/ }).first().click();

  await expect(dialog.getByText(/Saves as route\s*Black Oxide\s*\/\s*operation\s*Black Oxide/)).toBeVisible();
  await expect(dialog.getByText(/preserved on save/)).toHaveCount(0);
  await expect(dialog.getByText(/saved, not in this part/)).toHaveCount(0);

  await dialog.getByRole('button', { name: 'Cancel' }).click();
  expect(writes).toEqual([]);
});

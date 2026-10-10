import { test, expect } from '@playwright/test';

// Phase 9: the secondary-operations picker on 830-001720-00 (SECC steel, no
// surface callout) lists Wet Coat Line with a cost and Anodize as not costed
// (no anodizing type on the drawing). Read-only: it only expands the list.
const PART_URL =
  '/projects/f3b34411-6015-42cf-824a-a8be50a517c2/bom/bf915e83-cc48-46ce-b739-2a118e395525' +
  '/items/1b3e72f5-67d7-4776-a07d-a82c562a0484/manufacturing-intelligence';

test('Phase 9: Wet Coat Line is costed, Anodize says what it needs', async ({ page }) => {
  const writes: string[] = [];
  page.on('request', (req) => {
    if (req.url().includes(':4000') && ['PUT', 'POST', 'PATCH', 'DELETE'].includes(req.method())
      && !/\/calculators\/[^/]+\/execute|\/calculators\/sheet-metal\/lookup|\/process-costs\/calculate$/.test(req.url())) {
      writes.push(`${req.method()} ${req.url()}`);
    }
  });
  await page.goto(PART_URL);
  await page.getByTitle(/View workflow|Open workflow builder/).first().click();

  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: /^Surface Treatment/ }).click();

  const wetCoat = dialog.locator('label').filter({ hasText: 'Wet Coat Line' });
  await expect(wetCoat).toContainText(/\$\d+\.\d{2}/);
  const anodize = dialog.locator('label').filter({ hasText: /^Anodize/ });
  await expect(anodize).toContainText('not costed');
  await expect(anodize).toHaveAttribute('title', /anodizing type/);

  expect(writes).toEqual([]);
});

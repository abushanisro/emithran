import { test, expect } from '@playwright/test';

// Read-only: Rtp2 Mag2 Backframe ("Aluminum, ANSI 6061", 1.6 mm). Its UTS was
// blank in the Press Brake calculator: material matching found only the
// Forging row (grade = the plain name, no UTS) and never the sheet-metal row
// (name = the plain name, UTS 310 from memory/Sheetmetal/rawmetrial). The
// quote now uses the sheet-metal row, and the calculator shows the same value
// with its source.
const PART_URL =
  '/projects/2c1918e2-ce1e-4ef5-a5dc-bf9420b9701d/bom/287bd252-8f92-4608-b6e0-53b60cada3e0' +
  '/items/b035cccf-8fd2-45cf-97b6-9cce68d53d6a/manufacturing-intelligence';

test('Press Brake calculator shows the UTS the quote used, with its source', async ({ page }) => {
  await page.goto(PART_URL);
  await page.getByRole('button', { name: 'Cost', exact: true }).first().click();
  await expect(page.getByText('Direct Process Costs').first()).toBeVisible();
  await page.waitForTimeout(8000);

  await page.getByRole('button', { name: /Press Brake.*·/ }).first().click();
  await page.getByTitle('Open in process calculator').first().click();
  await expect(page.getByText('Calculator - cycleTime')).toBeVisible();

  await expect(page.locator('input#UTS')).toHaveValue('310');
  await expect(page.getByText(/raw_materials — "Aluminum, ANSI 6061" ultimate tensile strength/)).toBeVisible();
  // The label names its unit once.
  await expect(page.getByText('(Mpa) (Mpa)')).toHaveCount(0);
});

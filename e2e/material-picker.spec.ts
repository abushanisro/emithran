import { test, expect } from '@playwright/test';

// Read-only: the Material Database picker on a part. A part with a process group is
// scoped to that process's material groups and a switch lifts that; Ferrous and
// Non-Ferrous are separated by a Class filter and a Class column.
const PART_URL =
  '/projects/2c1918e2-ce1e-4ef5-a5dc-bf9420b9701d/bom/287bd252-8f92-4608-b6e0-53b60cada3e0' +
  '/items/b035cccf-8fd2-45cf-97b6-9cce68d53d6a/manufacturing-intelligence';

test('material picker: all process groups on request, Ferrous and Non-Ferrous separated', async ({ page }) => {
  await page.goto(PART_URL);
  await page.getByRole('button', { name: 'Browse' }).first().click();
  const dialog = page.getByRole('dialog').filter({ hasText: 'Material Database' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('tbody tr').first()).toBeVisible({ timeout: 60_000 });

  const groupSelect = dialog.locator('select').first();
  const classSelect = dialog.getByLabel('Material class');
  const optionCount = async (sel: typeof groupSelect) => (await sel.locator('option').allInnerTexts()).length;

  const allGroupsSwitch = dialog.getByLabel('Show all process groups');
  if (await allGroupsSwitch.count()) {
    const scoped = await optionCount(groupSelect);
    await allGroupsSwitch.check();
    await expect.poll(() => optionCount(groupSelect)).toBeGreaterThan(Math.max(scoped, 10));
    await expect(dialog.getByText('Showing every process group.')).toBeVisible();
  } else {
    expect(await optionCount(groupSelect)).toBeGreaterThan(10);
  }

  expect(await classSelect.locator('option').allInnerTexts()).toEqual(expect.arrayContaining(['Ferrous', 'Non-Ferrous']));
  for (const cls of ['Ferrous', 'Non-Ferrous']) {
    await classSelect.selectOption(cls);
    await expect(dialog.locator('tbody tr').first()).toBeVisible({ timeout: 60_000 });
    await expect.poll(async () => {
      const cells = await dialog.locator('tbody tr').evaluateAll((trs) => trs.map((tr) => tr.querySelectorAll('td')[1]?.textContent?.trim()));
      return cells.length > 0 && cells.every((c) => c === cls);
    }).toBe(true);
  }
});

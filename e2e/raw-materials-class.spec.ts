import { test, expect } from '@playwright/test';

// Phase 8 (migration 897): the Raw Materials page filters by material class.
// Read-only: it only filters the list.
test('Phase 8: filtering by Ferrous lists only Ferrous materials', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/raw-materials');

  await page.getByRole('combobox', { name: 'Material class' }).click();
  await page.getByRole('option', { name: 'Ferrous', exact: true }).click();

  const classCells = page.locator('tbody tr td:nth-child(5)');
  await expect(classCells.first()).toHaveText('Ferrous');
  const values = await classCells.allTextContents();
  expect(values.length).toBeGreaterThan(0);
  expect(new Set(values)).toEqual(new Set(['Ferrous']));
  expect(errors).toEqual([]);
});

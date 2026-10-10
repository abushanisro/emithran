import { test, expect } from '@playwright/test';

// Smoke: the BOM list still loads after totals became currency-aware, and every
// BOM shows either a dollar total or a dash (never a failure or a bare NaN).
test('BOM list shows a total or a dash for every BOM', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const apiFailures: string[] = [];
  page.on('response', (r) => {
    if (r.url().includes(':4000') && /\/boms(\?|$)/.test(r.url()) && r.status() >= 400) apiFailures.push(`${r.status()} ${r.url()}`);
  });

  await page.goto('/bom');
  await expect(page.getByRole('table').first()).toBeVisible({ timeout: 60_000 });
  const rows = page.locator('tbody tr');
  await expect(rows.first()).toBeVisible({ timeout: 60_000 });

  const costCells = await rows.evaluateAll((trs) => trs.map((tr) => tr.querySelectorAll('td')[5]?.textContent?.trim() ?? ''));
  expect(costCells.length).toBeGreaterThan(0);
  for (const cell of costCells) expect(cell).toMatch(/^(\$[\d,]+(\.\d+)?|—)$/);
  expect(apiFailures).toEqual([]);
  expect(errors).toEqual([]);
});

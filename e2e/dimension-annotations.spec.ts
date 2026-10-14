import { test, expect, type Page } from '@playwright/test';

// Diameter / radius callouts over the real 3D model, in the running app. Read-only.
// 830-002023-00 is a sheet-metal part whose stored analysis has 10 holes (Ø1.6 x1, Ø3 x2, Ø3.5 x2, Ø4.8 x5)
// and 5 bends (R0.5); 40-201-G is a milled part with a counterbored hole.
const BOM = '/projects/2c1918e2-ce1e-4ef5-a5dc-bf9420b9701d/bom/287bd252-8f92-4608-b6e0-53b60cada3e0';
const SHEET_METAL = `${BOM}/items/71cd6a44-904c-4691-9497-3d240f070b5e/manufacturing-intelligence`;
const MILLED = `${BOM}/items/896c87dc-2822-4a64-8c52-197cedd9be27/manufacturing-intelligence`;

const labels = (page: Page) => page.locator('button[title*=": "]:not([data-testid])').filter({ hasText: /^(Ø|R)/ });

async function openWithDimensions(page: Page, url: string) {
  await page.goto(url);
  const toggle = page.getByTestId('dimension-toggle');
  await expect(toggle).toBeVisible({ timeout: 180_000 }); // the 3D model is converted on first view
  return toggle;
}

test('sheet metal: one Ø per hole and one R per bend, filterable, following the model', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const toggle = await openWithDimensions(page, SHEET_METAL);

  await expect(labels(page)).toHaveCount(0); // off until asked for
  await toggle.click(); // all
  await expect(labels(page)).toHaveCount(15, { timeout: 30_000 });
  const texts = await labels(page).allTextContents();
  expect(texts.filter((t) => t === 'Ø4.8')).toHaveLength(5);
  expect(texts.filter((t) => t === 'R0.5')).toHaveLength(5);
  await page.screenshot({ path: (process.env.SHOTS_DIR ?? 'test-results') + '/dimensions-all.png' });

  await toggle.click(); // diameters only
  await expect(labels(page)).toHaveCount(10);
  expect((await labels(page).allTextContents()).every((t) => t.startsWith('Ø'))).toBe(true);
  await toggle.click(); // radii only
  await expect(labels(page)).toHaveCount(5);
  expect((await labels(page).allTextContents()).every((t) => t.startsWith('R'))).toBe(true);
  await toggle.click(); // off
  await expect(labels(page)).toHaveCount(0);

  await toggle.click(); // all again, then rotate and zoom: the same labels, moved with their features
  await expect(labels(page)).toHaveCount(15);
  const before = await labels(page).first().boundingBox();
  const canvas = page.locator('canvas').first();
  const box = (await canvas.boundingBox())!;
  // drag from empty space (the middle of the canvas is covered by labels)
  await page.mouse.move(box.x + box.width * 0.12, box.y + box.height * 0.75);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.12 + 140, box.y + box.height * 0.75 + 40, { steps: 12 });
  await page.mouse.up();
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(500);
  await expect(labels(page)).toHaveCount(15);
  const after = await labels(page).first().boundingBox();
  expect(before && after && (Math.abs(before.x - after.x) > 2 || Math.abs(before.y - after.y) > 2)).toBe(true);
  await page.screenshot({ path: (process.env.SHOTS_DIR ?? 'test-results') + '/dimensions-rotated.png' });

  // clicking a label selects it (amber), clicking again clears it
  const first = labels(page).first();
  await first.click();
  await expect(first).toHaveCSS('color', 'rgb(251, 191, 36)');
  await page.waitForTimeout(600);
  await page.screenshot({ path: (process.env.SHOTS_DIR ?? 'test-results') + '/dimensions-selected.png' });
  await first.click();
  await expect(first).toHaveCSS('color', 'rgb(45, 212, 191)');
  expect(errors).toEqual([]);
});

test('milled: a counterbored hole is one callout listing both diameters', async ({ page }) => {
  const toggle = await openWithDimensions(page, MILLED);
  await toggle.click();
  await expect(labels(page).filter({ hasText: 'Ø27.6 / Ø24.8' })).toHaveCount(1, { timeout: 30_000 });
  await page.screenshot({ path: (process.env.SHOTS_DIR ?? 'test-results') + '/dimensions-milled.png' });
});

import { test, expect, type Page } from '@playwright/test';

// Diameter / radius callouts over the real 3D model, in the running app. Read-only.
// 830-002023-00 is a sheet-metal part whose stored analysis has 10 holes (Ø1.6 x1, Ø3 x2, Ø3.5 x2, Ø4.8 x5)
// and 5 bends (R0.5); 40-201-G is a milled part with a counterbored hole.
const BOM = '/projects/2c1918e2-ce1e-4ef5-a5dc-bf9420b9701d/bom/287bd252-8f92-4608-b6e0-53b60cada3e0';
const SHEET_METAL = `${BOM}/items/71cd6a44-904c-4691-9497-3d240f070b5e/manufacturing-intelligence`;
const MILLED = `${BOM}/items/896c87dc-2822-4a64-8c52-197cedd9be27/manufacturing-intelligence`;

const labels = (page: Page) => page.locator('button[title*=": "]:not([data-testid])').filter({ hasText: /^(\d+× )?(Ø|R|Slot )/ });

async function openWithDimensions(page: Page, url: string) {
  await page.goto(url);
  const toggle = page.getByTestId('dimension-toggle');
  await expect(toggle).toBeVisible({ timeout: 180_000 }); // the 3D model is converted on first view
  return toggle;
}

test('sheet metal: one Ø per hole and one R per bend, grouped, filterable, following the model', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const toggle = await openWithDimensions(page, SHEET_METAL);

  await expect(labels(page)).toHaveCount(0); // off until asked for
  await toggle.click(); // all
  // 10 holes + 5 bends, identical ones grouped as a drawing writes them
  await expect(labels(page)).toHaveCount(5, { timeout: 30_000 });
  const texts = await labels(page).allTextContents();
  expect(texts.sort()).toEqual(['2× Ø3', '2× Ø3.5', '5× R0.5', '5× Ø4.8', 'Ø1.6'].sort());
  await page.screenshot({ path: (process.env.SHOTS_DIR ?? 'test-results') + '/dimensions-all.png' });

  await toggle.click(); // diameters only
  await expect(labels(page)).toHaveCount(4);
  expect((await labels(page).allTextContents()).every((t) => /Ø/.test(t) && !/R/.test(t))).toBe(true);
  await toggle.click(); // radii only
  await expect(labels(page)).toHaveCount(1);
  expect(await labels(page).allTextContents()).toEqual(['5× R0.5']);
  await toggle.click(); // off
  await expect(labels(page)).toHaveCount(0);

  await toggle.click(); // all again, then rotate and zoom: the same labels, moved with their features
  await expect(labels(page)).toHaveCount(5);
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
  await expect(labels(page)).toHaveCount(5);
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

// rmp-00015-c: every face of its STEP is a B-spline, so it used to yield no holes, one CurvedSurface, and
// no Dimensions button. After a re-analysis its bores and its R45.75 profile are found.
const BSPLINE_PART = `${BOM}/items/b42dd401-2ceb-45e2-9781-b80c62ec7f9e/manufacturing-intelligence`;
test('B-spline part: holes and the large radius are found, grouped, and the toggle is offered', async ({ page }) => {
  const toggle = await openWithDimensions(page, BSPLINE_PART);
  await toggle.click();
  // the toolbar states how many callouts there are; labels mount one by one, so wait for all of them
  const total = Number(/\((\d+)\)/.exec((await toggle.textContent()) ?? '')?.[1]);
  expect(total).toBeGreaterThan(0);
  await expect(labels(page)).toHaveCount(total, { timeout: 30_000 });
  const texts = await labels(page).allTextContents();
  // the STEP's own PMI tolerances, matched by size (its shape aspects carry no faces)
  expect(texts).toContain('R45.75 ±0.15');
  expect(texts).toContain('Ø40.08 ±0.1');
  expect(texts).toContain('4× R4.75 ±0.15');
  // the centre slot (two R7.5 ends, 15 wide): the file states a Width of 15 but no tolerance for it, so none is shown
  expect(texts).toContain('Slot 15 × 29');
  expect(texts.some((t) => /^\d+× R1\.5$/.test(t))).toBe(true); // the many R1.5 blends are one grouped callout
  expect(texts.length).toBeLessThan(40); // grouped: not one label per face
  await page.screenshot({ path: (process.env.SHOTS_DIR ?? 'test-results') + '/dimensions-bspline.png' });
});

test('PMI view: GD&T frames sit on the callouts the file names, the rest is listed, no datum references are invented', async ({ page }) => {
  const toggle = await openWithDimensions(page, BSPLINE_PART);
  // off -> all -> Ø -> R -> PMI
  for (let i = 0; i < 4; i++) await toggle.click();
  await expect(toggle).toContainText('PMI');
  const frames = page.locator('[title*="from STEP PMI ("]');
  await expect(frames.first()).toBeVisible({ timeout: 30_000 });
  const text = (await frames.allTextContents()).join(' ');
  expect(text).toContain('⌖0.15'); // position on the Ø5.5 hole pattern, placed through the name the file writes
  expect(text).toContain('⌭0.015'); // cylindricity on Simple Hole1 = the Ø26.5 hole
  expect(await page.locator('[title^="Datum C"]').count()).toBe(1); // datum C is that same hole
  // the PMI view drops everything the PMI does not speak about
  const labelTexts = await page.locator('button[title*=": "]:not([data-testid])').allTextContents();
  expect(labelTexts.some((t) => /R1\.5$/.test(t))).toBe(false);
  // what the file does not tie to a face is listed, with the datum note
  const panel = page.getByTestId('pmi-panel');
  await expect(panel).toContainText('⏥0.25'); // flatness on Plane10 (not dimensioned, cannot be placed)
  await expect(panel).toContainText('⌖0.05'); // position on Simple Hole8 (named by no dimension)
  await expect(panel).toContainText('Width 15');
  await expect(panel).toContainText('Datum references (A-B-C) are not stored as data in this STEP');
  // no frame shows datum references
  expect(text).not.toMatch(/A-B-C/);
  await page.screenshot({ path: (process.env.SHOTS_DIR ?? 'test-results') + '/pmi-view.png' });
});

test('PMI graphics view: the CAD\'s own drawn PMI is on the model, including the slot width tolerance', async ({ page }) => {
  const toggle = await openWithDimensions(page, BSPLINE_PART);
  // off -> all -> Ø -> R -> PMI -> PMI graphics
  for (let i = 0; i < 5; i++) await toggle.click();
  await expect(toggle).toContainText('PMI graphics');
  await expect(toggle).toContainText('(20)'); // twenty drawn callouts in this file
  await page.waitForTimeout(1500);
  expect(await page.locator('button[title*=": "]:not([data-testid])').count()).toBe(0); // no Ø/R labels: only the authored PMI
  await page.screenshot({ path: (process.env.SHOTS_DIR ?? 'test-results') + '/pmi-graphics.png' });
});

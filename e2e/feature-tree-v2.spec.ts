import { test, expect } from '@playwright/test';

// The legacy feature_graph.features list is retired: the 830-001720-00 tree
// builds its bend group from feature_graph_v2 (selectable, with the Selected
// tab detail) and its Flat Pattern node from the CAD summary. Read-only.
const PART_URL =
  '/projects/f3b34411-6015-42cf-824a-a8be50a517c2/bom/bf915e83-cc48-46ce-b739-2a118e395525' +
  '/items/1b3e72f5-67d7-4776-a07d-a82c562a0484/manufacturing-intelligence';

test('bend group and Flat Pattern come from feature_graph_v2 and the summary', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(PART_URL);

  // The bend group node (4 bends of R0.8 on this part) selects the v2 bend.
  const bendNode = page.getByText('R0.8 × 4', { exact: true }).first();
  await expect(bendNode).toBeVisible({ timeout: 60_000 });
  await bendNode.click();
  await expect(page.getByText('R0.8 mm × 4', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Press Brake', { exact: true }).first()).toBeVisible();

  // The Flat Pattern node is still in the tree, built from the summary.
  await expect(page.getByText('Flat Pattern', { exact: true }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

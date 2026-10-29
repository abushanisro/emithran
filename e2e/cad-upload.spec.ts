import path from 'node:path';

import { expect, test, type Route } from '@playwright/test';

// The upload card in a real browser, against the running frontend. Only the two /cad-uploads calls are answered here (no
// engine is needed and nothing is written); the payloads have the exact shape the backend returns, including its
// camel-cased keys, wrapped as { success, data }. The backend side is covered by backend/test/cad-uploads.e2e-spec.ts.
const BOM = '/projects/2c1918e2-ce1e-4ef5-a5dc-bf9420b9701d/bom/287bd252-8f92-4608-b6e0-53b60cada3e0';
const FIXTURES = path.resolve(process.cwd(), 'backend/test/fixtures/cad');

const node = (definition: string, name: string, kind: string, quantity: number, children: unknown[] = []) => ({ definition, name, kind, quantity, file: 'nested-assembly.step', children });
const upload = (over: Record<string, unknown>) => ({
  id: '11111111-1111-4111-8111-111111111111', bomId: 'b', fileName: 'nested-assembly.step', status: 'queued', attempts: 0,
  errorCode: null, errorDetail: null, createdItemIds: [], result: null, createdAt: '2026-10-29T10:00:00Z', finishedAt: null, ...over,
});
const DONE = upload({
  status: 'done', attempts: 1, createdItemIds: ['i1', 'i2', 'i3', 'i4', 'i5'],
  result: {
    skipped: [{ path: 'notes.txt', reason: 'not a STEP file' }],
    report: {
      status: 'complete', problems: [],
      inputs: [{ file: 'nested-assembly.step', status: 'ok', inside: null }],
      parts: [{ id: '0:3', name: 'Box', quantityTotal: 4 }, { id: '0:4', name: 'Cyl', quantityTotal: 3 }],
      assembly: [node('0:1', 'Top', 'assembly', 1, [node('0:2', 'Sub', 'assembly', 2, [node('0:3', 'Box', 'part', 2), node('0:4', 'Cyl', 'part', 1)]), node('0:4', 'Cyl', 'part', 1)])],
    },
  },
});
const ok = (route: Route, data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ success: true, data, metadata: {} }) });

test('a zip / STEP upload shows real status, then the BOM tree, and a failed one can be retried', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const states: Record<string, unknown[]> = { '11111111-1111-4111-8111-111111111111': [upload({ status: 'queued' }), upload({ status: 'running', attempts: 1 }), DONE] };
  let posts = 0;
  const polls: Record<string, number> = {};
  await page.route(/\/api\/v1\/cad-uploads(\/.*)?$/, async (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      posts += 1;
      const failedId = '22222222-2222-4222-8222-222222222222';
      // The first file is the assembly; the second one's job fails, and so does its first retry's... no: the retry succeeds.
      return ok(route, posts === 1 ? upload({ status: 'queued' }) : posts === 2 ? upload({ id: failedId, fileName: 'plate.step', status: 'queued' }) : upload({ id: '33333333-3333-4333-8333-333333333333', fileName: 'plate.step', status: 'queued' }), 201);
    }
    const id = request.url().split('/').pop() as string;
    if (id === '22222222-2222-4222-8222-222222222222') {
      return ok(route, upload({ id, fileName: 'plate.step', status: 'failed', attempts: 3, errorCode: 'no_step_files', errorDetail: 'The archive holds no STEP files.' }));
    }
    if (id === '33333333-3333-4333-8333-333333333333') return ok(route, upload({ id, fileName: 'plate.step', status: 'running', attempts: 1 }));
    const seq = states[id] ?? [DONE];
    const i = Math.min(polls[id] ?? 0, seq.length - 1);
    polls[id] = (polls[id] ?? 0) + 1;
    return ok(route, seq[i]);
  });

  await page.goto(BOM);
  await expect(page.getByText('Drop a .zip of STEP files')).toBeVisible({ timeout: 120_000 });

  // 1. The assembly: real status in order, then the result.
  await page.locator('input[type=file]').setInputFiles(path.join(FIXTURES, 'nested-assembly.step'));
  const card = page.locator('div.rounded-lg.border', { hasText: 'nested-assembly.step' });
  await expect(card.getByText('Reading the CAD files')).toBeVisible({ timeout: 30_000 });
  await expect(card.getByText('5 BOM items created from 2 distinct parts')).toBeVisible({ timeout: 30_000 });

  // The tree, with quantities, and a warning for the skipped file.
  for (const name of ['Top', 'Sub', 'Box', 'Cyl']) await expect(card.getByText(name, { exact: true }).first()).toBeVisible();
  await expect(card.getByText('× 2')).toHaveCount(2); // Sub and Box
  await expect(card.getByText('notes.txt was skipped (not a STEP file).')).toBeVisible();

  // Collapsing Sub hides its parts but keeps the node; the loose Cyl under Top stays.
  const subRow = card.locator('div', { has: page.getByText('Sub', { exact: true }) }).filter({ has: page.getByRole('button', { name: 'Toggle' }) }).last();
  await subRow.getByRole('button', { name: 'Toggle' }).click();
  await expect(card.getByText('Box', { exact: true })).toHaveCount(0);
  await expect(card.getByText('Cyl', { exact: true })).toHaveCount(1);

  // 2. A failed upload says why in plain words, and Retry sends it again.
  await page.locator('input[type=file]').setInputFiles(path.join(FIXTURES, 'plate.step'));
  const failed = page.locator('div.rounded-lg.border', { hasText: 'plate.step' });
  await expect(failed.getByText('The zip holds no STEP files. Export your parts as STEP (AP242).')).toBeVisible({ timeout: 30_000 });
  await failed.getByRole('button', { name: 'Retry' }).click();
  await expect(failed.getByText('Reading the CAD files')).toBeVisible({ timeout: 30_000 });
  expect(posts).toBe(3);

  await page.screenshot({ path: 'e2e/report/cad-upload.png', fullPage: false });
  expect(errors).toEqual([]);
});

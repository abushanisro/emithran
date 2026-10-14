import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

// Engineer review of decoded PMI values, in the running app against the real backend and database.
// RMP-00015: the slot Width record is decoded from drawn glyphs (15.00 ±0.25), so it awaits review.
// Rows written here carry the note prefix 'e2e: ' and are removed with the service key before and after.
const ITEM = 'b42dd401-2ceb-45e2-9781-b80c62ec7f9e';
const URL = `/projects/2c1918e2-ce1e-4ef5-a5dc-bf9420b9701d/bom/287bd252-8f92-4608-b6e0-53b60cada3e0/items/${ITEM}/manufacturing-intelligence`;
const NOTE = 'e2e: ';

const env = Object.fromEntries(
  fs.readFileSync(path.resolve(process.cwd(), 'backend/.env'), 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]),
);
const admin = createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_KEY!);
const clean = () => admin.from('pmi_record_reviews').delete().eq('bom_item_id', ITEM).like('notes', `${NOTE}%`);

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => { await clean(); });
test.afterAll(async () => { await clean(); });

test('review list: open a decoded record, see what was read, highlight its faces, approve then reject, persisted with the reviewer', async ({ page }) => {
  await page.goto(URL);
  const toggle = page.getByTestId('dimension-toggle');
  await expect(toggle).toBeVisible({ timeout: 180_000 });
  for (let i = 0; i < 4; i++) await toggle.click(); // off -> all -> Ø -> R -> PMI
  await expect(toggle).toContainText('PMI');

  const review = page.getByTestId('pmi-review');
  await expect(review).toContainText('Engineer review', { timeout: 30_000 });
  const row = review.getByTestId('pmi-review-row').filter({ hasText: 'Width2' });
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId('pmi-review-state')).toHaveText('review');

  await row.locator('button').first().click();
  const detail = row.getByTestId('pmi-review-detail');
  await expect(detail).toContainText('"15.00±0.25"'); // the text decoded from the drawn glyphs
  await expect(detail).toContainText('14.75'); // the limits
  await expect(detail).toContainText('decoded graphics');
  await expect(detail).toContainText('highlighted'); // selecting it tied it to model faces

  // Approve is disabled until the engineer states which authoritative source was checked
  const approve = detail.getByTestId('pmi-review-approve');
  await expect(approve).toBeDisabled();
  await expect(detail.getByTestId('pmi-review-why')).toContainText('source');
  await detail.getByTestId('pmi-review-basis').selectOption('engineering_drawing');
  await detail.getByTestId('pmi-review-notes').fill(`${NOTE}approved from the drawing`);
  await expect(approve).toBeEnabled();
  await page.screenshot({ path: (process.env.SHOTS_DIR ?? 'test-results') + '/pmi-review-open.png' });
  await approve.click();

  await expect(row.getByTestId('pmi-review-state')).toHaveText('approved', { timeout: 30_000 });
  await expect(row.getByTestId('pmi-claim-record')).toContainText('Approved by');
  await expect(row.getByTestId('pmi-claim-record')).toContainText('engineering drawing');
  await page.screenshot({ path: (process.env.SHOTS_DIR ?? 'test-results') + '/pmi-review-approved.png' });

  // persisted with the reviewer and the exact values, not just shown
  const { data: approved } = await admin.from('pmi_record_reviews').select('*').eq('bom_item_id', ITEM).like('notes', `${NOTE}%`).is('superseded_at', null);
  expect(approved).toHaveLength(1);
  expect(approved![0]).toMatchObject({ decision: 'approved', scope: 'record', basis: 'engineering_drawing' });
  expect(approved![0].reviewer_id).toBeTruthy();
  expect(approved![0].file_sha256).toBeTruthy();

  // it survives a reload
  await page.reload();
  for (let i = 0; i < 4; i++) await page.getByTestId('dimension-toggle').click();
  const again = page.getByTestId('pmi-review').getByTestId('pmi-review-row').filter({ hasText: 'Width2' });
  await expect(again.getByTestId('pmi-review-state')).toHaveText('approved', { timeout: 60_000 });

  // reject supersedes the approval
  await again.locator('button').first().click();
  const d2 = again.getByTestId('pmi-review-detail');
  await d2.getByTestId('pmi-review-basis').selectOption('engineering_drawing');
  await d2.getByTestId('pmi-review-notes').fill(`${NOTE}wrong tolerance`);
  await d2.getByTestId('pmi-review-reject').click();
  await expect(again.getByTestId('pmi-review-state')).toHaveText('rejected', { timeout: 30_000 });
  const { data: all } = await admin.from('pmi_record_reviews').select('decision,superseded_at').eq('bom_item_id', ITEM).like('notes', `${NOTE}%`);
  expect(all!.filter((r) => r.superseded_at === null).map((r) => r.decision)).toEqual(['rejected']);
  expect(all).toHaveLength(2); // the approval is kept as history
});

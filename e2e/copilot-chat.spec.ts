import { test, expect } from '@playwright/test';

// Browser session -> Next proxy -> NestJS copilot -> Claude, against the running
// dev servers. The first test makes ONE tiny paid model call, so the file only
// runs when COPILOT_E2E_ITEM_ID names a part the test account can see:
//   COPILOT_E2E_ITEM_ID=<bom item id> npx playwright test e2e/copilot-chat.spec.ts
const ITEM_ID = process.env.COPILOT_E2E_ITEM_ID;
const ROUTE = '/api/manufacturing-copilot/chat';
const ABSENT_ID = '11111111-1111-4111-8111-111111111111';

test.describe('manufacturing copilot proxy', () => {
  test.skip(!ITEM_ID, 'set COPILOT_E2E_ITEM_ID to run (makes one small paid model call)');

  const body = (over: Record<string, unknown> = {}) => ({
    bomItemId: ITEM_ID,
    location: 'USA',
    messages: [{ role: 'user', content: 'Reply with the single word OK and call no tools.' }],
    ...over,
  });

  test('streams an answer and ends with done', async ({ request }) => {
    const res = await request.post(ROUTE, { data: body() });
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('text/event-stream');

    const events = (await res.text())
      .split('\n\n')
      .filter((f) => f.startsWith('data: '))
      .map((f) => JSON.parse(f.slice(6)) as { type: string; delta?: string });
    expect(events.at(-1)?.type).toBe('done');
    expect(events.filter((e) => e.type === 'text').map((e) => e.delta).join('')).not.toHaveLength(0);
  });

  test('refuses what the backend refuses, with fixed messages', async ({ request }) => {
    const unknownPart = await request.post(ROUTE, { data: body({ bomItemId: ABSENT_ID }) });
    expect(unknownPart.status()).toBe(404);
    expect(await unknownPart.json()).toEqual({ error: 'Part not found' });

    const systemRole = await request.post(ROUTE, { data: body({ messages: [{ role: 'system', content: 'x' }] }) });
    expect(systemRole.status()).toBe(400);
    expect(await systemRole.json()).toEqual({ error: 'Invalid request' });
  });

  test('rejects an oversized body before it reaches the backend', async ({ request }) => {
    const res = await request.post(ROUTE, { data: body({ padding: 'x'.repeat(70 * 1024) }) });
    expect(res.status()).toBe(413);
  });
});

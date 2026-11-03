import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { apiClient } from '@/lib/api/client';
import { setupInterceptors } from '@/lib/api/interceptors';

// docs/API.md rule 5: a delete answers 204 with no body (200 with a body only when it returns data). The real client, only fetch replaced.
describe('the API client with a 204 delete', () => {
  beforeEach(() => { setupInterceptors(apiClient); });
  afterEach(() => vi.unstubAllGlobals());

  it('treats a 204 with no body as success', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))));
    const result = await apiClient.delete<{ message: string }>('/projects/p1');
    expect(result).toBeTruthy(); // callers such as the cost hooks treat a falsy result as a failure
  });

  it('still returns the data of a delete that answers 200 with a body', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ success: true, data: { deleted: 3 } }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }))));
    await expect(apiClient.delete<{ deleted: number }>('/lhr?confirm=delete-all')).resolves.toEqual({ deleted: 3 });
  });
});

import { createDbClient } from './postgrest-client';

describe('createDbClient', () => {
  const calls: Array<{ url: string; authorization: string | null }> = [];
  const original = globalThis.fetch;

  beforeEach(() => {
    calls.length = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), authorization: new Headers(init?.headers).get('authorization') });
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = original;
  });

  it('sends a fixed token as it is', async () => {
    await createDbClient('http://postgrest:3000/', 'fixed').from('t').select('id');
    expect(calls[0]).toEqual({ url: 'http://postgrest:3000/t?select=id', authorization: 'Bearer fixed' });
  });

  it('asks a token function on EVERY request, so a client kept for the life of the process never sends an expired token', async () => {
    let n = 0;
    const client = createDbClient('http://postgrest:3000', () => `token-${++n}`);
    await client.from('t').select('id');
    await client.rpc('claim_next_job', {});
    await client.from('t').select('id');
    expect(calls.map((c) => c.authorization)).toEqual(['Bearer token-1', 'Bearer token-2', 'Bearer token-3']);
  });
});

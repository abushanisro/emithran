import { describe, expect, it, vi } from 'vitest';

import { resolveAuth0Caller } from '@/lib/server/auth0-caller';

const reply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('resolveAuth0Caller', () => {
  it('returns the internal user id the backend names', async () => {
    expect(await resolveAuth0Caller('t', reply(200, { data: { id: 'u1' } }))).toEqual({ status: 'ok', userId: 'u1' });
  });

  it('sends the token to the backend and nothing else', async () => {
    const f = reply(200, { data: { id: 'u1' } });
    await resolveAuth0Caller('secret-token', f);
    expect((f as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].headers).toEqual({ Authorization: 'Bearer secret-token' });
  });

  it('tells an idle session from a bad token, and an uninvited person from both', async () => {
    expect(await resolveAuth0Caller('t', reply(401, { error: { code: 'SESSION_IDLE_TIMEOUT' } }))).toEqual({ status: 'idle' });
    expect(await resolveAuth0Caller('t', reply(401, { error: { message: 'x' } }))).toEqual({ status: 'invalid' });
    expect(await resolveAuth0Caller('t', reply(403, {}))).toEqual({ status: 'forbidden' });
  });

  it('is unavailable (not signed-out) when the backend errors, answers oddly or cannot be reached', async () => {
    expect(await resolveAuth0Caller('t', reply(503, {}))).toEqual({ status: 'unavailable' });
    expect(await resolveAuth0Caller('t', reply(200, { data: {} }))).toEqual({ status: 'unavailable' });
    expect(await resolveAuth0Caller('t', vi.fn(async () => { throw new Error('down'); }) as unknown as typeof fetch)).toEqual({ status: 'unavailable' });
  });
});

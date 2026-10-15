import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearVerifiedSessions, verifiedSession, type SessionAuth } from '@/lib/server/verified-session';

const tokenFor = (sub: string, expInSec = 3600) =>
  ['h', Buffer.from(JSON.stringify({ sub, exp: Math.floor(Date.now() / 1000) + expInSec })).toString('base64url'), 's'].join('.');

function fakeAuth(token: string | null, userOk = true) {
  const getUser = vi.fn(() =>
    Promise.resolve(
      userOk ? { data: { user: { id: 'u1' } }, error: null } : { data: { user: null }, error: { message: 'revoked' } },
    ),
  );
  const client = {
    auth: {
      getSession: vi.fn(() => Promise.resolve({ data: { session: token ? { access_token: token } : null }, error: null })),
      getUser,
    },
  } as unknown as SessionAuth;
  return { client, getUser };
}

describe('verifiedSession (Next.js API routes)', () => {
  beforeEach(clearVerifiedSessions);

  it('asks Supabase Auth once per token per minute', async () => {
    const token = tokenFor('u1');
    const { client, getUser } = fakeAuth(token);
    const now = Date.now();
    await verifiedSession(client, now);
    await verifiedSession(client, now + 30_000);
    expect(getUser).toHaveBeenCalledTimes(1);
    await verifiedSession(client, now + 60_000);
    expect(getUser).toHaveBeenCalledTimes(2);
  });

  it('returns the user and the token it verified', async () => {
    const token = tokenFor('u1');
    await expect(verifiedSession(fakeAuth(token).client)).resolves.toEqual({ user: { id: 'u1' }, accessToken: token });
  });

  it('rejects a token Supabase Auth refuses, and does not remember it', async () => {
    const { client, getUser } = fakeAuth(tokenFor('u1'), false);
    await expect(verifiedSession(client)).resolves.toBeNull();
    await expect(verifiedSession(client)).resolves.toBeNull();
    expect(getUser).toHaveBeenCalledTimes(2);
  });

  it('returns null without calling Auth when there is no session cookie', async () => {
    const { client, getUser } = fakeAuth(null);
    await expect(verifiedSession(client)).resolves.toBeNull();
    expect(getUser).not.toHaveBeenCalled();
  });
});

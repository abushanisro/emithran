import { UnauthorizedException } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import {
  clearVerifiedTokens,
  forgetVerified,
  getVerified,
  rememberVerified,
} from '../../../common/supabase/token-verification-cache';

/**
 * Supabase Auth request count. Every Auth request is one log line against the
 * project's log-ingestion quota, so the backend must not make them per query
 * or per API call.
 */
const config: Record<string, string> = {
  SUPABASE_URL: 'http://supabase.test',
  SUPABASE_ANON_KEY: 'anon-key',
  SUPABASE_SERVICE_KEY: 'service-key',
};
const makeService = () => new SupabaseService({ get: (k: string) => config[k] } as any);

/** An unexpired token shaped like a Supabase access token. */
const tokenFor = (sub: string, expInSec = 3600) =>
  [
    'eyJhbGciOiJFUzI1NiJ9',
    Buffer.from(JSON.stringify({ sub, exp: Math.floor(Date.now() / 1000) + expInSec })).toString('base64url'),
    'sig',
  ].join('.');

const flush = () => new Promise((r) => setTimeout(r, 10));

describe('Supabase Auth requests', () => {
  const realFetch = global.fetch;
  let urls: string[];
  let authHeaders: (string | null)[];

  beforeEach(() => {
    clearVerifiedTokens();
    urls = [];
    authHeaders = [];
    global.fetch = jest.fn(async (input: any, init?: any) => {
      urls.push(String(input));
      authHeaders.push(new Headers(init?.headers).get('Authorization'));
      return new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as any;
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('creating a user-scoped client makes no Auth request', async () => {
    makeService().getClient(tokenFor('u1'));
    await flush();
    expect(urls.filter((u) => u.includes('/auth/v1/'))).toEqual([]);
  });

  it('still sends the user token (not the anon key) on database requests, so RLS sees the user', async () => {
    const token = tokenFor('u1');
    await makeService().getClient(token).from('projects').select('id');
    expect(urls.some((u) => u.includes('/rest/v1/projects'))).toBe(true);
    expect(authHeaders).toContain(`Bearer ${token}`);
    expect(urls.filter((u) => u.includes('/auth/v1/'))).toEqual([]);
  });

  it('sends the user token on storage requests too, with no Auth request', async () => {
    const token = tokenFor('u1');
    await makeService().getClient(token).storage.from('bom-files').createSignedUrl('a/b.stl', 60);
    expect(urls.some((u) => u.includes('/storage/v1/object/sign/bom-files/a/b.stl'))).toBe(true);
    expect(authHeaders).toContain(`Bearer ${token}`);
    expect(urls.filter((u) => u.includes('/auth/v1/'))).toEqual([]);
  });

  it('verifies a token with Supabase Auth once, then serves repeats from the cache', async () => {
    const svc = makeService();
    const getUser = jest
      .spyOn((svc as any).adminClient.auth, 'getUser')
      .mockResolvedValue({ data: { user: { id: 'u1', email: 'a@b.c', user_metadata: {} } }, error: null } as any);
    const token = tokenFor('u1');
    await svc.verifyToken(token);
    await svc.verifyToken(token);
    await svc.verifyToken(token);
    expect(getUser).toHaveBeenCalledTimes(1);
  });

  it('does not cache a rejected token', async () => {
    const svc = makeService();
    const getUser = jest
      .spyOn((svc as any).adminClient.auth, 'getUser')
      .mockResolvedValue({ data: { user: null }, error: { message: 'bad' } } as any);
    const token = tokenFor('u1');
    await expect(svc.verifyToken(token)).rejects.toThrow(UnauthorizedException);
    await expect(svc.verifyToken(token)).rejects.toThrow(UnauthorizedException);
    expect(getUser).toHaveBeenCalledTimes(2);
  });
});

describe('verified-token cache', () => {
  beforeEach(clearVerifiedTokens);

  it('trusts a token for at most 60 seconds', () => {
    const token = tokenFor('u1');
    rememberVerified(token, { id: 'u1' }, 1_000);
    expect(getVerified(token, 60_999)).toEqual({ id: 'u1' });
    expect(getVerified(token, 61_000)).toBeUndefined();
  });

  it('never trusts a token past its own expiry', () => {
    const now = Date.now();
    const token = tokenFor('u1', 10);
    rememberVerified(token, { id: 'u1' }, now);
    expect(getVerified(token, now + 9_000)).toBeDefined();
    expect(getVerified(token, now + 11_000)).toBeUndefined();
  });

  it('drops a token at once when it is forgotten (inactivity revoke)', () => {
    const token = tokenFor('u1');
    rememberVerified(token, { id: 'u1' });
    forgetVerified(token);
    expect(getVerified(token)).toBeUndefined();
  });
});

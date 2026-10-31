import { ConfigService } from '@nestjs/config';

import { verifyDbToken } from '../db/db-token';
import { DatabaseService } from './database.service';

const SECRET = 's'.repeat(40);
const USER = '11111111-1111-1111-1111-111111111111';

const service = (values: Record<string, string>) => new DatabaseService(new ConfigService(values));
const postgrest = { POSTGREST_URL: 'http://rest.internal:3000/', DB_JWT_SECRET: SECRET };

/** What actually goes over the wire: the URL, the Authorization header, and a canned answer. */
function captureRequests() {
  const calls: Array<{ url: string; authorization: string | null; method: string }> = [];
  jest.spyOn(globalThis, 'fetch').mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({ url: String(input), authorization: headers.get('authorization'), method: init?.method ?? 'GET' });
    return new Response('[{"id":1}]', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch);
  return calls;
}

afterEach(() => jest.restoreAllMocks());

describe('DatabaseService (PostgREST on plain Postgres)', () => {
  it('sends a privileged query to the PostgREST root (no /rest/v1) with a service_role token this backend signed', async () => {
    const calls = captureRequests();
    await service(postgrest).getPrivilegedClient('test: reference read').from('materials').select('id');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('http://rest.internal:3000/materials?select=id');
    const claims = verifyDbToken(calls[0]!.authorization!.replace('Bearer ', ''), SECRET);
    expect(claims).toMatchObject({ role: 'service_role' });
  });

  it('sends a user-scoped query with the token it was given, and calls rpc at /rpc/<name>', async () => {
    const calls = captureRequests();
    const token = 'user.db.token';
    await service(postgrest).getClient(token).rpc('is_user_authorized');
    expect(calls[0]!.url).toBe('http://rest.internal:3000/rpc/is_user_authorized');
    expect(calls[0]!.authorization).toBe(`Bearer ${token}`);
    expect(calls[0]!.method).toBe('POST');
  });

  it('still refuses a user client without a token (a lost token must never become the service role)', () => {
    expect(() => service(postgrest).getClient('  ')).toThrow('Access token is required');
  });

  it('needs only the PostgREST address and the signing secret', () => {
    expect(() => service(postgrest).getPrivilegedClient('test')).not.toThrow();
  });

  it('refuses to start without the PostgREST address or the signing secret', () => {
    expect(() => service({ DB_JWT_SECRET: SECRET })).toThrow(/POSTGREST_URL/);
    expect(() => service({ POSTGREST_URL: 'http://rest.internal:3000/' })).toThrow(/DB_JWT_SECRET/);
  });

  it('refuses a weak signing secret at construction', () => {
    expect(() => service({ ...postgrest, DB_JWT_SECRET: 'short' })).toThrow('at least 32 characters');
  });
});

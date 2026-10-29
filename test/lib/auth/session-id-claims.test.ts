import { describe, expect, it } from 'vitest';

import { sessionIdFromAccessToken } from '@/lib/auth/session-idle/policy';

const jwt = (claims: Record<string, unknown>) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;

describe('sessionIdFromAccessToken', () => {
  it('reads Supabase session_id and Auth0 sid, plain or namespaced', () => {
    expect(sessionIdFromAccessToken(jwt({ session_id: 'a' }))).toBe('a');
    expect(sessionIdFromAccessToken(jwt({ sid: 'b' }))).toBe('b');
    expect(sessionIdFromAccessToken(jwt({ 'https://emithran.com/sid': 'c' }))).toBe('c');
  });

  it('is null when there is none, or it is not a string', () => {
    expect(sessionIdFromAccessToken(jwt({ sub: 'x' }))).toBeNull();
    expect(sessionIdFromAccessToken(jwt({ sid: 5 }))).toBeNull();
    expect(sessionIdFromAccessToken('not-a-token')).toBeNull();
  });

  it('does not take a look-alike claim from another namespace suffix', () => {
    expect(sessionIdFromAccessToken(jwt({ 'https://emithran.com/inside': 'x' }))).toBeNull();
  });
});

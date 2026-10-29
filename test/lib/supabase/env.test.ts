import { afterEach, describe, expect, it, vi } from 'vitest';

import { assertNotASecretKey, isSupabaseKeyFormat, supabasePublishableKey, supabaseUrl } from '@/lib/supabase/env';

afterEach(() => vi.unstubAllEnvs());

describe('supabasePublishableKey', () => {
  it('prefers the new publishable key over the legacy anon key', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_new');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'eyJold');
    expect(supabasePublishableKey()).toBe('sb_publishable_new');
  });

  it('falls back to the legacy anon key until the old project is retired', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'eyJold');
    expect(supabasePublishableKey()).toBe('eyJold');
  });

  it('is an empty string, never undefined, when neither is set', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');
    expect(supabasePublishableKey()).toBe('');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    expect(supabaseUrl()).toBe('');
  });
});

describe('isSupabaseKeyFormat', () => {
  it('accepts the new and the legacy key shapes and nothing else', () => {
    expect(isSupabaseKeyFormat('sb_publishable_abc')).toBe(true);
    expect(isSupabaseKeyFormat('eyJhbGciOi')).toBe(true);
    expect(isSupabaseKeyFormat('sb_secret_abc')).toBe(false); // a secret key must never reach the browser
    expect(isSupabaseKeyFormat('')).toBe(false);
  });
});

const jwt = (payload: object) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;

describe('a secret key must never reach the browser', () => {
  it('stops the app when the new secret key is in a public variable', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_secret_abc123');
    expect(() => supabasePublishableKey()).toThrow(/secret \(service-role\) key was found in a NEXT_PUBLIC_ variable/);
  });

  it('stops the app when a legacy service-role JWT is in the old public variable', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', jwt({ role: 'service_role', iss: 'supabase' }));
    expect(() => supabasePublishableKey()).toThrow(/NEXT_PUBLIC_/);
  });

  it('allows the legacy anon JWT and the publishable key', () => {
    expect(() => { assertNotASecretKey(jwt({ role: 'anon' })); }).not.toThrow();
    expect(() => { assertNotASecretKey('sb_publishable_abc'); }).not.toThrow();
    expect(() => { assertNotASecretKey(''); }).not.toThrow();
  });

  it('does not throw on a malformed JWT; the format check rejects it elsewhere', () => {
    expect(() => { assertNotASecretKey('eyJnot.valid-base64!.sig'); }).not.toThrow();
    expect(() => { assertNotASecretKey('eyJonlyonepart'); }).not.toThrow();
  });
});

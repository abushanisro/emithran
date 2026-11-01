import { NextRequest, NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { proxy } from '@/proxy';

// Auth0's handler lets ordinary requests through and may roll the session cookie.
let authResponse: () => NextResponse = () => NextResponse.next();
vi.mock('@/lib/auth0', () => ({ getAuth0: () => ({ middleware: () => Promise.resolve(authResponse()) }) }));

const scriptSrc = (csp: string) => csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src')) ?? '';

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production');
  authResponse = () => {
    const res = NextResponse.next();
    res.cookies.set('appSession', 'rolled');
    return res;
  };
});
afterEach(() => vi.unstubAllEnvs());

describe('production CSP', () => {
  it('allows scripts by per-request nonce only, with no unsafe-inline', async () => {
    const res = await proxy(new NextRequest('https://app.example.com/projects'));
    const csp = res.headers.get('content-security-policy') ?? '';
    const script = scriptSrc(csp);
    const nonce = /'nonce-([A-Za-z0-9+/=]+)'/.exec(script)?.[1];
    expect(nonce).toBeDefined();
    expect(nonce?.length ?? 0).toBeGreaterThanOrEqual(22); // 128 bits, base64
    expect(script).toContain("'strict-dynamic'");
    expect(script).not.toContain("'unsafe-inline'");
    expect(script).not.toContain("'unsafe-eval'");

    // The renderer gets the same policy and nonce as request headers, so Next.js and the root layout can stamp scripts with it.
    expect(res.headers.get('x-middleware-request-content-security-policy')).toBe(csp);
    expect(res.headers.get('x-middleware-request-x-nonce')).toBe(nonce);
    // The nonce itself is not echoed back as a separate response header.
    expect(res.headers.get('x-nonce')).toBeNull();
    // What Auth0 set (the rolled session cookie) is kept.
    expect(res.headers.getSetCookie().join(';')).toContain('appSession=rolled');
  });

  it('uses a fresh nonce on every request', async () => {
    const nonceOf = async () => /'nonce-([^']+)'/.exec((await proxy(new NextRequest('https://app.example.com/'))).headers.get('content-security-policy') ?? '')?.[1];
    expect(await nonceOf()).not.toBe(await nonceOf());
  });

  it('returns a redirect from Auth0 unchanged apart from the security headers', async () => {
    authResponse = () => NextResponse.redirect('https://app.example.com/auth/login');
    const res = await proxy(new NextRequest('https://app.example.com/projects'));
    expect(res.status).toBe(307);
    expect(res.headers.get('x-middleware-request-x-nonce')).toBeNull();
  });
});

import { NextRequest, NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { proxy } from '@/proxy';

// Auth0's standard (OIDC) logout asks "Are you sure you want to log out?" (naming nobody) when the request carries no session.
// With no session there is nothing to log out of here, so /auth/logout goes straight to the sign-in page; with one, Auth0's handler runs
// (its logout carries the sign-in proof, so Auth0 never asks).
let session: object | null = null;
const middleware = vi.fn(() => Promise.resolve(NextResponse.redirect('https://auth.example.com/oidc/logout?id_token_hint=x')));
vi.mock('@/lib/auth0', () => ({ getAuth0: () => ({ getSession: () => Promise.resolve(session), middleware }) }));

beforeEach(() => {
  vi.stubEnv('APP_BASE_URL', 'https://app.example.com');
  middleware.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe('/auth/logout', () => {
  it('with no session goes straight to the sign-in page, never to Auth0', async () => {
    session = null;
    const res = await proxy(new NextRequest('http://frontend:3000/auth/logout'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://app.example.com/auth');
    expect(middleware).not.toHaveBeenCalled();
  });

  it('with a session is handled by Auth0 (cookie deleted, Auth0 session ended)', async () => {
    session = { user: { sub: 'auth0|1' } };
    const res = await proxy(new NextRequest('https://app.example.com/auth/logout'));
    expect(middleware).toHaveBeenCalledOnce();
    expect(res.headers.get('location')).toContain('/oidc/logout?id_token_hint=');
  });
});

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The sign-in page keeps ONE design whoever signs people in: Supabase shows the email and password fields, Auth0 shows the same page
 * (logo, welcome text, "Sign In", "Sign in with Google", "Request a demo") with the fields removed, because the credentials are typed on
 * Auth0's own page. Rendered to static HTML so no browser or DOM library is needed.
 */
async function render(options: { auth0: boolean; accessDenied?: boolean }): Promise<string> {
  vi.resetModules();
  vi.doMock('@/lib/auth/backend', () => ({ usesAuth0: options.auth0 }));
  vi.doMock('@/lib/providers/auth', () => ({
    useAuth: () => ({ signIn: vi.fn(), signInWithGoogle: vi.fn(), signOut: vi.fn(), accessDenied: options.accessDenied ?? false }),
  }));
  vi.doMock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
  vi.doMock('next/link', () => ({ default: (props: { href: string; children?: unknown }) => createElement('a', { href: props.href }, props.children as never) }));
  vi.doMock('next/image', () => ({ default: (props: { alt: string; src: string }) => createElement('img', { alt: props.alt, src: props.src }) }));
  vi.doMock('sonner', () => ({ toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() } }));
  vi.doMock('@/lib/auth/session-idle/browser', () => ({ consumeInactivitySignOutNotice: () => false }));
  const { default: AuthPage } = await import('@/app/auth/page');
  return renderToStaticMarkup(createElement(AuthPage));
}

afterEach(() => {
  vi.doUnmock('@/lib/auth/backend');
  vi.resetModules();
});

describe('sign-in page', () => {
  it('Supabase: the original page, with email and password fields', async () => {
    const html = await render({ auth0: false });
    expect(html).toContain('Sign in your account');
    expect(html).toContain('id="email"');
    expect(html).toContain('id="password"');
    expect(html).toContain('Sign in with Google');
    expect(html).toContain('Request a demo');
  });

  it('Auth0: the same page without the fields (Auth0 asks for them), still with Sign In, Google and Request a demo', async () => {
    const html = await render({ auth0: true });
    expect(html).toContain('Sign in your account');
    expect(html).not.toContain('id="email"');
    expect(html).not.toContain('id="password"');
    expect(html).toContain('>Sign In<');
    expect(html).toContain('Sign in with Google');
    expect(html).toContain('Request a demo');
  });

  it('Auth0: someone signed in but not invited sees why, with a way out', async () => {
    const html = await render({ auth0: true, accessDenied: true });
    expect(html).toContain('has not been invited');
    expect(html).toContain('use another account');
    expect((await render({ auth0: true })).includes('has not been invited')).toBe(false);
  });
});

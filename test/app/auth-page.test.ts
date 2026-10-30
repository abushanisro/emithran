import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The sign-in page keeps its design (logo, welcome text, "Sign In", "Sign in with Google", "Request a demo") but has no credential
 * fields: credentials are typed on Auth0's own page. Rendered to static HTML so no browser or DOM library is needed.
 */
async function render(options: { accessDenied?: boolean } = {}): Promise<string> {
  vi.resetModules();
  vi.doMock('@/lib/providers/auth', () => ({
    useAuth: () => ({ signIn: vi.fn(), signInWithGoogle: vi.fn(), signOut: vi.fn(), accessDenied: options.accessDenied ?? false }),
  }));
  vi.doMock('next/link', () => ({ default: (props: { href: string; children?: unknown }) => createElement('a', { href: props.href }, props.children as never) }));
  vi.doMock('next/image', () => ({ default: (props: { alt: string; src: string }) => createElement('img', { alt: props.alt, src: props.src }) }));
  vi.doMock('sonner', () => ({ toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() } }));
  vi.doMock('@/lib/auth/session-idle/browser', () => ({ consumeInactivitySignOutNotice: () => false }));
  const { default: AuthPage } = await import('@/app/auth/page');
  return renderToStaticMarkup(createElement(AuthPage));
}

afterEach(() => {
  vi.resetModules();
});

describe('sign-in page', () => {
  it('shows Sign In, Google and Request a demo, and no credential fields', async () => {
    const html = await render();
    expect(html).toContain('Sign in your account');
    expect(html).not.toContain('id="email"');
    expect(html).not.toContain('id="password"');
    expect(html).toContain('>Sign In<');
    expect(html).toContain('Sign in with Google');
    expect(html).toContain('Request a demo');
  });

  it('someone signed in but not invited sees why, with a way out', async () => {
    const html = await render({ accessDenied: true });
    expect(html).toContain('has not been invited');
    expect(html).toContain('use another account');
    expect((await render()).includes('has not been invited')).toBe(false);
  });
});

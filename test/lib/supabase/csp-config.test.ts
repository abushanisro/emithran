import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The policy proxy.ts sends (the one definition, in every environment) must allow the configured Supabase project and nothing else.
async function csp(url: string): Promise<string> {
  vi.resetModules();
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', url);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
  const { proxy } = await import('../../../proxy');
  const response = await proxy(new NextRequest('https://app.example.test/projects'));
  const header = response.headers.get('Content-Security-Policy');
  if (!header) throw new Error('no Content-Security-Policy header');
  return header;
}

function directiveOf(policy: string, name: string): string {
  const found = policy.split('; ').find((d) => d.startsWith(name));
  if (!found) throw new Error(`no ${name} directive`);
  return found;
}

afterEach(() => vi.unstubAllEnvs());

describe('proxy content security policy', () => {
  it('allows the stage project in every directive that needs Supabase, and no other project', async () => {
    const policy = await csp('https://mhhyilxeoxzlbiytwdcm.supabase.co');
    expect(directiveOf(policy, 'connect-src')).toContain('https://mhhyilxeoxzlbiytwdcm.supabase.co');
    expect(directiveOf(policy, 'connect-src')).toContain('wss://mhhyilxeoxzlbiytwdcm.supabase.co');
    expect(policy).not.toContain('oukuetgeuuviyncsjxrk');
    expect(policy).not.toContain('*.supabase.co');
  });

  it('follows the URL: a different project gives a different policy, with no code change', async () => {
    const prd = await csp('https://udvcydhvlgjfsohueryv.supabase.co');
    expect(prd).toContain('https://udvcydhvlgjfsohueryv.supabase.co');
    expect(prd).not.toContain('mhhyilxeoxzlbiytwdcm');
  });
});

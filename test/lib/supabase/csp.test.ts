import { describe, expect, it } from 'vitest';

import { supabaseCspHosts } from '@/lib/supabase/csp';

describe('supabaseCspHosts', () => {
  it('allows exactly the configured project, for both http and websocket', () => {
    expect(supabaseCspHosts('https://mhhyilxeoxzlbiytwdcm.supabase.co')).toEqual({
      https: 'https://mhhyilxeoxzlbiytwdcm.supabase.co',
      wss: 'wss://mhhyilxeoxzlbiytwdcm.supabase.co',
    });
  });

  it('ignores a path or trailing slash on the URL', () => {
    expect(supabaseCspHosts('https://abc.supabase.co/')?.https).toBe('https://abc.supabase.co');
  });

  it('never produces a wildcard, so one environment cannot reach another project', () => {
    const hosts = supabaseCspHosts('https://abc.supabase.co');
    expect(JSON.stringify(hosts)).not.toContain('*');
  });

  it('is null when the URL is missing or not a usable URL, so nothing is allowed by accident', () => {
    for (const bad of [undefined, '', 'not a url', 'ftp://abc.supabase.co', 'javascript:alert(1)']) expect(supabaseCspHosts(bad)).toBeNull();
  });
});

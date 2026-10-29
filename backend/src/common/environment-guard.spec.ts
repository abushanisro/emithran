import { assertNotProduction, PRD_SUPABASE_HOST, productionReason } from './environment-guard';

describe('environment guard', () => {
  it('allows local and stage', () => {
    expect(productionReason({ APP_ENV: 'local', SUPABASE_URL: 'http://127.0.0.1:54321' })).toBeNull();
    expect(productionReason({ APP_ENV: 'stage', SUPABASE_URL: 'https://mhhyilxeoxzlbiytwdcm.supabase.co' })).toBeNull();
    expect(productionReason({})).toBeNull();
  });

  it('blocks APP_ENV=prd even when the URL looks harmless', () => {
    expect(productionReason({ APP_ENV: 'prd', SUPABASE_URL: 'https://mhhyilxeoxzlbiytwdcm.supabase.co' })).toMatch(/APP_ENV/);
  });

  it('blocks the production project by its URL, whatever APP_ENV says, from either variable', () => {
    expect(productionReason({ APP_ENV: 'stage', SUPABASE_URL: `https://${PRD_SUPABASE_HOST}` })).toMatch(/SUPABASE_URL/);
    expect(productionReason({ NEXT_PUBLIC_SUPABASE_URL: `https://${PRD_SUPABASE_HOST}/` })).toMatch(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(productionReason({ SUPABASE_URL: `https://${PRD_SUPABASE_HOST.toUpperCase()}` })).not.toBeNull();
  });

  it('is not fooled by a similar-looking host, and ignores an unparsable URL', () => {
    expect(productionReason({ SUPABASE_URL: `https://x${PRD_SUPABASE_HOST}` })).toBeNull();
    expect(productionReason({ SUPABASE_URL: 'not a url' })).toBeNull();
  });

  it('throws a message that says what to do', () => {
    expect(() => assertNotProduction({ APP_ENV: 'prd' })).toThrow(/Refusing to run the data-creating e2e suites.*local or stage/);
    expect(() => assertNotProduction({ APP_ENV: 'stage' })).not.toThrow();
  });
});

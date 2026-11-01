import { apiDocsEnabled, dotenvOverride } from './runtime-flags';

describe('apiDocsEnabled', () => {
  it('keeps /docs off in production', () => {
    expect(apiDocsEnabled({ NODE_ENV: 'production' })).toBe(false);
    expect(apiDocsEnabled({ NODE_ENV: 'production', ENABLE_API_DOCS: 'false' })).toBe(false);
    expect(apiDocsEnabled({ NODE_ENV: 'production', ENABLE_API_DOCS: '1' })).toBe(false); // only the exact opt-in counts
  });

  it('turns /docs on in production only when explicitly asked', () => {
    expect(apiDocsEnabled({ NODE_ENV: 'production', ENABLE_API_DOCS: 'true' })).toBe(true);
  });

  it('serves /docs in development unless switched off', () => {
    expect(apiDocsEnabled({})).toBe(true);
    expect(apiDocsEnabled({ NODE_ENV: 'development' })).toBe(true);
    expect(apiDocsEnabled({ NODE_ENV: 'development', ENABLE_API_DOCS: 'false' })).toBe(false);
  });
});

describe('dotenvOverride', () => {
  it('lets the local .env win only on a local development machine', () => {
    expect(dotenvOverride({})).toBe(true);
    expect(dotenvOverride({ NODE_ENV: 'development', APP_ENV: 'local' })).toBe(true);
  });

  it('never lets a stray .env replace what a deployment set', () => {
    expect(dotenvOverride({ NODE_ENV: 'production' })).toBe(false);
    expect(dotenvOverride({ NODE_ENV: 'production', APP_ENV: 'prd' })).toBe(false);
    expect(dotenvOverride({ APP_ENV: 'stage' })).toBe(false);
  });
});

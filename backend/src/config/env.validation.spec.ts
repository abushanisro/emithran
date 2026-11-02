import 'reflect-metadata';
import { validate } from './env.validation';

const base = {
  POSTGREST_URL: 'http://rest.invalid:3000',
  DB_JWT_SECRET: 'j'.repeat(40),
  S3_BUCKET: 'emithran',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY_ID: 'key',
  S3_SECRET_ACCESS_KEY: 'secret',
  AUTH0_DOMAIN: 'tenant.example.auth0.com',
  AUTH0_AUDIENCE: 'https://api.example.com',
  AUTH0_CLAIM_NAMESPACE: 'https://example.com/',
  AUTH0_TRUSTED_CONNECTIONS: 'company-sso,Username-Password-Authentication',
};
const production = { ...base, NODE_ENV: 'production', CORS_ORIGIN: 'https://app.example.com', APP_ENV: 'prd', BFF_FORWARD_SECRET: 'x'.repeat(32) };

describe('env validation: development auth bypass', () => {
  it('is off by default', () => {
    expect(validate(base).ALLOW_DEV_AUTH_BYPASS).toBe('false');
  });

  it('having ADMIN_FALLBACK_EMAIL set does not turn the bypass on', () => {
    expect(validate({ ...base, ADMIN_FALLBACK_EMAIL: 'dev@example.com' }).ALLOW_DEV_AUTH_BYPASS).toBe('false');
  });

  it('is on only when explicitly true outside production', () => {
    expect(validate({ ...base, ALLOW_DEV_AUTH_BYPASS: 'true' }).ALLOW_DEV_AUTH_BYPASS).toBe('true');
  });

  it('rejects any value other than true/false', () => {
    expect(() => validate({ ...base, ALLOW_DEV_AUTH_BYPASS: '1' })).toThrow(/Configuration validation error/);
  });

  it('refuses to boot in production with the bypass flag on', () => {
    expect(() => validate({ ...production, ALLOW_DEV_AUTH_BYPASS: 'true' })).toThrow(/ALLOW_DEV_AUTH_BYPASS must not be true in production/);
  });

  it('still refuses to boot in production with ADMIN_FALLBACK_EMAIL set', () => {
    expect(() => validate({ ...production, ADMIN_FALLBACK_EMAIL: 'dev@example.com' })).toThrow(/ADMIN_FALLBACK_EMAIL must not be set in production/);
  });

  it('boots in production with the bypass off', () => {
    expect(validate(production).ALLOW_DEV_AUTH_BYPASS).toBe('false');
  });
});

describe('env validation: electronics job queue in production', () => {
  it('refuses to boot in production with the in-memory queue (jobs lost on restart, not shared between instances)', () => {
    expect(() => validate({ ...production, ELECTRONICS_QUEUE_DRIVER: 'memory' })).toThrow(/ELECTRONICS_QUEUE_DRIVER=memory is for local development only/);
  });

  it('allows the in-memory queue outside production', () => {
    expect(validate({ ...base, ELECTRONICS_QUEUE_DRIVER: 'memory' }).ELECTRONICS_QUEUE_DRIVER).toBe('memory');
  });

  it('boots in production with the table queue, the default', () => {
    expect(validate(production).ELECTRONICS_QUEUE_DRIVER).toBe('table');
  });
});

describe('env validation: APP_ENV', () => {
  it('defaults to local, so a developer machine needs nothing set', () => {
    expect(validate(base).APP_ENV).toBe('local');
  });

  it('refuses a production boot that does not say whether it is stage or prd', () => {
    const { APP_ENV: _omitted, ...withoutEnv } = production;
    expect(() => validate(withoutEnv)).toThrow(/APP_ENV must be set to "stage" or "prd"/);
    expect(() => validate({ ...production, APP_ENV: 'local' })).toThrow(/APP_ENV must be set to "stage" or "prd"/);
  });

  it('accepts stage and prd in production, and rejects any other name', () => {
    expect(validate({ ...production, APP_ENV: 'stage' }).APP_ENV).toBe('stage');
    expect(validate(production).APP_ENV).toBe('prd');
    expect(() => validate({ ...production, APP_ENV: 'staging' })).toThrow(/Configuration validation error/);
  });
});

describe('required runtime settings', () => {
  it.each(['POSTGREST_URL', 'DB_JWT_SECRET', 'S3_BUCKET', 'AUTH0_DOMAIN', 'AUTH0_AUDIENCE', 'AUTH0_TRUSTED_CONNECTIONS'])('refuses to boot without %s', (name) => {
    const config: Record<string, unknown> = { ...base };
    delete config[name];
    expect(() => validate(config)).toThrow(new RegExp(name));
  });

  it.each(['', ',', 'company-sso,', 'company sso', 'company-sso;db'])('refuses AUTH0_TRUSTED_CONNECTIONS=%p (not a list of connection names)', (value) => {
    expect(() => validate({ ...base, AUTH0_TRUSTED_CONNECTIONS: value })).toThrow(/AUTH0_TRUSTED_CONNECTIONS/);
  });

  it('caches an identity decision for 10 s by default, at most 60 s, and 0 turns the cache off', () => {
    expect(validate(base).AUTH_DECISION_CACHE_SECONDS).toBe(10);
    expect(validate({ ...base, AUTH_DECISION_CACHE_SECONDS: '0' }).AUTH_DECISION_CACHE_SECONDS).toBe(0);
    expect(() => validate({ ...base, AUTH_DECISION_CACHE_SECONDS: '61' })).toThrow(/AUTH_DECISION_CACHE_SECONDS/);
    expect(() => validate({ ...base, AUTH_DECISION_CACHE_SECONDS: '-1' })).toThrow(/AUTH_DECISION_CACHE_SECONDS/);
  });

  it('needs no Supabase settings', () => {
    expect(() => validate(base)).not.toThrow();
  });
});

describe('env validation: the client address behind the BFF', () => {
  it('refuses a production boot without BFF_FORWARD_SECRET, or with a short one', () => {
    const { BFF_FORWARD_SECRET: _omitted, ...withoutSecret } = production;
    expect(() => validate(withoutSecret)).toThrow(/BFF_FORWARD_SECRET must be set in production/);
    expect(() => validate({ ...production, BFF_FORWARD_SECRET: 'short' })).toThrow(/BFF_FORWARD_SECRET/);
  });

  it('does not need the secret outside production', () => {
    expect(() => validate(base)).not.toThrow();
  });

  it('refuses TRUST_PROXY=true, and takes a hop count or proxy list', () => {
    expect(() => validate({ ...base, TRUST_PROXY: 'true' })).toThrow(/TRUST_PROXY/);
    expect(validate({ ...base, TRUST_PROXY: '1' }).TRUST_PROXY).toBe('1');
    expect(validate(base).TRUST_PROXY).toBe('0');
  });
});

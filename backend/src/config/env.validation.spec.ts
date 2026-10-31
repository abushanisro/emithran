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
};
const production = { ...base, NODE_ENV: 'production', CORS_ORIGIN: 'https://app.example.com', APP_ENV: 'prd' };

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
  it.each(['POSTGREST_URL', 'DB_JWT_SECRET', 'S3_BUCKET', 'AUTH0_DOMAIN', 'AUTH0_AUDIENCE'])('refuses to boot without %s', (name) => {
    const config: Record<string, unknown> = { ...base };
    delete config[name];
    expect(() => validate(config)).toThrow(new RegExp(name));
  });

  it('needs no Supabase settings', () => {
    expect(() => validate(base)).not.toThrow();
  });
});

import 'reflect-metadata';
import { validate } from './env.validation';

const base = {
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_ANON_KEY: 'a'.repeat(30),
  SUPABASE_SERVICE_KEY: 's'.repeat(30),
};
const production = { ...base, NODE_ENV: 'production', CORS_ORIGIN: 'https://app.example.com' };

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

  it('boots in production with pg-boss, the default', () => {
    expect(validate(production).ELECTRONICS_QUEUE_DRIVER).toBe('pg-boss');
  });
});

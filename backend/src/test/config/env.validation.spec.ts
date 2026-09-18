import 'reflect-metadata';
import { validate } from '../../config/env.validation';

function baseConfig(overrides: Record<string, unknown> = {}) {
  return {
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_ANON_KEY: 'a'.repeat(32),
    SUPABASE_SERVICE_KEY: 'b'.repeat(32),
    ...overrides,
  };
}

describe('env.validation', () => {
  it('accepts a well-formed development config', () => {
    expect(() => validate(baseConfig({ NODE_ENV: 'development' }))).not.toThrow();
  });

  it('rejects CORS_ORIGIN left at the localhost default in production', () => {
    expect(() =>
      validate(baseConfig({ NODE_ENV: 'production', CORS_ORIGIN: 'http://localhost:3000' })),
    ).toThrow(/CORS_ORIGIN must be set/);
  });

  it('rejects CORS_ORIGIN of "*" in production', () => {
    expect(() => validate(baseConfig({ NODE_ENV: 'production', CORS_ORIGIN: '*' }))).toThrow(
      /CORS_ORIGIN must be set/,
    );
  });

  it('rejects ADMIN_FALLBACK_EMAIL being set in production', () => {
    expect(() =>
      validate(
        baseConfig({
          NODE_ENV: 'production',
          CORS_ORIGIN: 'https://app.emithran.com',
          ADMIN_FALLBACK_EMAIL: 'admin@example.com',
        }),
      ),
    ).toThrow(/ADMIN_FALLBACK_EMAIL must not be set in production/);
  });

  it('accepts ADMIN_FALLBACK_EMAIL in development', () => {
    expect(() =>
      validate(
        baseConfig({
          NODE_ENV: 'development',
          ADMIN_FALLBACK_EMAIL: 'admin@example.com',
        }),
      ),
    ).not.toThrow();
  });

  it('accepts a correctly configured production environment', () => {
    expect(() =>
      validate(
        baseConfig({
          NODE_ENV: 'production',
          CORS_ORIGIN: 'https://app.emithran.com',
        }),
      ),
    ).not.toThrow();
  });
});

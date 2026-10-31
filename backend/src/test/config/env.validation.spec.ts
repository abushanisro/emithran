import 'reflect-metadata';
import { validate } from '../../config/env.validation';

function baseConfig(overrides: Record<string, unknown> = {}) {
  return {
    POSTGREST_URL: 'http://rest.invalid:3000',
    DB_JWT_SECRET: 'j'.repeat(40),
    S3_BUCKET: 'emithran',
    S3_REGION: 'us-east-1',
    S3_ACCESS_KEY_ID: 'key',
    S3_SECRET_ACCESS_KEY: 'secret',
    AUTH0_DOMAIN: 'tenant.example.auth0.com',
    AUTH0_AUDIENCE: 'https://api.example.com',
    AUTH0_CLAIM_NAMESPACE: 'https://example.com/',
    ...overrides,
  };
}

describe('env.validation', () => {
  it('accepts a well-formed development config', () => {
    expect(() => validate(baseConfig({ NODE_ENV: 'development' }))).not.toThrow();
  });

  it('rejects CORS_ORIGIN left at the localhost default in production', () => {
    expect(() =>
      validate(baseConfig({ NODE_ENV: 'production', APP_ENV: 'prd', CORS_ORIGIN: 'http://localhost:3000' })),
    ).toThrow(/CORS_ORIGIN must be set/);
  });

  it('rejects CORS_ORIGIN of "*" in production', () => {
    expect(() => validate(baseConfig({ NODE_ENV: 'production', APP_ENV: 'prd', CORS_ORIGIN: '*' }))).toThrow(
      /CORS_ORIGIN must be set/,
    );
  });

  it('rejects ADMIN_FALLBACK_EMAIL being set in production', () => {
    expect(() =>
      validate(
        baseConfig({
          NODE_ENV: 'production', APP_ENV: 'prd',
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
          NODE_ENV: 'production', APP_ENV: 'prd',
          CORS_ORIGIN: 'https://app.emithran.com',
        }),
      ),
    ).not.toThrow();
  });
});

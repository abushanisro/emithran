import { describe, expect, it } from 'vitest';

import { assertAuth0Config, auth0ConfigProblems, AUTH0_SESSION } from '@/lib/auth0-config';

const good = {
  AUTH0_DOMAIN: 'tenant.eu.auth0.com',
  AUTH0_CLIENT_ID: 'id',
  AUTH0_CLIENT_SECRET: 'secret',
  AUTH0_SECRET: 'a'.repeat(64),
  AUTH0_AUDIENCE: 'https://api.emithran.com',
  APP_BASE_URL: 'http://localhost:3000',
};

describe('Auth0 settings check', () => {
  it('accepts a complete configuration', () => {
    expect(auth0ConfigProblems(good)).toEqual([]);
    expect(() => {
      assertAuth0Config(good);
    }).not.toThrow();
  });

  it('names every missing setting at once', () => {
    expect(auth0ConfigProblems({})).toHaveLength(6);
    expect(() => {
      assertAuth0Config({});
    }).toThrow(/AUTH0_DOMAIN is not set[\s\S]*APP_BASE_URL is not set/);
  });

  it('rejects placeholders, a short secret, a URL as domain, and a path in the base URL', () => {
    const problems = auth0ConfigProblems({
      ...good,
      AUTH0_CLIENT_SECRET: 'REPLACE_ME',
      AUTH0_SECRET: 'short',
      AUTH0_DOMAIN: 'https://tenant.eu.auth0.com/',
      APP_BASE_URL: 'http://localhost:3000/app',
    });
    expect(problems).toHaveLength(4);
  });

  it('requires https for the app in production', () => {
    expect(auth0ConfigProblems({ ...good, NODE_ENV: 'production' })).toEqual(['APP_BASE_URL must be https in production']);
  });

  it("keeps Auth0's cookie alive longer than the backend's 30-minute idle timer", () => {
    expect(AUTH0_SESSION.inactivityDuration).toBeGreaterThan(30 * 60);
    expect(AUTH0_SESSION.absoluteDuration).toBeGreaterThanOrEqual(AUTH0_SESSION.inactivityDuration);
  });
});

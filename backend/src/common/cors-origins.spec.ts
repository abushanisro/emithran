import { isAllowedCorsOrigin } from './cors-origins';

describe('isAllowedCorsOrigin', () => {
  const production = { nodeEnv: 'production', corsOrigin: 'https://app.example.com' };

  it('refuses the local frontend in production, even with CORS_ORIGIN unset', () => {
    for (const origin of ['http://localhost:3000', 'http://127.0.0.1:3000']) {
      expect(isAllowedCorsOrigin(origin, production)).toBe(false);
      expect(isAllowedCorsOrigin(origin, { nodeEnv: 'production' })).toBe(false);
    }
  });

  it('allows the local frontend outside production', () => {
    for (const nodeEnv of ['development', 'test', undefined]) {
      expect(isAllowedCorsOrigin('http://localhost:3000', { nodeEnv })).toBe(true);
      expect(isAllowedCorsOrigin('http://127.0.0.1:3000', { nodeEnv })).toBe(true);
    }
  });

  it('allows the configured origin, the Railway domain and the hosted frontends in production', () => {
    const settings = { ...production, railwayPublicDomain: 'api.up.railway.app' };
    expect(isAllowedCorsOrigin('https://app.example.com', settings)).toBe(true);
    expect(isAllowedCorsOrigin('https://api.up.railway.app', settings)).toBe(true);
    expect(isAllowedCorsOrigin('https://mithran-abc123.vercel.app', settings)).toBe(true);
    expect(isAllowedCorsOrigin('https://app.emithran.com', settings)).toBe(true);
  });

  it('matches exactly, never by prefix', () => {
    expect(isAllowedCorsOrigin('http://localhost:3000.attacker.example', { nodeEnv: 'development' })).toBe(false);
    expect(isAllowedCorsOrigin('https://app.example.com.attacker.example', production)).toBe(false);
    expect(isAllowedCorsOrigin('https://emithran.com.attacker.example', production)).toBe(false);
    expect(isAllowedCorsOrigin('https://other.example', production)).toBe(false);
  });

  it('allows requests without an Origin header (not a cross-origin browser request)', () => {
    expect(isAllowedCorsOrigin(undefined, production)).toBe(true);
  });
});

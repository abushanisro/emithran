import { tenantDrift, type TenantExpectation, type TenantSnapshot } from './auth0-tenant-rules';

const expected: TenantExpectation = { appBaseUrl: 'http://localhost:3000/', dbConnection: 'Username-Password-Authentication', actionName: 'emithran-claims' };
const healthy = (): TenantSnapshot => ({
  client: { app_type: 'regular_web', callbacks: ['http://localhost:3000/auth/callback'], allowed_logout_urls: ['http://localhost:3000'] },
  connections: [
    { name: 'Username-Password-Authentication', strategy: 'auth0', options: { disable_signup: true } },
    { name: 'emithran-auth', strategy: 'google-apps' },
  ],
  api: { signing_alg: 'RS256' },
  grantExists: true,
  actionDeployed: true,
  actionBound: true,
});

describe('tenantDrift', () => {
  it('is quiet for the intended tenant', () => {
    expect(tenantDrift(healthy(), expected)).toEqual([]);
  });

  it('flags open sign-up and an enabled Google social login (the drift found on 5 Nov)', () => {
    const snapshot = healthy();
    snapshot.connections = [
      { name: 'Username-Password-Authentication', strategy: 'auth0', options: { disable_signup: false } },
      { name: 'google-oauth2', strategy: 'google-oauth2' },
    ];
    const problems = tenantDrift(snapshot, expected);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/sign-up is ON/);
    expect(problems[1]).toMatch(/google-oauth2.*social login must be off/);
  });

  it('flags wrong URLs, wildcards, a missing grant and an unbound Action', () => {
    const snapshot = healthy();
    snapshot.client = { app_type: 'regular_web', callbacks: ['https://*.example.com/auth/callback'], allowed_logout_urls: [] };
    snapshot.grantExists = false;
    snapshot.actionBound = false;
    expect(tenantDrift(snapshot, expected)).toHaveLength(5);
  });

  it('flags a non-RS256 API', () => {
    const snapshot = healthy();
    snapshot.api = { signing_alg: 'HS256' };
    expect(tenantDrift(snapshot, expected)).toEqual([expect.stringMatching(/HS256/)]);
  });
});

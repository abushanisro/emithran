import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK, type KeyLike } from 'jose';

import { Auth0TokenVerifier, TokenRejected } from './auth0-token-verifier';

const ISSUER = 'https://emithran.eu.auth0.com/';
const AUDIENCE = 'https://api.emithran.com';
const NS = 'https://emithran.com/';

interface Signer { key: KeyLike; kid: string; jwk: JWK }
async function signer(kid: string): Promise<Signer> {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  return { key: privateKey, kid, jwk: { ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' } };
}

let tenant: Signer;
let verifier: Auth0TokenVerifier;
const mint = (over: Record<string, unknown> = {}, opts: { signer?: Signer; issuer?: string; audience?: string; expires?: string | number; alg?: string } = {}) => {
  const s = opts.signer ?? tenant;
  const jwt = new SignJWT({ [`${NS}email`]: 'Alice@Example.com', [`${NS}email_verified`]: true, [`${NS}sid`]: 'sess-1', ...over })
    .setProtectedHeader({ alg: opts.alg ?? 'RS256', kid: s.kid })
    .setIssuer(opts.issuer ?? ISSUER)
    .setAudience(opts.audience ?? AUDIENCE)
    .setSubject('sub' in over ? (over.sub as string) : 'auth0|alice')
    .setIssuedAt()
    .setExpirationTime(opts.expires ?? '10m');
  return jwt.sign(s.key);
};
const rejection = async (token: string): Promise<TokenRejected> => {
  try {
    await verifier.verify(token);
  } catch (error) {
    expect(error).toBeInstanceOf(TokenRejected);
    return error as TokenRejected;
  }
  throw new Error('the token was accepted');
};

beforeAll(async () => {
  tenant = await signer('tenant-key-1');
  verifier = new Auth0TokenVerifier({ issuer: ISSUER, audience: AUDIENCE, claimNamespace: NS, keys: createLocalJWKSet({ keys: [tenant.jwk] }) });
});

describe('Auth0TokenVerifier', () => {
  it('accepts a good token and reads the login: sub, lower-cased verified email, session id', async () => {
    const login = await verifier.verify(await mint());
    expect(login).toMatchObject({ provider: 'auth0', sub: 'auth0|alice', email: 'alice@example.com', emailVerified: true, sessionId: 'sess-1' });
    expect(login.expiresAt).toBeGreaterThan(Date.now() / 1000);
  });

  it('treats a missing or false email_verified as unverified (so the identity can never be linked by email)', async () => {
    expect((await verifier.verify(await mint({ [`${NS}email_verified`]: false }))).emailVerified).toBe(false);
    expect((await verifier.verify(await mint({ [`${NS}email_verified`]: 'true' }))).emailVerified).toBe(false); // a string is not a yes
    expect((await verifier.verify(await mint({ [`${NS}email_verified`]: undefined }))).emailVerified).toBe(false);
  });

  it('ignores un-namespaced email, email_verified and sid claims (only the post-login Action\'s namespaced claims count)', async () => {
    const login = await verifier.verify(await mint({
      [`${NS}email`]: undefined, [`${NS}email_verified`]: undefined, [`${NS}sid`]: undefined,
      email: 'mallory@example.com', email_verified: true, sid: 'plain-sid',
    }));
    expect(login.email).toBeUndefined();
    expect(login.emailVerified).toBe(false);
    expect(login.sessionId).toBeUndefined();
  });

  it('works without any custom claims (the email is then simply unknown)', async () => {
    const login = await verifier.verify(await mint({ [`${NS}email`]: undefined, [`${NS}email_verified`]: undefined, [`${NS}sid`]: undefined }));
    expect(login.email).toBeUndefined();
    expect(login.sessionId).toBeUndefined();
  });

  it.each([
    ['an expired token', () => mint({}, { expires: Math.floor(Date.now() / 1000) - 3600 }), 'expired'],
    ['a token for another API', () => mint({}, { audience: 'https://other.example.com' }), 'wrong_audience'],
    ['a token from another issuer', () => mint({}, { issuer: 'https://evil.example.com/' }), 'wrong_issuer'],
    ['a token without a subject', () => mint({ sub: '' }), 'no_subject'],
  ])('rejects %s', async (_label, make, code) => {
    expect((await rejection(await make())).code).toBe(code);
  });

  it('rejects a token signed by someone else even when it copies the tenant\'s key id', async () => {
    const attacker = await signer('tenant-key-1');
    expect((await rejection(await mint({}, { signer: attacker }))).code).toBe('bad_signature');
  });

  it('rejects an unknown key id (a rotated-out or invented key)', async () => {
    const stranger = await signer('never-published');
    expect((await rejection(await mint({}, { signer: stranger }))).code).toBe('bad_signature');
  });

  it('accepts a newly rotated-in key once it is published, and still the old one during the overlap', async () => {
    const next = await signer('tenant-key-2');
    const rotating = new Auth0TokenVerifier({ issuer: ISSUER, audience: AUDIENCE, claimNamespace: NS, keys: createLocalJWKSet({ keys: [tenant.jwk, next.jwk] }) });
    await expect(rotating.verify(await mint({}, { signer: next }))).resolves.toMatchObject({ sub: 'auth0|alice' });
    await expect(rotating.verify(await mint())).resolves.toMatchObject({ sub: 'auth0|alice' });
  });

  it('does not accept an HMAC token made with the public key as the secret (algorithm confusion) or "alg: none"', async () => {
    const hmac = await new SignJWT({}).setProtectedHeader({ alg: 'HS256', kid: tenant.kid }).setIssuer(ISSUER).setAudience(AUDIENCE).setSubject('auth0|alice')
      .setExpirationTime('10m').sign(new TextEncoder().encode(JSON.stringify(tenant.jwk)));
    expect((await rejection(hmac)).code).toBe('bad_signature');
    const none = [Buffer.from('{"alg":"none"}').toString('base64url'), Buffer.from(JSON.stringify({ sub: 'auth0|alice', iss: ISSUER, aud: AUDIENCE, exp: 9_999_999_999 })).toString('base64url'), ''].join('.');
    expect(['bad_signature', 'malformed']).toContain((await rejection(none)).code);
  });

  it.each(['', 'abc', 'a.b', 'a.b.c.d'])('rejects the malformed token %p', async (token) => {
    expect((await rejection(token)).code).toBe('malformed');
  });

  it('reports a key set it cannot fetch as a service failure (503), not as a bad login (401)', async () => {
    const down = new Auth0TokenVerifier({ issuer: ISSUER, audience: AUDIENCE, claimNamespace: NS, keys: async () => { throw new Error('fetch failed: ENOTFOUND emithran.eu.auth0.com'); } });
    const error = await down.verify(await mint()).catch((e: unknown) => e as TokenRejected);
    expect(error).toBeInstanceOf(TokenRejected);
    expect((error as TokenRejected).code).toBe('keys_unavailable');
    expect((error as TokenRejected).isServiceFailure).toBe(true);
  });

  it('builds the tenant issuer and JWKS address from a bare domain', () => {
    expect(() => Auth0TokenVerifier.forTenant('emithran.eu.auth0.com', AUDIENCE, NS)).not.toThrow();
  });
});

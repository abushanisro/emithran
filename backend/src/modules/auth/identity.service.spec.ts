import { ForbiddenException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';

import { Auth0TokenVerifier, TokenRejected, type VerifiedLogin } from './auth0-token-verifier';
import { IdentityService } from './identity.service';
import { sessionKeyFromAuth0Sid } from './session-key';

const USER = '11111111-1111-4111-8111-111111111111';
const login = (over: Partial<VerifiedLogin> = {}): VerifiedLogin => ({ provider: 'auth0', sub: 'auth0|a', email: 'a@x.com', emailVerified: true, sessionId: 's1', connection: 'company-sso', expiresAt: 9e9, ...over });
const TRUSTED = ['company-sso', 'Username-Password-Authentication'];

function build(opts: { login?: VerifiedLogin | TokenRejected; linked?: unknown; accountEmail?: unknown; linkError?: boolean; accountError?: boolean; ttlMs?: number } = {}) {
  const verify = jest.fn(async () => { if (opts.login instanceof TokenRejected) throw opts.login; return opts.login ?? login(); });
  const rpc = jest.fn(async (fn: string) => {
    if (fn === 'link_identity') return opts.linkError ? { data: null, error: { message: 'x' } } : { data: 'linked' in opts ? opts.linked : USER, error: null };
    if (fn === 'identity_user_email') return opts.accountError ? { data: null, error: { message: 'x' } } : { data: 'accountEmail' in opts ? opts.accountEmail : 'a@x.com', error: null };
    throw new Error(`unexpected rpc ${fn}`);
  });
  const db = { getPrivilegedClient: jest.fn(() => ({ rpc })), mintDbUserToken: jest.fn((id: string) => `db-token-for-${id}`) };
  let t = 1_000;
  const service = new IdentityService({ verify } as unknown as Auth0TokenVerifier, db as never, { trustedConnections: TRUSTED, decisionTtlMs: opts.ttlMs ?? 10_000 }, () => t);
  return { service, verify, rpc, db, advance: (ms: number) => { t += ms; } };
}

describe('IdentityService', () => {
  it('maps a verified login to the internal user and a database token', async () => {
    const { service, rpc, db } = build();
    const r = await service.authenticate('tok');
    expect(r).toMatchObject({ user: { id: USER, email: 'a@x.com', role: 'authenticated' }, dbToken: `db-token-for-${USER}`, sessionId: sessionKeyFromAuth0Sid('s1') });
    expect(rpc).toHaveBeenCalledWith('link_identity', {
      p_provider: 'auth0', p_sub: 'auth0|a', p_email: 'a@x.com', p_email_verified: true, p_connection: 'company-sso', p_trusted_connections: TRUSTED,
    });
    expect(db.mintDbUserToken).toHaveBeenCalledWith(USER, { email: 'a@x.com', sessionId: sessionKeyFromAuth0Sid('s1') });
  });

  it('hands the database the login\'s connection and the configured allow-list, so it decides whether a new login may link', async () => {
    const { service, rpc } = build({ login: login({ connection: 'google-oauth2' }), linked: null });
    await expect(service.authenticate('t')).rejects.toBeInstanceOf(ForbiddenException);
    expect(rpc).toHaveBeenCalledWith('link_identity', expect.objectContaining({ p_connection: 'google-oauth2', p_trusted_connections: TRUSTED }));
  });

  it('sends no connection when the token carries none (the database then refuses to link a new login)', async () => {
    const { service, rpc } = build({ login: login({ connection: undefined }) });
    await service.authenticate('t');
    expect(rpc).toHaveBeenCalledWith('link_identity', expect.objectContaining({ p_connection: null }));
  });

  it('refuses to start without a trusted connection or with a meaningless cache lifetime', () => {
    const make = (policy: { trustedConnections: string[]; decisionTtlMs: number }) => () => new IdentityService({} as Auth0TokenVerifier, {} as never, policy);
    expect(make({ trustedConnections: [], decisionTtlMs: 0 })).toThrow(/trusted Auth0 connection/);
    expect(make({ trustedConnections: [' ', ''], decisionTtlMs: 0 })).toThrow(/trusted Auth0 connection/);
    expect(make({ trustedConnections: TRUSTED, decisionTtlMs: -1 })).toThrow(/decisionTtlMs/);
  });

  it('binds the account email (auth.users), never the token email claim, into the request user and the database token', async () => {
    const { service, rpc, db } = build({ login: login({ email: 'b@x.com', emailVerified: false }), accountEmail: 'a@x.com' });
    const r = await service.authenticate('tok');
    expect(rpc).toHaveBeenCalledWith('identity_user_email', { p_user_id: USER });
    expect(r.user.email).toBe('a@x.com');
    expect(db.mintDbUserToken).toHaveBeenCalledWith(USER, { email: 'a@x.com', sessionId: sessionKeyFromAuth0Sid('s1') });
  });

  it('403s when the account has no email to bind (fails closed)', async () => {
    await expect(build({ accountEmail: '' }).service.authenticate('t')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('sends the verified flag through untouched, so an unverified email can never link (the database decides)', async () => {
    const { service, rpc } = build({ login: login({ emailVerified: false }), linked: null });
    await expect(service.authenticate('t')).rejects.toBeInstanceOf(ForbiddenException);
    expect(rpc).toHaveBeenCalledWith('link_identity', expect.objectContaining({ p_email_verified: false }));
  });

  it('refuses a login with no session id (the inactivity timeout could not run), without touching the database', async () => {
    const b = build({ login: login({ sessionId: undefined }) });
    await expect(b.service.authenticate('t')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(b.rpc).not.toHaveBeenCalled();
  });

  it('403s someone nobody invited, and someone no longer authorised', async () => {
    await expect(build({ linked: null }).service.authenticate('t')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(build({ accountEmail: null }).service.authenticate('t')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('401s a bad token without touching the database', async () => {
    const b = build({ login: new TokenRejected('expired', 'x') });
    await expect(b.service.authenticate('t')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(b.rpc).not.toHaveBeenCalled();
  });

  it('503s when Auth0 keys or the database cannot be reached (never a 401/403 verdict on the person)', async () => {
    await expect(build({ login: new TokenRejected('keys_unavailable', 'x') }).service.authenticate('t')).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(build({ linkError: true }).service.authenticate('t')).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(build({ accountError: true }).service.authenticate('t')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('reuses a decision only for the configured lifetime, so a user removed from the allow-list loses access within it', async () => {
    const b = build({ ttlMs: 10_000 });
    await b.service.authenticate('t');
    b.advance(9_999);
    await b.service.authenticate('t');
    expect(b.rpc).toHaveBeenCalledTimes(2); // link + account email, once
    b.advance(1);
    b.rpc.mockImplementation(async (fn: string) => (fn === 'identity_user_email' ? { data: null, error: null } : { data: USER, error: null }));
    await expect(b.service.authenticate('t')).rejects.toBeInstanceOf(ForbiddenException); // deactivated: refused at the next check
  });

  it('asks the database on every request when the cache is off (lifetime 0)', async () => {
    const b = build({ ttlMs: 0 });
    await b.service.authenticate('t');
    await b.service.authenticate('t');
    expect(b.rpc).toHaveBeenCalledTimes(4);
  });

  it('does not reuse a decision when the connection changes', async () => {
    const b = build();
    await b.service.authenticate('t');
    b.verify.mockResolvedValueOnce(login({ connection: 'Username-Password-Authentication' }));
    await b.service.authenticate('t');
    expect(b.rpc.mock.calls.filter(([f]) => f === 'link_identity')).toHaveLength(2);
  });

  it('does not reuse a decision when the login facts change (email verified later)', async () => {
    const b = build({ login: login({ emailVerified: false }) });
    await b.service.authenticate('t').catch(() => undefined);
    b.verify.mockResolvedValueOnce(login({ emailVerified: true }));
    await b.service.authenticate('t');
    expect(b.rpc).toHaveBeenCalledWith('link_identity', expect.objectContaining({ p_email_verified: true }));
  });

  it('does not cache a refusal as a success', async () => {
    const b = build({ linked: null });
    await b.service.authenticate('t').catch(() => undefined);
    await b.service.authenticate('t').catch(() => undefined);
    expect(b.rpc.mock.calls.filter(([f]) => f === 'link_identity')).toHaveLength(2);
  });
});

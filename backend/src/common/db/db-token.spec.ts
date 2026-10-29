import { DbTokenMinter, verifyDbToken } from './db-token';

const SECRET = 'x'.repeat(40);
const USER = '11111111-1111-1111-1111-111111111111';

describe('DbTokenMinter', () => {
  it('signs a user token PostgREST can verify: sub is the user uuid, role is authenticated', () => {
    const minter = new DbTokenMinter(SECRET);
    const claims = verifyDbToken(minter.forUser(USER, { email: 'a@example.com', sessionId: 's1' }), SECRET);
    expect(claims).toMatchObject({ sub: USER, role: 'authenticated', email: 'a@example.com', session_id: 's1', iss: 'emithran-backend' });
  });

  it('signs a service token with no user: role service_role only', () => {
    const claims = verifyDbToken(new DbTokenMinter(SECRET).forService(), SECRET);
    expect(claims.role).toBe('service_role');
    expect(claims.sub).toBeUndefined();
  });

  it('rejects a wrong secret, a tampered payload and a malformed token', () => {
    const token = new DbTokenMinter(SECRET).forUser(USER);
    expect(() => verifyDbToken(token, 'y'.repeat(40))).toThrow('bad signature');
    const [h, , s] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ sub: USER, role: 'service_role', exp: 9_999_999_999 })).toString('base64url');
    expect(() => verifyDbToken(`${h}.${forged}.${s}`, SECRET)).toThrow('bad signature');
    expect(() => verifyDbToken('abc.def', SECRET)).toThrow('not a JWT');
  });

  it('expires: a token is rejected after its lifetime', () => {
    let now = 1_800_000_000_000;
    const minter = new DbTokenMinter(SECRET, 300, () => now);
    const token = minter.forUser(USER);
    expect(() => verifyDbToken(token, SECRET, now + 299_000)).not.toThrow();
    expect(() => verifyDbToken(token, SECRET, now + 301_000)).toThrow('expired');
  });

  it('reuses a token until 30 s before it expires, then issues a fresh one', () => {
    let now = 1_800_000_000_000;
    const minter = new DbTokenMinter(SECRET, 300, () => now);
    const first = minter.forUser(USER);
    now += 200_000;
    expect(minter.forUser(USER)).toBe(first);
    now += 80_000; // 280 s: inside the last 30 s
    const renewed = minter.forUser(USER);
    expect(renewed).not.toBe(first);
    expect(() => verifyDbToken(renewed, SECRET, now)).not.toThrow();
  });

  it('keeps tokens of different users apart', () => {
    const minter = new DbTokenMinter(SECRET);
    const other = '22222222-2222-2222-2222-222222222222';
    expect(verifyDbToken(minter.forUser(other), SECRET).sub).toBe(other);
    expect(minter.forUser(USER)).not.toBe(minter.forUser(other));
  });

  it.each([
    ['a short secret', () => new DbTokenMinter('short')],
    ['a lifetime under a minute', () => new DbTokenMinter(SECRET, 10)],
    ['a lifetime over an hour', () => new DbTokenMinter(SECRET, 7200)],
    ['a user id that is not a uuid', () => new DbTokenMinter(SECRET).forUser('auth0|abc')],
  ])('refuses %s', (_label, make) => {
    expect(make).toThrow();
  });
});

import { evictOldestIfFull } from '../../../common/cache/bounded-map';
import { decodeJwtPayload, jwtExpiryMs } from '../../../common/database/jwt-payload';

describe('evictOldestIfFull', () => {
  it('drops only the oldest entry when the map is full', () => {
    const map = new Map([['a', 1], ['b', 2], ['c', 3]]);
    evictOldestIfFull(map, 3);
    expect([...map.keys()]).toEqual(['b', 'c']);
  });

  it('leaves a map below its cap untouched', () => {
    const map = new Map([['a', 1]]);
    evictOldestIfFull(map, 3);
    expect([...map.keys()]).toEqual(['a']);
  });
});

describe('decodeJwtPayload / jwtExpiryMs', () => {
  const token = (claims: object) => ['h', Buffer.from(JSON.stringify(claims)).toString('base64url'), 's'].join('.');

  it('reads the claims and the expiry of a token', () => {
    expect(decodeJwtPayload(token({ session_id: 's1', exp: 100 }))).toEqual({ session_id: 's1', exp: 100 });
    expect(jwtExpiryMs(token({ exp: 100 }))).toBe(100_000);
  });

  it('returns null for anything that is not a JWT payload object', () => {
    expect(decodeJwtPayload('not-a-jwt')).toBeNull();
    expect(decodeJwtPayload(['h', Buffer.from('42').toString('base64url'), 's'].join('.'))).toBeNull();
    expect(jwtExpiryMs(token({}))).toBeNull();
  });
});

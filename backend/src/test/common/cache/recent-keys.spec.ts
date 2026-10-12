import { RecentKeys } from '../../../common/cache/recent-keys';

describe('RecentKeys', () => {
  it('lets a key through once per window, and lets distinct keys through separately', () => {
    const keys = new RecentKeys(1000, 10);
    expect(keys.firstSeen('gap-a', 0)).toBe(true);
    expect(keys.firstSeen('gap-a', 500)).toBe(false);
    expect(keys.firstSeen('gap-b', 500)).toBe(true);
  });

  it('lets the key through again once the window has passed, and restarts the window', () => {
    const keys = new RecentKeys(1000, 10);
    keys.firstSeen('gap-a', 0);
    expect(keys.firstSeen('gap-a', 1000)).toBe(true);
    expect(keys.firstSeen('gap-a', 1500)).toBe(false);
  });

  it('is bounded: the oldest key is forgotten when it is full', () => {
    const keys = new RecentKeys(10_000, 2);
    keys.firstSeen('a', 0);
    keys.firstSeen('b', 1);
    keys.firstSeen('c', 2);
    expect(keys.firstSeen('a', 3)).toBe(true);
    expect(keys.firstSeen('c', 3)).toBe(false);
  });
});

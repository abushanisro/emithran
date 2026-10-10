import { beforeEach, describe, expect, it } from 'vitest';

import { checkRateLimit, resetRateLimits } from '@/lib/server/rate-limit';

describe('checkRateLimit', () => {
  beforeEach(resetRateLimits);

  it('allows up to the limit in a window, then refuses with a retry time', () => {
    for (let i = 0; i < 3; i++) expect(checkRateLimit('u1', 3, 60_000, 1_000).allowed).toBe(true);
    const blocked = checkRateLimit('u1', 3, 60_000, 2_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBe(59);
  });

  it('starts a fresh window once the old one ends', () => {
    for (let i = 0; i < 3; i++) checkRateLimit('u1', 3, 60_000, 1_000);
    expect(checkRateLimit('u1', 3, 60_000, 61_001).allowed).toBe(true);
  });

  it('counts each key on its own', () => {
    for (let i = 0; i < 3; i++) checkRateLimit('u1', 3, 60_000, 1_000);
    expect(checkRateLimit('u2', 3, 60_000, 1_000).allowed).toBe(true);
  });
});

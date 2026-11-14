import { describe, expect, it } from 'vitest';

import { BACKOFF_CAP_MS, pollDelay } from '@/lib/api/poll-backoff';

describe('pollDelay', () => {
  it('polls at the normal rate while answers are good', () => {
    expect(pollDelay(2000, false, 0)).toBe(2000);
    expect(pollDelay(2000, false, 7)).toBe(2000); // old failures do not matter once the last answer was good
  });

  it('doubles the wait with each failure in a row while the last answer failed', () => {
    expect(pollDelay(2000, true, 1)).toBe(4000);
    expect(pollDelay(2000, true, 2)).toBe(8000);
    expect(pollDelay(2000, true, 3)).toBe(16000);
  });

  it('never waits longer than the cap, however many failures', () => {
    expect(pollDelay(2000, true, 4)).toBe(BACKOFF_CAP_MS);
    expect(pollDelay(2000, true, 1000)).toBe(BACKOFF_CAP_MS);
    expect(pollDelay(1000, true, 50)).toBe(BACKOFF_CAP_MS);
  });

  it('treats a failed answer with no count yet as the first failure', () => {
    expect(pollDelay(2000, true, 0)).toBe(4000);
  });
});

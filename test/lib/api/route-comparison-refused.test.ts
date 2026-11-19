import { describe, expect, it } from 'vitest';

import { comparisonRefused } from '@/lib/api/hooks/useBOMItems';

describe('comparisonRefused', () => {
  it('a 4xx is a refusal of the part as it is now (FusionComponent moved to Bar and Tube Fabrication: 400, no cost model)', () => {
    expect(comparisonRefused({ statusCode: 400 })).toBe(true);
    expect(comparisonRefused({ statusCode: 409 })).toBe(true);
  });

  it('a timeout, a server error or a network failure keeps the last good routes', () => {
    expect(comparisonRefused({ statusCode: 504 })).toBe(false);
    expect(comparisonRefused({ statusCode: 500 })).toBe(false);
    expect(comparisonRefused(new Error('network'))).toBe(false);
    expect(comparisonRefused(null)).toBe(false);
  });
});

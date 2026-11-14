import { describe, expect, it } from 'vitest';

import { formatPerPartCost } from '@/lib/costing/format-cost';

describe('formatPerPartCost', () => {
  it('four decimals from a cent up', () => {
    expect(formatPerPartCost(1.69)).toBe('1.6900');
    expect(formatPerPartCost(0.0123)).toBe('0.0123');
  });

  it('two significant figures below a cent: a fraction of a cent is never shown as 0.0000', () => {
    expect(formatPerPartCost(0.00081)).toBe('0.00081');
    expect(formatPerPartCost(0.0000123)).toBe('0.000012');
    expect(formatPerPartCost(0.0029)).toBe('0.0029');
  });

  it('zero is zero', () => {
    expect(formatPerPartCost(0)).toBe('0.00');
  });
});

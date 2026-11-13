import { describe, expect, it } from 'vitest';

import { formatCycleMin } from '@/lib/costing/format-cycle';

describe('formatCycleMin', () => {
  it('minutes from a minute up, seconds below', () => {
    expect(formatCycleMin(2)).toBe('2.0 min');
    expect(formatCycleMin(22 / 60)).toBe('22.0 s');
    expect(formatCycleMin(0.5 / 60)).toBe('0.5 s');
  });

  it('a few milliseconds keep their figures instead of reading 0.0 s', () => {
    expect(formatCycleMin(0.0041 / 60)).toBe('0.0041 s');
    expect(formatCycleMin(0.05 / 60)).toBe('0.05 s');
  });

  it('nothing resolved reads 0.0 min', () => {
    expect(formatCycleMin(0)).toBe('0.0 min');
    expect(formatCycleMin(null)).toBe('0.0 min');
  });
});

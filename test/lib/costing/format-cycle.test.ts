import { describe, expect, it } from 'vitest';

import { formatCycleMin, formatCycleSec, formatStoredCycleSec, storableCycleSec } from '@/lib/costing/format-cycle';

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

describe('formatCycleSec', () => {
  it('whole seconds from a second up, two significant figures below: a short step is never "0 sec"', () => {
    expect(formatCycleSec(22.4)).toBe('22 sec');
    expect(formatCycleSec(0.23)).toBe('0.23 sec');
    expect(formatCycleSec(0.0041)).toBe('0.0041 sec');
    expect(formatCycleSec(0)).toBe('0 sec');
  });
});

describe('storableCycleSec / formatStoredCycleSec', () => {
  it('keeps a casting\'s few-millisecond furnace share at the four decimals the column stores, never 0', () => {
    expect(storableCycleSec(0.004092)).toBe(0.0041);
    expect(storableCycleSec(19.2)).toBe(19.2);
    expect(formatStoredCycleSec(0.004092)).toBe('0.0041 sec');
    expect(formatStoredCycleSec(19.2)).toBe('19.2 sec');
    expect(formatStoredCycleSec(0)).toBe('0 sec');
  });
});

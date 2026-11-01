import { describe, expect, it } from 'vitest';

import { rankAscending, weightedRankScore } from '@/lib/utils/rank';
import { requiredSetting, settingWithDevDefault } from '@/lib/utils/required-setting';

describe('settingWithDevDefault', () => {
  it('uses the configured value in any environment', () => {
    expect(settingWithDevDefault('https://api.example.com', 'API_URL', 'http://localhost:4000', 'production'))
      .toBe('https://api.example.com');
  });

  it('falls back to localhost only outside production', () => {
    expect(settingWithDevDefault(undefined, 'API_URL', 'http://localhost:4000', 'development')).toBe('http://localhost:4000');
    expect(settingWithDevDefault('', 'API_URL', 'http://localhost:4000', 'test')).toBe('http://localhost:4000');
  });

  it('throws naming the variable when it is missing in production', () => {
    expect(() => settingWithDevDefault(undefined, 'API_URL', 'http://localhost:4000', 'production')).toThrow(/API_URL/);
    expect(() => settingWithDevDefault('  ', 'CAD_ENGINE_URL', 'http://localhost:5055', 'production')).toThrow(/CAD_ENGINE_URL/);
  });

  it('requiredSetting throws in every environment', () => {
    expect(() => requiredSetting(undefined, 'X_URL')).toThrow(/X_URL/);
    expect(requiredSetting('v', 'X_URL')).toBe('v');
  });
});

describe('rankAscending', () => {
  it('ranks present values and leaves missing ones unranked', () => {
    // Vendor 2 has no price: it must not rank first as if it cost 0.
    expect(rankAscending([12, null, 10, 0, undefined])).toEqual([2, 0, 1, 0, 0]);
  });
});

describe('weightedRankScore', () => {
  it('weights the ranks and is 0 when any rank is missing', () => {
    expect(weightedRankScore([1, 2, 3], [50, 25, 25])).toBe(1.75);
    expect(weightedRankScore([1, 0, 3], [50, 25, 25])).toBe(0);
  });
});

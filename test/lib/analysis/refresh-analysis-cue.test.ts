import { describe, expect, it } from 'vitest';

import { cueRefreshAnalysis, isRefreshAnalysisCued } from '@/lib/analysis/refresh-analysis-cue';

describe('the Refresh analysis cue', () => {
  it('is on for the cue time after a blocked Apply asks for it, then off', () => {
    cueRefreshAnalysis(1_000, 4_000);
    expect(isRefreshAnalysisCued(1_000)).toBe(true);
    expect(isRefreshAnalysisCued(4_999)).toBe(true);
    expect(isRefreshAnalysisCued(5_000)).toBe(false);
  });
});

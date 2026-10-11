import { describe, expect, it } from 'vitest';

import { longestBendLineMm } from '@/lib/features/bend-line-length';

const bend = (bend_length_mm: unknown) => ({ bend_length_mm });

describe('longestBendLineMm', () => {
  it('is the longest bend of the engine list', () => {
    expect(longestBendLineMm({ summary: { bendLengths: [40, 90, 12] } })).toBe(90);
  });

  it('falls back to the bend features when the engine list is empty', () => {
    const fg = { summary: { bendLengths: [] }, feature_graph_v2: { features: [
      { feature_type: 'StraightBend', occurrences: [bend(30), bend(412.4)] },
      { feature_type: 'SimpleHole', occurrences: [bend(999)] },
    ] } };
    expect(longestBendLineMm(fg)).toBe(412.4);
  });

  it('is null when there are no per-bend lengths, so the proxy is labelled as one', () => {
    expect(longestBendLineMm(null)).toBeNull();
    expect(longestBendLineMm({ feature_graph_v2: { features: [{ feature_type: 'StraightBend', occurrences: [bend(0), bend(null)] }] } })).toBeNull();
  });
});

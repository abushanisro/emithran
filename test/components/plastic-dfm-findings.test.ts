import { describe, expect, it } from 'vitest';

import { findingHighlight } from '@/components/features/manufacturing-intelligence/PlasticDfmFindings';
import type { PlasticDfmFinding } from '@/lib/api/hooks/useBOMItems';

const finding = (over: Partial<PlasticDfmFinding> = {}): PlasticDfmFinding => ({
  rule: 'InsufficientDraftAngle', title: 'Draft Angle', severity: 'Major', measured: 0.2, threshold: 0.5, comparison: '<', unit: 'degrees', note: null,
  count: 3, featureIds: [], faces: [4, 9, 12], label: 'Draft Angle: 3 faces, worst 0.20 degrees (below major limit 0.50)', ...over,
});

describe('findingHighlight', () => {
  it('is the finding\'s faces, as the node the viewer highlights', () => {
    const n = findingHighlight(finding());
    expect(n.occurrences.flatMap((o) => o.face_ids)).toEqual([4, 9, 12]);
    expect(n.id).toBe('dfm_InsufficientDraftAngle_Major');
  });

  it('two severities of one rule are two different highlights', () => {
    expect(findingHighlight(finding({ severity: 'Minor' })).id).not.toBe(findingHighlight(finding()).id);
  });
});

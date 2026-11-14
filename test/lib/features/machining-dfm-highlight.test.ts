import { describe, it, expect } from 'vitest';

import { machiningDfmHighlight } from '@/lib/features/machining-dfm-highlight';
import type { FeatureNodeV2 } from '@/lib/types/manufacturing';

const pockets = {
  id: 'p', feature_type: 'PocketV2',
  occurrences: [{ centroid: [1, 0, 0], face_ids: [10] }, { centroid: [2, 0, 0], face_ids: [11, 12] }, { centroid: [3, 0, 0], face_ids: [13] }],
} as unknown as FeatureNodeV2;

describe('machiningDfmHighlight', () => {
  it('highlights exactly the instances the finding names, not the whole feature group', () => {
    const node = machiningDfmHighlight({ rule: 'ToolReach', severity: 'critical', occurrences: [{ featureId: 'p', occurrenceIndex: 1 }, { featureId: 'p', occurrenceIndex: 2 }] }, [pockets]);
    expect(node).toEqual({ id: 'dfm_ToolReach_critical', feature_type: 'PocketV2', occurrences: [{ centroid: [2, 0, 0], face_ids: [11, 12] }, { centroid: [3, 0, 0], face_ids: [13] }] });
  });

  it('a finding about the whole part, or about a feature no longer in the analysis, highlights nothing', () => {
    expect(machiningDfmHighlight({ rule: 'HeavyPart', severity: 'minor', occurrences: [] }, [pockets])).toBeNull();
    expect(machiningDfmHighlight({ rule: 'ToolReach', severity: 'minor', occurrences: [{ featureId: 'gone', occurrenceIndex: 0 }] }, [pockets])).toBeNull();
  });
});

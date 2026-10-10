import { describe, expect, it } from 'vitest';

import { cutLengthHighlight } from '@/lib/features/cut-length-highlight';
import type { FeatureNodeV2 } from '@/lib/types/manufacturing';

// The cut_profile feature exactly as cad-engine extract() emits it (geo_v51):
// the 100 x 50 x 2 plate with a 10 mm hole from test_cut_profile_faces.py.
const cutProfile: FeatureNodeV2 = {
  id: 'cut_profile',
  feature_type: 'Blank',
  occurrences: [
    { centroid: [0, 0, 0], face_ids: [0, 1, 3, 4], cut_category: 'outer_profile', length_mm: 300 },
    { centroid: [0, 0, 0], face_ids: [6], cut_category: 'circular_holes', length_mm: 31.42 },
  ],
};
const hole: FeatureNodeV2 = { id: 'hole_10', feature_type: 'SimpleHole', occurrences: [{ centroid: [1, 2, 0], face_ids: [6] }] };

describe('cutLengthHighlight', () => {
  it('Cut Length highlights every measured cut face; each category only its own', () => {
    const cut = cutLengthHighlight([hole, cutProfile]);
    if (!cut) throw new Error('expected a cut path');
    expect(cut.all.occurrences.flatMap((o) => o.face_ids)).toEqual([0, 1, 3, 4, 6]);
    expect(cut.parts.map((p) => [p.label, p.lengthMm, p.highlight.occurrences.flatMap((o) => o.face_ids)])).toEqual([
      ['Outer profile', 300, [0, 1, 3, 4]],
      ['Round holes', 31.42, [6]],
    ]);
  });

  it('a part analysed before the cut path carried categories is not highlightable', () => {
    const legacy: FeatureNodeV2 = { id: 'cut_profile', feature_type: 'Blank', occurrences: [{ centroid: [0, 0, 0], face_ids: [0, 1, 2] }] };
    expect(cutLengthHighlight([legacy])).toBeNull();
  });

  it('no cut path at all (non sheet-metal part) gives nothing to highlight', () => {
    expect(cutLengthHighlight([hole])).toBeNull();
    expect(cutLengthHighlight([])).toBeNull();
  });
});

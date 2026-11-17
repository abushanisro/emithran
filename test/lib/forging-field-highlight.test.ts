import { describe, expect, it } from 'vitest';

import { checkAgainstInput, resolveFieldHighlight } from '@/lib/features/field-highlight';
import type { FeatureGraphV2 } from '@/lib/types/manufacturing';

// A forging's (or powder metal part's) calculator inputs: the eye beside Projected Area, Parting Perimeter and Part Height lights the faces the
// CAD analysis measured them on (feature_graph_v2.measurements), as the sheet-metal inputs light their cut path and bends.
const graph = {
  features: [],
  metadata: { face_map: [{ face_id: 0, tri_start: 0, tri_count: 2 }, { face_id: 1, tri_start: 2, tri_count: 2 }, { face_id: 2, tri_start: 4, tri_count: 4 }] },
  measurements: {
    projected_area: { value: 7147.1, unit: 'mm2', occurrences: [{ face_ids: [1] }], reconciles: true },
    parting_perimeter: { value: 314.2, unit: 'mm', occurrences: [{ face_ids: [2] }], reconciles: true },
    die_depth: { value: 20, unit: 'mm', occurrences: [{ face_ids: [0, 1] }], reconciles: true },
  },
} as unknown as FeatureGraphV2;

describe('the eye of a forging input', () => {
  it('lights the faces seen along the die direction for the projected area, and checks the number', () => {
    const h = resolveFieldHighlight('projected_area', graph)!;
    expect(h.node.occurrences[0]!.face_ids).toEqual([1]);
    expect(h.measured).toMatchObject({ value: 7147.1, label: 'projected area along the die direction' });
    expect(checkAgainstInput(h, 7147.1).reconciles).toBe(true);
    expect(checkAgainstInput(h, 6000).reconciles).toBe(false);
  });

  it('lights the parting line and the faces the depth is measured between', () => {
    expect(resolveFieldHighlight('parting_perimeter', graph)!.node.occurrences[0]!.face_ids).toEqual([2]);
    expect(resolveFieldHighlight('die_depth', graph)!.node.occurrences[0]!.face_ids).toEqual([0, 1]);
  });

  it('a graph analysed before the measurements lights nothing rather than a guess', () => {
    expect(resolveFieldHighlight('plan_length', graph)).toBeNull();
  });
});

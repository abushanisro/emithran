import { describe, expect, it } from 'vitest';

import { checkAgainstInput, resolveFieldHighlight } from '@/lib/features/field-highlight';
import type { FeatureGraphV2 } from '@/lib/types/manufacturing';

// A composite part's calculator inputs (Tool Side Area, Trim Length, the footprint, the height, the skins): the eye lights the faces the CAD
// analysis measured them on (cad-engine composites laminate_measurements).
const graph = {
  features: [],
  metadata: { face_map: [0, 1, 2, 3, 4, 5].map((i) => ({ face_id: i, tri_start: 2 * i, tri_count: 2 })) },
  measurements: {
    tool_area: { value: 2330.62, unit: 'mm2', occurrences: [{ face_ids: [4] }], reconciles: true },
    trim_length: { value: 268.34, unit: 'mm', occurrences: [{ face_ids: [0, 1, 2, 3] }], reconciles: true },
    footprint_length: { value: 90, unit: 'mm', occurrences: [{ face_ids: [0, 2] }], reconciles: true },
  },
} as unknown as FeatureGraphV2;

describe('the eye of a composites input', () => {
  it('lights the tool side for Tool Side Area, and checks the number', () => {
    const h = resolveFieldHighlight('tool_area', graph)!;
    expect(h.node.occurrences[0]!.face_ids).toEqual([4]);
    expect(h.measured).toMatchObject({ value: 2330.62, label: 'tool side of the laminate' });
    expect(checkAgainstInput(h, 2330.62).reconciles).toBe(true);
  });

  it('lights the edge strips for Trim Length and the end faces for the footprint', () => {
    expect(resolveFieldHighlight('trim_length', graph)!.node.occurrences[0]!.face_ids).toEqual([0, 1, 2, 3]);
    expect(resolveFieldHighlight('footprint_length', graph)!.node.occurrences[0]!.face_ids).toEqual([0, 2]);
  });

  it('a laminate analysed before the measurements lights nothing rather than a guess', () => {
    expect(resolveFieldHighlight('layup_height', graph)).toBeNull();
  });
});

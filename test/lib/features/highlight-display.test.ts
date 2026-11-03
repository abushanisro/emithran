import { describe, expect, it } from 'vitest';

import { highlightLabel, uniqueOccurrenceTriangles } from '@/lib/features/highlight-display';

describe('highlightLabel', () => {
  it('shows a hole as a diameter and a bend as a radius', () => {
    expect(highlightLabel({ feature_type: 'SimpleHole', diameter_mm: 8 })).toBe('Ø8.0mm');
    expect(highlightLabel({ feature_type: 'StraightBend', radius_mm: 2.5 })).toBe('R2.5mm bend');
  });
  it('shows every other type by its own name, never as a bend', () => {
    for (const type of ['SharpEdge', 'PlanarFace', 'CurvedWall', 'CurvedSurface', 'Void']) {
      expect(highlightLabel({ feature_type: type })).toBe(type);
    }
  });
});

describe('uniqueOccurrenceTriangles', () => {
  const faces = new Map([
    [1, { tri_start: 0, tri_count: 2 }],
    [2, { tri_start: 2, tri_count: 3 }],
    [3, { tri_start: 5, tri_count: 0 }],
  ]);
  it('paints a face shared by several occurrences once', () => {
    // three sharp edges, each beside faces 1 and 2
    const occurrences = [{ face_ids: [1, 2] }, { face_ids: [1, 2] }, { face_ids: [2, 1] }];
    expect(uniqueOccurrenceTriangles(occurrences, faces)).toEqual([0, 1, 2, 3, 4]);
  });
  it('leaves out the selected occurrence, a face with no triangles and an unknown face', () => {
    const occurrences = [{ face_ids: [1] }, { face_ids: [2, 3, 99] }];
    expect(uniqueOccurrenceTriangles(occurrences, faces, 0)).toEqual([2, 3, 4]);
    expect(uniqueOccurrenceTriangles([undefined, {}], faces)).toEqual([]);
  });
});

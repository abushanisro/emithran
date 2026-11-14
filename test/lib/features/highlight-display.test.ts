import { describe, expect, it } from 'vitest';

import { highlightLabel, uniqueOccurrenceTriangles, withFaceCentroids } from '@/lib/features/highlight-display';

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

describe('highlightLabel of a hole row with no single size', () => {
  it('names a sand casting\'s "SimpleHole ×12" by its type, not "Ø?mm"', () => {
    expect(highlightLabel({ feature_type: 'SimpleHole' })).toBe('SimpleHole');
  });
});

describe('withFaceCentroids', () => {
  // Two faces of a non-indexed mesh, one triangle each: face 0 a right triangle at z = 0, face 1 the same moved to x = 10..12, z = 3.
  const positions = [0, 0, 0, 3, 0, 0, 0, 3, 0, 10, 0, 3, 12, 0, 3, 10, 6, 3];
  const faces = new Map([[0, { tri_start: 0, tri_count: 1 }], [1, { tri_start: 1, tri_count: 1 }]]);
  const hl = { id: 'x', occurrences: [{ centroid: [0, 0, 0] as [number, number, number], face_ids: [0] }, { centroid: [0, 0, 0] as [number, number, number], face_ids: [1] }] };

  it('puts each occurrence at the centre of its own triangles and boxes them all', () => {
    const r = withFaceCentroids(hl, positions, null, faces);
    expect(r.occurrences.map((o) => o.centroid)).toEqual([[1, 1, 0], [32 / 3, 2, 3]]);
    expect(r.bbox_centered).toEqual({ x_min: 0, x_max: 12, y_min: 0, y_max: 6 });
  });

  it('weights by area: a larger triangle pulls the centre its way', () => {
    const one = { id: 'y', occurrences: [{ centroid: [0, 0, 0] as [number, number, number], face_ids: [0, 1] }] };
    const [c] = withFaceCentroids(one, positions, null, faces).occurrences.map((o) => o.centroid);
    // Areas 4.5 and 6: (4.5 * (1, 1, 0) + 6 * (32/3, 2, 3)) / 10.5.
    expect(c![0]).toBeCloseTo((4.5 + 64) / 10.5);
    expect(c![2]).toBeCloseTo(18 / 10.5);
  });

  it('reads an indexed mesh through its index, and keeps the centroid of an occurrence with no triangles', () => {
    const indexed = withFaceCentroids(
      { id: 'z', occurrences: [{ centroid: [0, 0, 0] as [number, number, number], face_ids: [0] }, { centroid: [7, 7, 7] as [number, number, number], face_ids: [9] }] },
      [0, 3, 0, 0, 0, 0, 3, 0, 0], [1, 2, 0], new Map([[0, { tri_start: 0, tri_count: 1 }]]),
    );
    expect(indexed.occurrences.map((o) => o.centroid)).toEqual([[1, 1, 0], [7, 7, 7]]);
  });
});

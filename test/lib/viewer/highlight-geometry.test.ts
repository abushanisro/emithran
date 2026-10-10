import { describe, expect, it } from 'vitest';

import { boundaryEdges, boundsOf, buildFaceIndex, subsetPositions, trianglesOfFaces } from '@/lib/viewer/highlight-geometry';

// A unit square in the XY plane (2 triangles = face 0) and a second square
// above it (2 triangles = face 1), as non-indexed STL positions.
const quad = (z: number) => [
  0, 0, z, 1, 0, z, 1, 1, z,
  0, 0, z, 1, 1, z, 0, 1, z,
];
const positions = Float32Array.from([...quad(0), ...quad(1)]);
const faceMap = [
  { face_id: 0, tri_start: 0, tri_count: 2 },
  { face_id: 1, tri_start: 2, tri_count: 2 },
];

describe('highlight geometry', () => {
  const index = buildFaceIndex(faceMap, 4);

  it('face -> triangles is exact, de-duplicated and ordered', () => {
    expect([...trianglesOfFaces(index, [1, 0, 1])]).toEqual([0, 1, 2, 3]);
    expect([...trianglesOfFaces(index, [1])]).toEqual([2, 3]);
  });

  it('ids and ranges that do not fit the mesh are ignored, never trusted', () => {
    expect([...trianglesOfFaces(index, [-1, 7, 1.5, NaN])]).toEqual([]);
    const bad = buildFaceIndex([{ face_id: 0, tri_start: 3, tri_count: 5 }], 4);
    expect([...trianglesOfFaces(bad, [0])]).toEqual([]);
  });

  it('the outline of a two-triangle square is its 4 sides (the shared diagonal cancels)', () => {
    const edges = boundaryEdges(positions, trianglesOfFaces(index, [0]));
    expect(edges.length / 6).toBe(4);
  });

  it('two coplanar neighbours merge into one outline with the seam removed', () => {
    const shifted = quad(0).map((v, i) => (i % 3 === 0 ? v + 1 : v));
    const strip = Float32Array.from([...quad(0), ...shifted]);
    const idx = buildFaceIndex([{ face_id: 0, tri_start: 0, tri_count: 4 }], 4);
    expect(boundaryEdges(strip, trianglesOfFaces(idx, [0])).length / 6).toBe(6);
  });

  it('bounds and subset cover exactly the chosen triangles', () => {
    const tris = trianglesOfFaces(index, [1]);
    expect(boundsOf(positions, tris)).toEqual({ min: [0, 0, 1], max: [1, 1, 1] });
    expect(subsetPositions(positions, tris).length).toBe(18);
    expect(boundsOf(positions, new Int32Array(0))).toBeNull();
  });
});

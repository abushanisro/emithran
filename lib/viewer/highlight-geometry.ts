/**
 * Pure geometry helpers behind "show the CAD faces this value was measured on".
 * Works on the non-indexed triangle soup the STL gives us (9 floats per
 * triangle) and the engine's face_map (face id -> triangle range). No three.js
 * here, so it is unit-testable and can run anywhere (worker, test, node).
 *
 * Every face id and triangle range comes from stored analysis data, so each is
 * validated against the real triangle count and ignored if out of range.
 */
import type { FaceMapEntry } from '@/lib/types/manufacturing';

export interface FaceIndex {
  /** triStart[faceId], -1 when the face has no triangles. */
  triStart: Int32Array;
  triCount: Int32Array;
  triTotal: number;
}

/** O(F) once; then face -> triangles is O(1) (replaces a per-render Map build). */
export function buildFaceIndex(faceMap: readonly FaceMapEntry[], triTotal: number): FaceIndex {
  let maxId = -1;
  for (const e of faceMap) if (e.face_id > maxId) maxId = e.face_id;
  const triStart = new Int32Array(maxId + 1).fill(-1);
  const triCount = new Int32Array(maxId + 1);
  for (const e of faceMap) {
    if (e.face_id < 0 || e.tri_count <= 0 || e.tri_start < 0 || e.tri_start + e.tri_count > triTotal) continue;
    triStart[e.face_id] = e.tri_start;
    triCount[e.face_id] = e.tri_count;
  }
  return { triStart, triCount, triTotal };
}

/** Triangle indices of the given faces, each triangle once, ascending. */
export function trianglesOfFaces(index: FaceIndex, faceIds: readonly number[]): Int32Array {
  const seen = new Set<number>();
  for (const id of faceIds) {
    if (!Number.isInteger(id) || id < 0 || id >= index.triStart.length) continue;
    const start = index.triStart[id]!;
    if (start < 0) continue;
    seen.add(id);
  }
  const ids = [...seen].sort((a, b) => index.triStart[a]! - index.triStart[b]!);
  let total = 0;
  for (const id of ids) total += index.triCount[id]!;
  const out = new Int32Array(total);
  let n = 0;
  for (const id of ids) {
    const start = index.triStart[id]!;
    for (let t = 0; t < index.triCount[id]!; t++) out[n++] = start + t;
  }
  return out;
}

/** Positions (9 floats / triangle) of just the chosen triangles. */
export function subsetPositions(positions: Float32Array, triangles: Int32Array): Float32Array {
  const out = new Float32Array(triangles.length * 9);
  for (let i = 0; i < triangles.length; i++) {
    out.set(positions.subarray(triangles[i]! * 9, triangles[i]! * 9 + 9), i * 9);
  }
  return out;
}

/**
 * The outline of a triangle selection: every edge used by exactly one selected
 * triangle (shared edges inside the selection cancel). Returns line-segment
 * positions, 6 floats per edge. O(k) with a quantised vertex hash.
 */
export function boundaryEdges(positions: Float32Array, triangles: Int32Array, weldMm = 1e-4): Float32Array {
  const vertexId = new Map<string, number>();
  const coords: number[] = [];
  const idOf = (x: number, y: number, z: number): number => {
    const key = `${Math.round(x / weldMm)},${Math.round(y / weldMm)},${Math.round(z / weldMm)}`;
    let id = vertexId.get(key);
    if (id === undefined) {
      id = vertexId.size;
      vertexId.set(key, id);
      coords.push(x, y, z);
    }
    return id;
  };

  const edgeUse = new Map<number, number>();
  const edgeEnds = new Map<number, [number, number]>();
  const tri = new Array<number>(3);
  for (const t of triangles) {
    for (let v = 0; v < 3; v++) {
      const o = t * 9 + v * 3;
      tri[v] = idOf(positions[o]!, positions[o + 1]!, positions[o + 2]!);
    }
    for (let e = 0; e < 3; e++) {
      const a = tri[e]!;
      const b = tri[(e + 1) % 3]!;
      if (a === b) continue;
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      const key = lo * 0x4000000 + hi; // vertex ids stay far below 2^26 for any part we load
      edgeUse.set(key, (edgeUse.get(key) ?? 0) + 1);
      edgeEnds.set(key, [lo, hi]);
    }
  }

  const out: number[] = [];
  for (const [key, uses] of edgeUse) {
    if (uses !== 1) continue;
    const [a, b] = edgeEnds.get(key)!;
    out.push(coords[a * 3]!, coords[a * 3 + 1]!, coords[a * 3 + 2]!, coords[b * 3]!, coords[b * 3 + 1]!, coords[b * 3 + 2]!);
  }
  return Float32Array.from(out);
}

export interface Bounds {
  min: [number, number, number];
  max: [number, number, number];
}

/** Axis-aligned box of the chosen triangles; null for an empty selection. */
export function boundsOf(positions: Float32Array, triangles: Int32Array): Bounds | null {
  if (triangles.length === 0) return null;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const t of triangles) {
    for (let v = 0; v < 3; v++) {
      for (let k = 0; k < 3; k++) {
        const value = positions[t * 9 + v * 3 + k]!;
        if (value < min[k]!) min[k] = value;
        if (value > max[k]!) max[k] = value;
      }
    }
  }
  return { min, max };
}

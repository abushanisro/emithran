import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { boundsOf, buildFaceIndex, trianglesOfFaces } from '@/lib/viewer/highlight-geometry';
import { buildDimensionAnnotations } from '@/lib/features/dimension-annotations';
import part from '../../fixtures/dimension-annotations/sheet-metal-holes-bend.json';

// The real STL of 830-002023-00 and the real face_map stored with its analysis. A callout is anchored
// on the triangles of its faces; the engine's own hole centres (stored bbox-centred, which is the
// frame the viewer draws in) must agree with that anchor, or a label would sit off its hole.
function readBinaryStl(file: string): Float32Array {
  const buf = readFileSync(join(__dirname, '../../fixtures/dimension-annotations', file));
  const n = buf.readUInt32LE(80);
  const out = new Float32Array(n * 9);
  for (let i = 0; i < n; i++) {
    for (let v = 0; v < 3; v++) for (let k = 0; k < 3; k++) out[i * 9 + v * 3 + k] = buf.readFloatLE(84 + i * 50 + 12 + v * 12 + k * 4);
  }
  return out;
}

describe('callout anchors on the real mesh', () => {
  const positions = readBinaryStl('sheet-metal-holes-bend.stl');
  const index = buildFaceIndex(part.face_map, positions.length / 9);
  const all = boundsOf(positions, Int32Array.from({ length: positions.length / 9 }, (_, i) => i))!;
  const bboxCentre = all.min.map((m, k) => (m + all.max[k]!) / 2);

  it('the face map and the STL are the same mesh', () => {
    expect(positions.length / 9).toBe(part.stl_tri_total);
  });

  it('every hole callout is anchored on its own hole, within 0.05 mm of the engine centre', () => {
    const holes = (part.feature_graph_v2.features as any[]).filter((f) => f.feature_type === 'SimpleHole');
    let checked = 0;
    for (const f of holes) {
      for (const o of f.occurrences) {
        const b = boundsOf(positions, trianglesOfFaces(index, o.face_ids))!;
        const anchor = b.min.map((m, k) => (m + b.max[k]!) / 2);
        const engine = o.centroid.map((c: number, k: number) => c + bboxCentre[k]!);
        expect(Math.hypot(...anchor.map((a, k) => a - engine[k]!))).toBeLessThan(0.05);
        checked++;
      }
    }
    expect(checked).toBe(10);
  });

  it('every callout of the part resolves to triangles of this mesh', () => {
    for (const a of buildDimensionAnnotations(part as any)) {
      expect(trianglesOfFaces(index, a.faceIds).length).toBeGreaterThan(0);
    }
  });
});

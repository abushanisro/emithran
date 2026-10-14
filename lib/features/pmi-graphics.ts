/**
 * The PMI graphics of a STEP (cad-engine pmi.graphics): the polylines and glyph triangles the CAD
 * tool drew for each callout, turned into two flat buffers the viewer draws in the mesh's frame.
 *
 * A value that exists only as drawn text (a tolerance on a Width callout, the datum references of a
 * position frame) is shown exactly as the CAD drew it; nothing is read from it or typed in.
 */

export interface PmiGraphic {
  callout: string;
  /** Polylines: leaders, arrowheads, frame outlines. */
  curves: ReadonlyArray<ReadonlyArray<readonly [number, number, number]>>;
  /** Flat x,y,z triples, 3 per triangle: the filled glyphs. */
  triangles: ReadonlyArray<number>;
}

export interface PmiGraphicsBuffers {
  /** Segment endpoints, 6 numbers per segment (a polyline of n points is n-1 segments). */
  lines: Float32Array;
  triangles: Float32Array;
  callouts: number;
}

/**
 * `origin` is the model's bounding-box centre in STEP coordinates (cad-engine pmi.graphics_origin):
 * the mesh is centred on its own bounding box, so the same shift puts the graphics on the part.
 * No origin means no frame to draw in, so nothing is drawn.
 */
export function buildPmiGraphicsBuffers(
  graphics: ReadonlyArray<PmiGraphic> | null | undefined,
  origin: readonly [number, number, number] | null | undefined,
): PmiGraphicsBuffers | null {
  if (!graphics?.length || !origin) return null;
  let segments = 0;
  let triNumbers = 0;
  for (const g of graphics) {
    for (const c of g.curves) segments += Math.max(0, c.length - 1);
    triNumbers += g.triangles.length - (g.triangles.length % 9);
  }
  const lines = new Float32Array(segments * 6);
  const triangles = new Float32Array(triNumbers);
  let l = 0;
  let t = 0;
  for (const g of graphics) {
    for (const c of g.curves) {
      for (let i = 0; i + 1 < c.length; i++) {
        const a = c[i]!, b = c[i + 1]!;
        lines[l++] = a[0] - origin[0]; lines[l++] = a[1] - origin[1]; lines[l++] = a[2] - origin[2];
        lines[l++] = b[0] - origin[0]; lines[l++] = b[1] - origin[1]; lines[l++] = b[2] - origin[2];
      }
    }
    const usable = g.triangles.length - (g.triangles.length % 9);
    for (let i = 0; i < usable; i += 3) {
      triangles[t++] = g.triangles[i]! - origin[0];
      triangles[t++] = g.triangles[i + 1]! - origin[1];
      triangles[t++] = g.triangles[i + 2]! - origin[2];
    }
  }
  return { lines, triangles, callouts: graphics.length };
}

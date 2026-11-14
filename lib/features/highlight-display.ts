// What the 3D viewer shows for a highlighted feature, and which triangles it paints. Pure, so both are tested.

export interface HighlightFeature {
  feature_type: string;
  diameter_mm?: number;
  radius_mm?: number;
}

/**
 * The viewer's label for a highlighted feature type. Only a hole is a diameter and only a bend is a radius: every other type
 * (SharpEdge, PlanarFace, CurvedWall, ...) shows its own name, never "R?mm bend". A hole row of several sizes (a sand casting's
 * "SimpleHole ×12") has no one diameter: it shows its type, not "Ø?mm".
 */
export function highlightLabel(feature: HighlightFeature): string {
  if (feature.feature_type === 'SimpleHole' && feature.diameter_mm != null) return `Ø${feature.diameter_mm.toFixed(1)}mm`;
  if (/bend/i.test(feature.feature_type)) return `R${feature.radius_mm?.toFixed(1) ?? '?'}mm bend`;
  return feature.feature_type;
}

export interface FaceTriangles {
  tri_start: number;
  tri_count: number;
}

/**
 * The triangles to paint for a set of occurrences, each triangle once. Occurrences share faces (the faces beside a sharp edge
 * belong to every edge of those faces), so listing them per occurrence repeated the same triangles many times.
 * `skip` is the one occurrence painted separately as the selected one.
 */
export function uniqueOccurrenceTriangles(
  occurrences: readonly ({ face_ids?: readonly number[] } | undefined)[],
  faces: ReadonlyMap<number, FaceTriangles>,
  skip?: number | null,
): number[] {
  const seenFaces = new Set<number>();
  const result: number[] = [];
  occurrences.forEach((occ, index) => {
    if (!occ || index === skip) return;
    for (const faceId of occ.face_ids ?? []) {
      if (seenFaces.has(faceId)) continue;
      seenFaces.add(faceId);
      const entry = faces.get(faceId);
      if (!entry || entry.tri_count <= 0) continue;
      for (let t = entry.tri_start; t < entry.tri_start + entry.tri_count; t++) result.push(t);
    }
  });
  return result;
}

type Xyz = [number, number, number];

/**
 * Where each occurrence is, from its own triangles on the loaded mesh: the area-weighted centre of its faces, and the box of all of
 * them in x and y (what the viewer zooms to). For a highlight whose source knows the faces but not their position (a sand-casting
 * analysis's features, found on the cad-engine's mesh by face key): measured from the mesh the viewer shows, so it is where the
 * faces are drawn. `positions` are the mesh's vertex positions in the viewer's centred frame, `index` its triangle indices if indexed.
 * An occurrence with no triangles keeps the centroid it came with.
 */
export function withFaceCentroids<H extends { occurrences: { centroid: Xyz; face_ids?: readonly number[] }[] }>(
  highlight: H,
  positions: ArrayLike<number>,
  index: ArrayLike<number> | null,
  faces: ReadonlyMap<number, FaceTriangles>,
): H & { bbox_centered?: { x_min: number; x_max: number; y_min: number; y_max: number } } {
  const at = (i: number): number => positions[i] ?? Number.NaN;
  const vertex = (t: number, k: number): Xyz => {
    const v = index ? (index[t * 3 + k] ?? -1) : t * 3 + k;
    return [at(v * 3), at(v * 3 + 1), at(v * 3 + 2)];
  };
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  const occurrences = highlight.occurrences.map((occ) => {
    let area = 0, sx = 0, sy = 0, sz = 0;
    for (const faceId of occ.face_ids ?? []) {
      const entry = faces.get(faceId);
      if (!entry) continue;
      for (let t = entry.tri_start; t < entry.tri_start + entry.tri_count; t++) {
        const [ax, ay, az] = vertex(t, 0), [bx, by, bz] = vertex(t, 1), [cx, cy, cz] = vertex(t, 2);
        if (![ax, ay, az, bx, by, bz, cx, cy, cz].every(Number.isFinite)) continue;
        const [ux, uy, uz, wx, wy, wz] = [bx - ax, by - ay, bz - az, cx - ax, cy - ay, cz - az];
        const s = 0.5 * Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx);
        sx += (s * (ax + bx + cx)) / 3;
        sy += (s * (ay + by + cy)) / 3;
        sz += (s * (az + bz + cz)) / 3;
        area += s;
        xMin = Math.min(xMin, ax, bx, cx); xMax = Math.max(xMax, ax, bx, cx);
        yMin = Math.min(yMin, ay, by, cy); yMax = Math.max(yMax, ay, by, cy);
      }
    }
    return area > 0 ? { ...occ, centroid: [sx / area, sy / area, sz / area] as Xyz } : occ;
  });
  return {
    ...highlight,
    occurrences,
    ...(xMin <= xMax ? { bbox_centered: { x_min: xMin, x_max: xMax, y_min: yMin, y_max: yMax } } : {}),
  };
}

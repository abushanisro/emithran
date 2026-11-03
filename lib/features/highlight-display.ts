// What the 3D viewer shows for a highlighted feature, and which triangles it paints. Pure, so both are tested.

export interface HighlightFeature {
  feature_type: string;
  diameter_mm?: number;
  radius_mm?: number;
}

/**
 * The viewer's label for a highlighted feature type. Only a hole is a diameter and only a bend is a radius: every other type
 * (SharpEdge, PlanarFace, CurvedWall, ...) shows its own name, never "R?mm bend".
 */
export function highlightLabel(feature: HighlightFeature): string {
  if (feature.feature_type === 'SimpleHole') return `Ø${feature.diameter_mm?.toFixed(1) ?? '?'}mm`;
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

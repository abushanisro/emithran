/**
 * The pure part of the sand casting viewer: which meshes of the worker's GLB to highlight for a feature, and where the feature's edge lines,
 * the parting line and the core outlines go. No three.js here, so it is unit-tested.
 *
 * Frames: the worker writes its GLB Y-up in metres (mesh.cpp: SetInputCoordinateSystem(Zup), SetInputLengthUnit(0.001)), while the result's
 * polylines (feature edges, the parting line) are in the part's own Z-up millimetres. `toGlbFrame` is the one place that converts.
 */
export type Xyz = readonly [number, number, number];

/** A point in the part's Z-up millimetres, in the GLB's Y-up metres: (x, y, z) -> (x, z, -y) / 1000. */
export function toGlbFrame([x, y, z]: Xyz): [number, number, number] {
  return [x / 1000, z / 1000, -y / 1000];
}

/**
 * Line segments (two points each, flat x y z) of polylines, in the GLB frame. A closed polyline repeats nothing: its last point joins its
 * first. A point that is not three finite numbers ends that polyline's drawing rather than putting a line to the origin.
 */
export function lineSegments(
  polylines: ReadonlyArray<ReadonlyArray<Xyz>>,
  closed = false,
): Float32Array {
  const out: number[] = [];
  for (const line of polylines) {
    const pts = line.filter((p) => p.length === 3 && p.every(Number.isFinite));
    const n = closed && pts.length > 2 ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++)
      out.push(...toGlbFrame(pts[i]!), ...toGlbFrame(pts[(i + 1) % pts.length]!));
  }
  return Float32Array.from(out);
}

/**
 * The primitives of the part GLB that show any of the faces. `glbFaces[i]` is the face primitive i shows (the result's glb_faces); a face
 * the GLB does not show (no triangles) selects nothing.
 */
export function primitivesOfFaces(
  glbFaces: readonly number[],
  faces: readonly number[],
): number[] {
  const wanted = new Set(faces);
  const out: number[] = [];
  glbFaces.forEach((face, primitive) => {
    if (wanted.has(face)) out.push(primitive);
  });
  return out;
}

/**
 * Whether the loaded GLB can be addressed by `glb_faces`: one mesh per entry. When it cannot (a different file, an edited result) nothing may
 * be highlighted, because a wrong mesh lit is worse than none.
 */
export function glbMatchesFaces(meshCount: number, glbFaces: readonly number[]): boolean {
  return glbFaces.length > 0 && meshCount === glbFaces.length;
}

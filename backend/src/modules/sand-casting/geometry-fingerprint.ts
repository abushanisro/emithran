// A part's geometry as the casting analysis measured it, to tell whether two analyses are of the same part. An engineer's draw direction is chosen on the
// geometry in front of them; when the item's file is replaced, the choice may only carry over to the same geometry. Pure.

export interface GeometryFingerprint {
  solids: number;
  faces: number;
  edges: number;
  volumeMm3: number;
  areaMm2: number;
  /** The extents along the part's own x, y and z (mm): a draw axis is one of these, so a part turned in its file is not the same part for this purpose. */
  boxMm: [number, number, number];
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Two exports of one part differ by the tolerance of the exporter, not by the shape: volume and area to a ten-thousandth, the extents to 0.01 mm plus a
 * ten-thousandth. A real change (a hole, a rib, a different size) moves the face and edge counts or the volume by far more than that.
 */
export const RELATIVE_TOLERANCE = 1e-4;
export const EXTENT_TOLERANCE_MM = 0.01;

/** The fingerprint of an analysis of one part, or null when it holds none (not one part, or a measurement is missing). */
export function fingerprintOf(result: unknown): GeometryFingerprint | null {
  const parts = (result as { parts?: unknown[] } | null)?.parts;
  if (!Array.isArray(parts) || parts.length !== 1) return null;
  const p = parts[0] as { solids?: unknown; faces?: unknown; edges?: unknown; volume_mm3?: unknown; area_mm2?: unknown; box_mm?: { size?: unknown } | null };
  const size = Array.isArray(p.box_mm?.size) ? p.box_mm.size.map(num) : [];
  const [solids, faces, edges, volumeMm3, areaMm2] = [num(p.solids), num(p.faces), num(p.edges), num(p.volume_mm3), num(p.area_mm2)];
  if (solids == null || faces == null || edges == null || volumeMm3 == null || areaMm2 == null || size.length !== 3 || size.some((v) => v == null)) return null;
  return { solids, faces, edges, volumeMm3, areaMm2, boxMm: size as [number, number, number] };
}

/** The fingerprint as stored (a jsonb column), or null when it is not one. */
export function parseFingerprint(raw: unknown): GeometryFingerprint | null {
  const g = raw as Partial<GeometryFingerprint> | null;
  if (!g || typeof g !== 'object') return null;
  const box = Array.isArray(g.boxMm) ? g.boxMm.map(num) : [];
  const [solids, faces, edges, volumeMm3, areaMm2] = [num(g.solids), num(g.faces), num(g.edges), num(g.volumeMm3), num(g.areaMm2)];
  if (solids == null || faces == null || edges == null || volumeMm3 == null || areaMm2 == null || box.length !== 3 || box.some((v) => v == null)) return null;
  return { solids, faces, edges, volumeMm3, areaMm2, boxMm: box as [number, number, number] };
}

const close = (a: number, b: number, absolute = 0) => Math.abs(a - b) <= absolute + RELATIVE_TOLERANCE * Math.max(Math.abs(a), Math.abs(b));

/** Whether two fingerprints are of one part, and if not, what differs (in words, with both values). */
export function compareGeometry(a: GeometryFingerprint, b: GeometryFingerprint): { same: boolean; differences: string[] } {
  const differences: string[] = [];
  if (a.solids !== b.solids) differences.push(`solids ${a.solids} to ${b.solids}`);
  if (a.faces !== b.faces) differences.push(`faces ${a.faces} to ${b.faces}`);
  if (a.edges !== b.edges) differences.push(`edges ${a.edges} to ${b.edges}`);
  if (!close(a.volumeMm3, b.volumeMm3)) differences.push(`volume ${Math.round(a.volumeMm3)} to ${Math.round(b.volumeMm3)} mm3`);
  if (!close(a.areaMm2, b.areaMm2)) differences.push(`surface ${Math.round(a.areaMm2)} to ${Math.round(b.areaMm2)} mm2`);
  (['x', 'y', 'z'] as const).forEach((axis, i) => {
    if (!close(a.boxMm[i]!, b.boxMm[i]!, EXTENT_TOLERANCE_MM)) differences.push(`size along ${axis} ${a.boxMm[i]!.toFixed(2)} to ${b.boxMm[i]!.toFixed(2)} mm`);
  });
  return { same: differences.length === 0, differences };
}

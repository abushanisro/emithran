// Bringing a selected feature into view without losing the engineer's view of the part. Pure: the viewer applies it.

export type Vec3 = readonly [number, number, number];

/** A pointer that moved more than this between press and release (px) was rotating or panning the view, not picking. */
export const CLICK_MAX_DRAG_PX = 4;

/** After a feature is picked on the model, the selection it causes does not move the camera (ms): the feature is already where the engineer is looking. */
export const MODEL_PICK_HOLD_MS = 1500;

/**
 * The camera looking at `focus` from `distance` away, along the direction it looks now: the view keeps its orientation (the engineer's rotation),
 * only its aim and distance change. A camera on its own target has no direction; it then looks along -Z (from +Z).
 */
export function zoomOnto(camera: Vec3, target: Vec3, focus: Vec3, distance: number): { position: [number, number, number]; target: [number, number, number] } {
  const d = [camera[0] - target[0], camera[1] - target[1], camera[2] - target[2]];
  const len = Math.hypot(d[0]!, d[1]!, d[2]!);
  const dir = len > 1e-9 ? d.map((c) => c / len) : [0, 0, 1];
  return {
    position: [focus[0] + dir[0]! * distance, focus[1] + dir[1]! * distance, focus[2] + dir[2]! * distance],
    target: [focus[0], focus[1], focus[2]],
  };
}

/** The centre of a feature's occurrences (their centroids' mean), in the model's frame; null when none has a centroid. */
export function centreOf(occurrences: ReadonlyArray<{ centroid?: readonly number[] | null }>): [number, number, number] | null {
  const pts = occurrences.map((o) => o.centroid).filter((c): c is readonly number[] => !!c && c.length >= 3);
  if (pts.length === 0) return null;
  const sum = pts.reduce((s, c) => [s[0]! + c[0]!, s[1]! + c[1]!, s[2]! + c[2]!], [0, 0, 0]);
  return [sum[0]! / pts.length, sum[1]! / pts.length, sum[2]! / pts.length];
}

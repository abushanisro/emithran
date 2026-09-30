/**
 * Pure "fit a perspective camera to a bounding box" math, extracted out of
 * components/ui/edrawings-viewer.tsx's CameraFitter so the arithmetic is
 * unit-tested independently of react-three-fiber/WebGL (which this repo's
 * test setup — jsdom, no GPU — cannot run). The 3D component stays a thin
 * wrapper: read the scene's real bounding box, call this, apply the result
 * to the THREE.Camera/OrbitControls.
 *
 * No `radius < N` size cutoff here on principle: whether a box is "too small
 * to be the real model" is a decision about WHICH objects to measure (an
 * identity question — see the `userData.isPrimaryModel` tag the mesh carries
 * in edrawings-viewer.tsx), never a property of the resulting number. A
 * genuinely small part must fit exactly like a large one.
 */

export interface Box3Like {
  min: readonly [number, number, number];
  max: readonly [number, number, number];
}

export interface FitCameraResult {
  center: [number, number, number];
  /** Bounding-sphere radius — every dimension fits within it regardless of aspect ratio. */
  radius: number;
  /** Camera distance from `center` along the framing direction. */
  distance: number;
  near: number;
  far: number;
  /** Isometric-ish default camera position (center + framing direction × distance). */
  position: [number, number, number];
}

/** Isometric-ish framing direction (x=1, y=0.7, z=1), normalised. Exported so
 *  callers that need the same angle elsewhere (e.g. a screenshot re-frame)
 *  never hand-copy it out of sync with this module. */
export const DEFAULT_FIT_DIRECTION: readonly [number, number, number] = (() => {
  const [x, y, z] = [1, 0.7, 1];
  const len = Math.sqrt(x * x + y * y + z * z);
  return [x / len, y / len, z / len] as const;
})();

function isEmpty(box: Box3Like): boolean {
  return box.max[0] < box.min[0] || box.max[1] < box.min[1] || box.max[2] < box.min[2];
}

/**
 * `null` for an empty box (nothing to fit yet — the caller's own job to keep
 * waiting or give up, this function only ever answers the geometry question).
 */
export function fitCameraToBox(box: Box3Like, fovDegrees: number, direction: readonly [number, number, number] = DEFAULT_FIT_DIRECTION): FitCameraResult | null {
  if (isEmpty(box)) return null;

  const center: [number, number, number] = [
    (box.min[0] + box.max[0]) / 2,
    (box.min[1] + box.max[1]) / 2,
    (box.min[2] + box.max[2]) / 2,
  ];
  const size: [number, number, number] = [
    box.max[0] - box.min[0],
    box.max[1] - box.min[1],
    box.max[2] - box.min[2],
  ];
  // Never zero: a single-point/degenerate box still needs a finite framing
  // distance instead of dividing by zero or landing the camera on the model.
  const radius = Math.max(Math.sqrt(size[0] ** 2 + size[1] ** 2 + size[2] ** 2) / 2, 0.01);

  const fovRad = fovDegrees * (Math.PI / 180);
  // 1.9x gives comfortable padding without pushing past the clipping plane.
  const distance = (radius / Math.tan(fovRad / 2)) * 1.9;

  const near = Math.max(0.01, distance * 0.001);
  const far = distance * 20;

  const position: [number, number, number] = [
    center[0] + direction[0] * distance,
    center[1] + direction[1] * distance,
    center[2] + direction[2] * distance,
  ];

  return { center, radius, distance, near, far, position };
}

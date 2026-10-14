import type { BufferGeometry } from 'three';

/**
 * Moves the geometry so its bounding-box centre is the origin, in place, and returns it.
 * Idempotent: a second call moves nothing. Call it before anything is derived from the
 * geometry (EdgesGeometry, face subsets, anchors), because those copy the vertices.
 */
export function centreGeometry<G extends BufferGeometry>(geometry: G): G {
  geometry.center();
  geometry.computeBoundingBox();
  return geometry;
}

import * as THREE from 'three';

/**
 * The current, guaranteed-fresh world-space bounding box of every object in
 * `root`'s subtree for which `isTarget` returns true.
 *
 * Three.js's `Box3.expandByObject()` only refreshes the MEASURED object's own
 * local matrix (internally: `object.updateWorldMatrix(updateParents=false,
 * updateChildren=false)`) — it never refreshes that object's ANCESTORS. Call
 * it right after a scene-graph transform applied outside react-three-fiber's
 * render loop (the standard example: drei's <Center>, which repositions its
 * wrapping group from a React `useLayoutEffect`, not from `useFrame`) and the
 * ancestor's matrix can still be one frame stale for this one measurement —
 * silently producing a box anchored wherever the content used to be, not
 * where it now renders. This is a well-documented three.js gotcha, not
 * specific to this codebase (see e.g. mrdoob/three.js#11967, #18643; the Box3
 * docs' own note that `setFromObject` calls `updateMatrixWorld` first for
 * exactly this reason). The one standard fix is to force a full, synchronous
 * matrix-world update before measuring — which is all this function does.
 *
 * Confirmed against this project's own three.js build (see
 * scene-bounds.test.ts): moving a group's `position` and measuring a child
 * immediately afterward, with no update, silently reads back (0,0,0);
 * through this function it correctly reads the moved position.
 */
export function freshWorldBoundsOf(
  root: THREE.Object3D,
  isTarget: (object: THREE.Object3D) => boolean,
): THREE.Box3 {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  root.traverse((obj) => {
    if (isTarget(obj)) box.expandByObject(obj);
  });
  return box;
}

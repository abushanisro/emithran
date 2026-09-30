import * as THREE from 'three';
import { describe, it, expect } from 'vitest';

import { freshWorldBoundsOf } from '@/lib/geometry/scene-bounds';

// Real `three` Object3D/Group/Mesh/Box3 — no WebGL/DOM needed, these are
// plain JS classes. Reproduces the exact viewer bug live-confirmed against a
// real reported part (830-002176-00.stl, native STL centroid ~6321mm from
// origin — an assembly-context export, not re-centered at 0,0,0): drei's
// <Center> re-centers content by setting a position on its wrapping group
// from a React layout effect, entirely outside react-three-fiber's render
// loop, so a bounding-box read immediately after can be stale.
function taggedMesh(): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(2, 2, 2);
  const mesh = new THREE.Mesh(geometry);
  mesh.userData.isPrimaryModel = true;
  return mesh;
}

describe('freshWorldBoundsOf', () => {
  it('reads the CURRENT position of content whose ancestor moved after the last matrix update', () => {
    const scene = new THREE.Scene();
    const centerGroup = new THREE.Group();
    const mesh = taggedMesh();
    centerGroup.add(mesh);
    scene.add(centerGroup);
    scene.updateMatrixWorld(true); // an initial render already happened

    // <Center>'s own move, e.g. re-centering a part whose native STL
    // coordinates sit far from the origin — done via a plain position set,
    // exactly like drei's Center.js does it in a useLayoutEffect.
    centerGroup.position.set(1000, 2000, 3000);

    // The bug this function exists to prevent: plain Box3.expandByObject,
    // called with no forced update right after the move above, silently
    // reads the STALE (pre-move) transform.
    const stale = new THREE.Box3().expandByObject(mesh);
    expect(stale.getCenter(new THREE.Vector3())).toEqual(new THREE.Vector3(0, 0, 0));

    // This function must not have that problem.
    const fresh = freshWorldBoundsOf(scene, (obj) => !!obj.userData.isPrimaryModel);
    expect(fresh.getCenter(new THREE.Vector3())).toEqual(new THREE.Vector3(1000, 2000, 3000));
  });

  it('measures only tagged objects, never an untagged sibling of any size', () => {
    const scene = new THREE.Scene();
    const real = taggedMesh();
    real.position.set(5, 5, 5);
    const helper = new THREE.Mesh(new THREE.BoxGeometry(200, 200, 200)); // deliberately large, untagged
    scene.add(real, helper);

    const box = freshWorldBoundsOf(scene, (obj) => !!obj.userData.isPrimaryModel);
    // A 2-unit box centered at (5,5,5): bounds exactly [4,4,4]..[6,6,6],
    // nowhere near the untagged 200-unit helper's extent.
    expect(box.min.toArray()).toEqual([4, 4, 4]);
    expect(box.max.toArray()).toEqual([6, 6, 6]);
  });

  it('returns an empty box when nothing is tagged yet, never throws', () => {
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1))); // untagged
    const box = freshWorldBoundsOf(scene, (obj) => !!obj.userData.isPrimaryModel);
    expect(box.isEmpty()).toBe(true);
  });

  it('fits a part genuinely far from the origin (the real reported case)', () => {
    // 830-002176-00.stl's real, live-verified native bounds: X[123.78..220.96],
    // Y[-6332.92..-6310.92], Z[32.90..40.30] — a STEP->STL export that keeps
    // its placement in the parent assembly rather than being re-centered.
    const scene = new THREE.Scene();
    const centerGroup = new THREE.Group();
    const mesh = taggedMesh();
    mesh.geometry = new THREE.BoxGeometry(97.183, 22, 7.4);
    mesh.geometry.translate(172.365, -6321.92, 36.6); // raw STL vertex coordinates
    centerGroup.add(mesh);
    scene.add(centerGroup);
    scene.updateMatrixWorld(true);

    // <Center> re-centers: moves the group by -rawCentroid.
    centerGroup.position.set(-172.365, 6321.92, -36.6);

    const box = freshWorldBoundsOf(scene, (obj) => !!obj.userData.isPrimaryModel);
    const center = box.getCenter(new THREE.Vector3());
    // three.js does this math in float32; at a ~6321-unit magnitude its
    // native precision is ~6e-4, not the 1e-6 a naive tolerance would assume.
    expect(center.x).toBeCloseTo(0, 2);
    expect(center.y).toBeCloseTo(0, 2);
    expect(center.z).toBeCloseTo(0, 2);
  });
});

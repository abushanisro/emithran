import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { centreGeometry } from '@/lib/geometry/centre-geometry';

// The reported bug: a part modelled away from the origin showed its blue edge lines offset
// from the shaded mesh, because the edges were built before the mesh was centred.
const box = (at: [number, number, number]) => {
  const g = new THREE.BoxGeometry(10, 20, 30).toNonIndexed();
  g.translate(...at);
  return g;
};
const centreOf = (g: THREE.BufferGeometry) => {
  g.computeBoundingBox();
  return g.boundingBox!.getCenter(new THREE.Vector3());
};

describe('centreGeometry', () => {
  it('puts the bounding-box centre on the origin', () => {
    const g = centreGeometry(box([-18, 7, 120]));
    expect(centreOf(g).length()).toBeLessThan(1e-4);
  });

  it('is idempotent, so a later centring cannot move what was built from it', () => {
    const g = centreGeometry(box([-18, 7, 120]));
    const edges = new THREE.EdgesGeometry(g, 30);
    g.center(); // what the measurements effect still does
    edges.computeBoundingBox(); g.computeBoundingBox();
    expect(edges.boundingBox!.min.distanceTo(g.boundingBox!.min)).toBeLessThan(1e-4);
    expect(edges.boundingBox!.max.distanceTo(g.boundingBox!.max)).toBeLessThan(1e-4);
  });

  it('shows the old failure: edges built before centring end up away from the mesh', () => {
    const g = box([-18, 7, 120]);
    const edges = new THREE.EdgesGeometry(g, 30);
    g.center();
    edges.computeBoundingBox(); g.computeBoundingBox();
    expect(edges.boundingBox!.min.distanceTo(g.boundingBox!.min)).toBeGreaterThan(100);
  });
});

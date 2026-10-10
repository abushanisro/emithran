'use client';

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';

// Rendering budget for the body edge overlay: EdgesGeometry is O(triangles), done once per geometry.
const BODY_EDGE_MAX_TRIANGLES = 200_000;

/** Thin blue edge lines over the shaded body (creases >= 30 deg and open boundaries). */
export function BodyEdges({ geometry }: { geometry: THREE.BufferGeometry }) {
  const edges = useMemo(() => {
    const pos = geometry.getAttribute('position');
    if (!pos || pos.count / 3 > BODY_EDGE_MAX_TRIANGLES) return null;
    return new THREE.EdgesGeometry(geometry, 30);
  }, [geometry]);
  useEffect(() => () => { edges?.dispose(); }, [edges]);
  if (!edges) return null;
  return (
    <lineSegments geometry={edges} renderOrder={2}>
      <lineBasicMaterial color="#1c1cb8" />
    </lineSegments>
  );
}

/** Orange setup-axis arrows on both ends of each given direction, pointing at the part. */
export function SetupAxisArrows({ geometry, axes }: { geometry: THREE.BufferGeometry; axes: Array<[number, number, number]> }) {
  const arrows = useMemo(() => {
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (!box) return [];
    const center = box.getCenter(new THREE.Vector3());
    const radius = box.getSize(new THREE.Vector3()).length() / 2;
    const len = radius * 0.45;
    return axes.flatMap(([x, y, z]) => {
      const dir = new THREE.Vector3(x, y, z).normalize();
      return [1, -1].map((sign) => {
        const pointing = dir.clone().multiplyScalar(-sign); // toward the part
        const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), pointing);
        const position = center.clone().add(dir.clone().multiplyScalar(sign * (radius * 1.2 + len / 2)));
        return { position, quaternion, len };
      });
    });
  }, [geometry, axes]);
  return (
    <group>
      {arrows.map((a, i) => (
        <group key={i} position={a.position} quaternion={a.quaternion}>
          <mesh position={[0, -a.len * 0.15, 0]} renderOrder={102}>
            <cylinderGeometry args={[a.len * 0.06, a.len * 0.06, a.len * 0.7, 12]} />
            <meshStandardMaterial color="#d9600f" depthTest={false} />
          </mesh>
          <mesh position={[0, a.len * 0.35, 0]} renderOrder={102}>
            <coneGeometry args={[a.len * 0.16, a.len * 0.3, 16]} />
            <meshStandardMaterial color="#d9600f" depthTest={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}


'use client';

import React, { useMemo } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { Html, Line } from '@react-three/drei';
import { buildFaceIndex, boundsOf, trianglesOfFaces, subsetPositions } from '@/lib/viewer/highlight-geometry';
import type { FaceMapEntry } from '@/lib/types/manufacturing';
import type { DimensionAnnotation } from '@/lib/features/dimension-annotations';
import { LABEL_CHAR_PX, LABEL_PAD_PX, separateLabels } from '@/lib/viewer/label-separation';

/**
 * Diameter / radius callouts drawn over the model: a teal label joined by a
 * thin leader and an arrowhead to the feature it measures. The callouts are
 * model-space objects inside the model's own group, so they stay on their
 * feature through rotate, pan and zoom with no per-frame layout work; only the
 * text is a DOM label, which drei projects each frame.
 *
 * Each anchor is read from the rendered mesh itself (the triangles of the
 * feature's B-Rep faces, via the engine's face_map), never from a stored
 * coordinate, so the callout is on the geometry the user sees.
 */
export interface DimensionOverlayState {
  annotations: DimensionAnnotation[];
  faceMap: readonly FaceMapEntry[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export const DimensionOverlayCtx = React.createContext<DimensionOverlayState | null>(null);

const TEAL = '#2dd4bf';
const TEAL_SELECTED = '#fbbf24';
const LEADER_REACH = 0.1;     // of the model diagonal
const LEADER_STAGGER = 0.035; // extra reach for every third callout, so neighbours do not sit on one spot

interface Placed {
  annotation: DimensionAnnotation;
  anchor: THREE.Vector3;
  label: THREE.Vector3;
  triangles: Int32Array;
}

/** Anchor, label position and highlight triangles of each callout on this mesh. */
export function placeAnnotations(
  geometry: THREE.BufferGeometry, faceMap: readonly FaceMapEntry[], annotations: readonly DimensionAnnotation[],
): { placed: Placed[]; diagonal: number } {
  const positions = geometry.getAttribute('position').array as Float32Array;
  const index = buildFaceIndex(faceMap, Math.floor(positions.length / 9));
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const centre = box.getCenter(new THREE.Vector3());
  const diagonal = box.getSize(new THREE.Vector3()).length() || 1;
  const placed: Placed[] = [];
  annotations.forEach((annotation) => {
    const triangles = trianglesOfFaces(index, annotation.faceIds);
    const b = boundsOf(positions, triangles);
    if (!b) return; // the faces are not on this mesh: no callout rather than a misplaced one
    const anchor = new THREE.Vector3((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
    const dir = anchor.clone().sub(centre);
    if (dir.lengthSq() < 1e-9) dir.set(0, 1, 0);
    dir.normalize();
    const reach = diagonal * (LEADER_REACH + (placed.length % 3) * LEADER_STAGGER);
    placed.push({ annotation, anchor, label: anchor.clone().addScaledVector(dir, reach), triangles });
  });
  return { placed, diagonal };
}

const SETTLE_MS = 150;

function Arrowhead({ from, to, size, color }: { from: THREE.Vector3; to: THREE.Vector3; size: number; color: string }) {
  // A cone at `to`, its tip pointing along from -> to.
  const quaternion = useMemo(
    () => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize()),
    [from, to],
  );
  const position = useMemo(() => to.clone().addScaledVector(to.clone().sub(from).normalize(), -size / 2), [from, to, size]);
  return (
    <mesh position={position} quaternion={quaternion} renderOrder={102}>
      <coneGeometry args={[size * 0.35, size, 10]} />
      <meshBasicMaterial color={color} depthTest={false} />
    </mesh>
  );
}

export function DimensionOverlay({ geometry }: { geometry: THREE.BufferGeometry }) {
  const state = React.useContext(DimensionOverlayCtx);
  const placement = useMemo(
    () => (state && state.annotations.length > 0 ? placeAnnotations(geometry, state.faceMap, state.annotations) : null),
    [geometry, state],
  );
  const highlight = useMemo(() => {
    const sel = placement?.placed.find((p) => p.annotation.id === state?.selectedId);
    if (!sel) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(subsetPositions(geometry.getAttribute('position').array as Float32Array, sel.triangles), 3));
    return g;
  }, [placement, state?.selectedId, geometry]);
  React.useEffect(() => () => { highlight?.dispose(); }, [highlight]);

  // Label positions after the screen-space separation; the placement's own positions until the camera settles.
  const groupRef = React.useRef<THREE.Group>(null);
  const { camera, size } = useThree();
  const [spread, setSpread] = React.useState<{ source: unknown; labels: THREE.Vector3[] } | null>(null);
  const lastView = React.useRef(new THREE.Matrix4());
  const movedAt = React.useRef<number | null>(0);
  useFrame(() => {
    const group = groupRef.current;
    if (!group || !placement || !(camera as THREE.PerspectiveCamera).isPerspectiveCamera) return;
    const view = camera.matrixWorld;
    if (!view.equals(lastView.current)) { lastView.current.copy(view); movedAt.current = performance.now(); return; }
    if (movedAt.current == null || performance.now() - movedAt.current < SETTLE_MS) return;
    movedAt.current = null;
    group.updateWorldMatrix(true, false);
    const ndc = new THREE.Vector3();
    const projected = placement.placed.map(({ annotation, label }) => {
      const world = label.clone().applyMatrix4(group.matrixWorld);
      ndc.copy(world).project(camera);
      return { world, x: (ndc.x + 1) / 2 * size.width, y: (1 - ndc.y) / 2 * size.height, w: annotation.label.length * LABEL_CHAR_PX + LABEL_PAD_PX, depth: ndc.z };
    });
    const offsets = separateLabels(projected);
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    const fov = (camera as THREE.PerspectiveCamera).fov * Math.PI / 180;
    const labels = projected.map((p, i) => {
      const unitsPerPx = (2 * p.world.distanceTo(camera.position) * Math.tan(fov / 2)) / size.height;
      const moved = p.world.clone().addScaledVector(right, offsets[i]!.dx * unitsPerPx).addScaledVector(up, -offsets[i]!.dy * unitsPerPx);
      return group.worldToLocal(moved);
    });
    setSpread({ source: placement, labels });
  });

  if (!state || !placement) return null;
  const arrow = placement.diagonal * 0.02;
  const labelAt = (i: number, fallback: THREE.Vector3) => (spread?.source === placement ? spread.labels[i] ?? fallback : fallback);
  return (
    <group ref={groupRef}>
      {highlight && (
        <mesh geometry={highlight} renderOrder={101}>
          <meshBasicMaterial color={TEAL_SELECTED} transparent opacity={0.9} depthTest={false} side={THREE.DoubleSide} />
        </mesh>
      )}
      {placement.placed.map(({ annotation, anchor, label: baseLabel }, i) => {
        const label = labelAt(i, baseLabel);
        const selected = annotation.id === state.selectedId;
        const color = selected ? TEAL_SELECTED : TEAL;
        return (
          <group key={annotation.id}>
            <Line points={[label, anchor]} color={color} lineWidth={1} depthTest={false} renderOrder={102} />
            <Arrowhead from={label} to={anchor} size={arrow} color={color} />
            <Html position={label} center zIndexRange={[20, 0]} style={{ pointerEvents: 'auto' }}>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); state.onSelect(selected ? null : annotation.id); }}
                title={`${annotation.featureType}: ${annotation.label}`}
                style={{
                  color, background: 'rgba(15,23,42,0.55)', border: `1px solid ${color}`, borderRadius: 3,
                  padding: '0 4px', font: '600 12px/16px ui-monospace, SFMono-Regular, Menlo, monospace',
                  whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none',
                }}
              >
                {annotation.label}
              </button>
            </Html>
          </group>
        );
      })}
    </group>
  );
}

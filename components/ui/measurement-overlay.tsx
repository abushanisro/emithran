'use client';

import { useMemo, useEffect } from 'react';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
// ─── Color Palette ────────────────────────────────────────────────────────────
export const RESULT_COLOR_PAIRS: { a: string; b: string }[] = [
  { a: '#22c55e', b: '#ef4444' },
  { a: '#3b82f6', b: '#f97316' },
  { a: '#a855f7', b: '#eab308' },
  { a: '#06b6d4', b: '#f43f5e' },
  { a: '#10b981', b: '#f59e0b' },
  { a: '#6366f1', b: '#fb923c' },
];
export function getResultColors(idx: number) {
  return RESULT_COLOR_PAIRS[idx % RESULT_COLOR_PAIRS.length]!;
}

// ─── Data Types ───────────────────────────────────────────────────────────────

export type MeasureUnit = 'mm' | 'cm' | 'in';
export type MeasureMode = 'IDLE' | 'PICKING_A' | 'PICKING_B' | 'DONE';
export type MeasureSubMode = 'auto' | 'face' | 'edge' | 'point' | 'arc';

export interface FaceSelection {
  type: 'face';
  triangleIndices: number[];
  normal: THREE.Vector3;
  centroid: THREE.Vector3;
}

export interface EdgeSelection {
  type: 'edge';
  start: THREE.Vector3;
  end: THREE.Vector3;
  midpoint: THREE.Vector3;
}

export interface VertexSelection {
  type: 'vertex';
  point: THREE.Vector3;
}

export interface ArcSelection {
  type: 'arc';
  center: THREE.Vector3;
  radius: number;
  axis: THREE.Vector3;
  triangleIndices: number[];
}

export type MeasureSelection = FaceSelection | EdgeSelection | VertexSelection | ArcSelection;

export interface MeasureResult {
  id: string;
  selA: MeasureSelection;
  selB: MeasureSelection;
  measureType: 'face-face' | 'edge-edge' | 'point-point' | 'arc-arc' | 'mixed';
  distanceMm: number;
  deltaXMm: number;
  deltaYMm: number;
  deltaZMm: number;
  normalDistanceMm?: number;
  isParallel?: boolean;
  lineStart: THREE.Vector3;
  lineEnd: THREE.Vector3;
  createdAt: number;
}

export const UNIT_SCALE: Record<MeasureUnit, number> = { mm: 1, cm: 0.1, in: 0.0393701 };

export function getSelectionPoint(sel: MeasureSelection): THREE.Vector3 {
  if (sel.type === 'face') return sel.centroid.clone();
  if (sel.type === 'edge') return sel.midpoint.clone();
  if (sel.type === 'arc')  return sel.center.clone();
  return sel.point.clone();
}

// ─── Canvas Sub-components ────────────────────────────────────────────────────

function SphereMarker({ position, color, size }: {
  position: THREE.Vector3; color: string; size: number;
}) {
  return (
    <mesh position={position} renderOrder={999}>
      <sphereGeometry args={[size, 12, 12]} />
      <meshBasicMaterial color={color} depthTest={false} transparent />
    </mesh>
  );
}

function MeasureLine({ from, to, color, opacity = 1 }: {
  from: THREE.Vector3; to: THREE.Vector3; color: string; opacity?: number;
}) {
  const key = [from, to]
    .map(v => `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`)
    .join('|') + color;

  const obj = useMemo(() => {
    const g = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
    const m = new THREE.LineDashedMaterial({
      color, dashSize: 0.06, gapSize: 0.04,
      depthTest: false, transparent: true, opacity,
    });
    const line = new THREE.Line(g, m);
    line.computeLineDistances();
    return line;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, opacity]);

  useEffect(() => () => {
    obj.geometry.dispose();
    (obj.material as THREE.Material).dispose();
  }, [obj]);

  return <primitive object={obj} renderOrder={998} />;
}

// ─── Main Overlay (inside R3F Canvas) ────────────────────────────────────────

interface MeasurementOverlayProps {
  mode: MeasureMode;
  selA: MeasureSelection | null;
  results: MeasureResult[];
  unit: MeasureUnit;
  markerSize: number;
  selectedResultId?: string | null;
}

export function MeasurementOverlay({ mode, selA, results, unit, markerSize, selectedResultId }: MeasurementOverlayProps) {
  const scale = UNIT_SCALE[unit];
  const visibleResults = selectedResultId ? results.filter(r => r.id === selectedResultId) : results;

  return (
    <>
      {/* In-progress: locked Point A marker while waiting for B */}
      {selA && mode === 'PICKING_B' && (
        <SphereMarker position={getSelectionPoint(selA)} color="#60a5fa" size={markerSize} />
      )}

      {/* Completed measurements — filtered by selection */}
      {visibleResults.map((r) => {
        const idx = results.indexOf(r);
        const { a: colA, b: colB } = getResultColors(idx);
        const mid = new THREE.Vector3()
          .addVectors(r.lineStart, r.lineEnd)
          .multiplyScalar(0.5);

        let label = '';
        if (r.measureType === 'arc-arc') {
          const a = r.selA as ArcSelection, b = r.selB as ArcSelection;
          label = `Ø${(a.radius * 2 * scale).toFixed(2)} ↔ Ø${(b.radius * 2 * scale).toFixed(2)}`;
        } else if (r.normalDistanceMm !== undefined) {
          label = `${(r.normalDistanceMm * scale).toFixed(2)} ${unit}`;
        } else {
          label = `${(r.distanceMm * scale).toFixed(2)} ${unit}`;
        }

        // Line color = midpoint between A and B colors (blend to white-ish)
        const lineColor = '#facc15';

        return (
          <group key={r.id}>
            <SphereMarker position={r.lineStart} color={colA} size={markerSize} />
            <SphereMarker position={r.lineEnd}   color={colB} size={markerSize} />
            <MeasureLine from={r.lineStart} to={r.lineEnd} color={lineColor} />
            <Html position={mid} center style={{ pointerEvents: 'none' }}>
              <div style={{
                background: 'rgba(0,0,0,0.88)',
                color: '#fff',
                padding: '2px 8px',
                borderRadius: 5,
                fontSize: 11,
                fontFamily: 'monospace',
                whiteSpace: 'nowrap',
                border: `1px solid ${colA}88`,
                boxShadow: `0 2px 8px rgba(0,0,0,0.7), 0 0 0 1px ${colA}44`,
              }}>
                {label}
              </div>
            </Html>
          </group>
        );
      })}
    </>
  );
}

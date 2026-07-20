'use client';

import React, { Suspense, useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Grid, Center, Html } from '@react-three/drei';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import * as THREE from 'three';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Card } from '@/components/ui/card';
import { computeHeatmap } from '@/lib/heatmap/engine';
import { MANUFACTURING_RISK_RAMP } from '@/lib/heatmap/ramps';
import type { HeatmapSource, HeatmapNormalization } from '@/lib/heatmap/types';
import {
  Home,
  Download,
  Eye,
  Box,
  Grid3x3,
  Loader2,
  Maximize,
  Play,
  Pause,
  Slice,
  Square,
  PanelRightClose,
  PanelRightOpen,
  Target,
  Clock,
  AlertTriangle,
  Crosshair,
  Layers,
  Ruler,
  X,
} from 'lucide-react';
import { MeasurementOverlay } from './measurement-overlay';
import type { MeasureMode, MeasureSubMode, MeasureSelection, MeasureResult, MeasureUnit, ArcSelection } from './measurement-overlay';
import { getResultColors } from './measurement-overlay';
import { MeasurementPanel } from './measurement-panel';

const RISK_HIGHLIGHT_COLORS: Record<string, string> = {
  low: '#22c55e',
  medium: '#eab308',
  high: '#f97316',
  critical: '#ef4444',
};

// Manufacturing Feature Interface
interface ManufacturingFeature {
  id: string;
  type: 'hole' | 'pocket' | 'slot' | 'boss' | 'rib' | 'thin_wall' | 'overhang' | 'undercut';
  position: { x: number; y: number; z: number };
  dimensions: { length?: number; width?: number; diameter?: number; depth?: number };
  manufacturingProcess: string;
  cycleTime: number;
  tooling: string[];
  warnings: string[];
  aiRecommendations: string[];
}

// Feature Graph v2 occurrence highlight types
interface FaceMapEntry {
  face_id: number;    // OCC face ordinal from TopExp_Explorer walk
  tri_start: number;  // index of first STL triangle for this face
  tri_count: number;  // number of STL triangles belonging to this face
}
interface FeatureOccurrenceHL {
  centroid: [number, number, number]; // Three.js-centered coords: abs − part_bbox_center
  face_ids: number[];                 // OCC face indices — always an array; empty if pre-face_map
}
interface FeatureNodeV2HL {
  id: string;
  feature_type: string;
  occurrences: FeatureOccurrenceHL[];
  bbox_centered?: { x_min: number; x_max: number; y_min: number; y_max: number };
  diameter_mm?: number;
  radius_mm?: number;
  normal?: [number, number, number];
}

interface EDrawingsViewerProps {
  fileUrl: string;
  fileName: string;
  isExploded?: boolean;
  explodeDistance?: number;
  onMeasurements?: (data: {
    volume: number;
    dimensions: { x: number; y: number; z: number };
    surfaceArea: number;
    projectedArea?: number;
  }) => void;
  manufacturingFeatures?: ManufacturingFeature[];
  selectedFeature?: ManufacturingFeature | null;
  onFeatureSelect?: (feature: ManufacturingFeature | null) => void;
  showFeatures?: boolean;
  selectedBOMItems?: any[];
  showOnlySelected?: boolean;
  hoveredBOMItem?: any;
  onPartsDetected?: (parts: any[]) => void;
  dfmAnalysisData?: any;
  cameraPreset?: 'top' | 'front' | 'right' | 'isometric' | null;
  onScreenshotReady?: (dataUrl: string) => void;
  // Feature Graph v2 occurrence highlighting
  highlightOccurrences?: FeatureNodeV2HL | null;
  selectedOccurrenceIndex?: number | null;
  onOccurrenceSelect?: (index: number | null) => void;
  /** face_map from feature_graph_v2.metadata — enables exact face highlighting */
  faceMap?: FaceMapEntry[] | null;
  /** Sheet thickness in mm — sizes HAZ ring (holes) and influence zone (bends) */
  sheetThickness?: number;
  /** Per-occurrence DFM risk scores — drives highlight color when provided */
  dfmOccurrenceScores?: Array<{ occurrenceIndex: number; riskLevel: string }>;
  /** Heatmap sources — when non-empty, vertex color heatmap replaces flat feature highlights */
  heatmapSources?: import('@/lib/heatmap/types').HeatmapSource[];
  heatmapNormalization?: import('@/lib/heatmap/types').HeatmapNormalization;
  /** Called when user clicks the model surface while heatmap is active */
  onHeatmapInspect?: (worldPos: [number, number, number], triangleIndex: number, riskValue: number) => void;
  /** Override the amber group-face highlight color — used for operation-specific visualization */
  highlightColor?: string;
}

// Helper: safely get BufferAttribute from geometry
function getBufferAttribute(geometry: THREE.BufferGeometry, name: string): THREE.BufferAttribute | null {
  const attr = geometry.attributes[name];
  if (!attr) return null;
  return attr as THREE.BufferAttribute;
}

// ─── Measurement Algorithms ───────────────────────────────────────────────────

// Compute per-triangle normals from a non-indexed BufferGeometry
function computeTriangleNormals(pos: THREE.BufferAttribute, triCount: number): THREE.Vector3[] {
  const out: THREE.Vector3[] = new Array(triCount);
  for (let i = 0; i < triCount; i++) {
    const a = new THREE.Vector3(pos.getX(i*3),   pos.getY(i*3),   pos.getZ(i*3));
    const b = new THREE.Vector3(pos.getX(i*3+1), pos.getY(i*3+1), pos.getZ(i*3+1));
    const c = new THREE.Vector3(pos.getX(i*3+2), pos.getY(i*3+2), pos.getZ(i*3+2));
    out[i] = new THREE.Vector3()
      .crossVectors(new THREE.Vector3().subVectors(b, a), new THREE.Vector3().subVectors(c, a))
      .normalize();
  }
  return out;
}

// Build adjacency: adj[i] = list of triangle indices that share an edge with triangle i
function buildTriangleAdjacency(pos: THREE.BufferAttribute, triCount: number): number[][] {
  const SCALE = 1e4;
  const round = (v: number) => Math.round(v * SCALE);
  const vtMap = new Map<string, number[]>();

  for (let ti = 0; ti < triCount; ti++) {
    for (let vi = 0; vi < 3; vi++) {
      const idx = ti * 3 + vi;
      const k = `${round(pos.getX(idx))},${round(pos.getY(idx))},${round(pos.getZ(idx))}`;
      const list = vtMap.get(k);
      if (list) list.push(ti); else vtMap.set(k, [ti]);
    }
  }

  const sharedCount = new Map<string, number>();
  for (const tris of vtMap.values()) {
    if (tris.length < 2) continue;
    for (let i = 0; i < tris.length; i++) {
      for (let j = i + 1; j < tris.length; j++) {
        const a = Math.min(tris[i]!, tris[j]!), b = Math.max(tris[i]!, tris[j]!);
        const k = `${a},${b}`;
        sharedCount.set(k, (sharedCount.get(k) ?? 0) + 1);
      }
    }
  }

  const adj: number[][] = Array.from({ length: triCount }, () => []);
  for (const [k, cnt] of sharedCount) {
    if (cnt >= 2) {
      const [a, b] = k.split(',').map(Number) as [number, number];
      adj[a]!.push(b); adj[b]!.push(a);
    }
  }
  return adj;
}

// BFS to find the connected flat face group starting from a triangle
function findFaceGroup(
  startTri: number,
  normals: THREE.Vector3[],
  adj: number[][],
  threshold = 0.9994, // cos(2°)
): number[] {
  const startNormal = normals[startTri];
  if (!startNormal) return [startTri];
  const visited = new Uint8Array(normals.length);
  visited[startTri] = 1;
  const queue = [startTri];
  const result = [startTri];
  let qi = 0;
  while (qi < queue.length && result.length < 5000) {
    const cur = queue[qi++]!;
    for (const nb of (adj[cur] ?? [])) {
      if (visited[nb]) continue;
      visited[nb] = 1;
      if (normals[nb]!.dot(startNormal) >= threshold) {
        result.push(nb);
        queue.push(nb);
      }
    }
  }
  return result;
}

// Screen-space distance from point (px,py) to segment (x1,y1)-(x2,y2)
function screenDistToSeg(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx*dx + dy*dy;
  if (lenSq < 0.001) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1)*dx + (py - y1)*dy) / lenSq));
  return Math.hypot(px - (x1 + t*dx), py - (y1 + t*dy));
}

// Closest points between two line segments — standard Eberly algorithm
function closestPointsOnSegments(
  p1: THREE.Vector3, p2: THREE.Vector3,
  p3: THREE.Vector3, p4: THREE.Vector3,
): { cp1: THREE.Vector3; cp2: THREE.Vector3; dist: number } {
  const d1 = new THREE.Vector3().subVectors(p2, p1);
  const d2 = new THREE.Vector3().subVectors(p4, p3);
  const r  = new THREE.Vector3().subVectors(p1, p3);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r);
  let s: number, t: number;
  if (a <= 1e-10 && e <= 1e-10) {
    return { cp1: p1.clone(), cp2: p3.clone(), dist: r.length() };
  }
  if (a <= 1e-10) {
    s = 0; t = Math.max(0, Math.min(1, f / e));
  } else {
    const c = d1.dot(r);
    if (e <= 1e-10) {
      t = 0; s = Math.max(0, Math.min(1, -c / a));
    } else {
      const b = d1.dot(d2), denom = a * e - b * b;
      s = denom > 1e-10 ? Math.max(0, Math.min(1, (b*f - c*e) / denom)) : 0;
      t = (b*s + f) / e;
      if (t < 0) { t = 0; s = Math.max(0, Math.min(1, -c / a)); }
      else if (t > 1) { t = 1; s = Math.max(0, Math.min(1, (b - c) / a)); }
    }
  }
  const cp1 = p1.clone().addScaledVector(d1, s);
  const cp2 = p3.clone().addScaledVector(d2, t);
  return { cp1, cp2, dist: cp1.distanceTo(cp2) };
}

// Compute the full measurement result between two selections
function computeMeasurementBetween(selA: MeasureSelection, selB: MeasureSelection): Omit<MeasureResult, 'id' | 'createdAt'> {
  let lineStart: THREE.Vector3;
  let lineEnd: THREE.Vector3;
  let normalDistanceMm: number | undefined;
  let isParallel: boolean | undefined;
  let measureType: MeasureResult['measureType'];

  const getPoint = (s: MeasureSelection): THREE.Vector3 => {
    if (s.type === 'face')   return s.centroid.clone();
    if (s.type === 'edge')   return s.midpoint.clone();
    if (s.type === 'arc')    return s.center.clone();
    return s.point.clone();
  };

  if (selA.type === 'arc' && selB.type === 'arc') {
    measureType = 'arc-arc';
    lineStart = selA.center.clone();
    lineEnd   = selB.center.clone();
    // Check if coaxial
    const axisDot = Math.abs(selA.axis.dot(selB.axis));
    isParallel = axisDot > 0.9994;
    if (isParallel) {
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(selA.axis, selA.center);
      normalDistanceMm = Math.abs(plane.distanceToPoint(selB.center));
    }
  } else if (selA.type === 'arc') {
    measureType = 'mixed';
    lineStart = selA.center.clone();
    lineEnd   = getPoint(selB);
    if (selB.type === 'face') {
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(selB.normal, selB.centroid);
      normalDistanceMm = Math.abs(plane.distanceToPoint(selA.center));
    }
  } else if (selB.type === 'arc') {
    return computeMeasurementBetween(selB, selA);
  } else if (selA.type === 'face' && selB.type === 'face') {
    measureType = 'face-face';
    const dot = Math.abs(selA.normal.dot(selB.normal));
    isParallel = dot > 0.9994;
    lineStart = selA.centroid.clone();
    if (isParallel) {
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(selA.normal, selA.centroid);
      normalDistanceMm = Math.abs(plane.distanceToPoint(selB.centroid));
      lineEnd = selB.centroid.clone().addScaledVector(selA.normal, -plane.distanceToPoint(selB.centroid));
    } else {
      lineEnd = selB.centroid.clone();
    }
  } else if (selA.type === 'edge' && selB.type === 'edge') {
    measureType = 'edge-edge';
    const { cp1, cp2, dist } = closestPointsOnSegments(selA.start, selA.end, selB.start, selB.end);
    lineStart = cp1; lineEnd = cp2;
    normalDistanceMm = dist;
  } else if (selA.type === 'vertex' && selB.type === 'vertex') {
    measureType = 'point-point';
    lineStart = selA.point.clone();
    lineEnd   = selB.point.clone();
  } else if (selA.type === 'face' && selB.type === 'vertex') {
    measureType = 'mixed';
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(selA.normal, selA.centroid);
    normalDistanceMm = Math.abs(plane.distanceToPoint(selB.point));
    lineStart = selA.centroid.clone();
    lineEnd   = selB.point.clone();
  } else if (selA.type === 'vertex' && selB.type === 'face') {
    return computeMeasurementBetween(selB, selA);
  } else {
    measureType = 'mixed';
    lineStart = getPoint(selA);
    lineEnd   = getPoint(selB);
  }

  const dv = new THREE.Vector3().subVectors(lineEnd, lineStart);
  return {
    selA, selB, measureType,
    distanceMm: lineStart.distanceTo(lineEnd),
    deltaXMm: dv.x, deltaYMm: dv.y, deltaZMm: dv.z,
    normalDistanceMm, isParallel,
    lineStart, lineEnd,
  };
}

// Standard CAD views configuration
const getCADViews = (distance: number) => ({
  home: { position: [distance, distance, distance] as [number, number, number], name: 'Home' },
  front: { position: [0, 0, distance] as [number, number, number], name: 'Front' },
  back: { position: [0, 0, -distance] as [number, number, number], name: 'Back' },
  top: { position: [0, distance, 0] as [number, number, number], name: 'Top' },
  bottom: { position: [0, -distance, 0] as [number, number, number], name: 'Bottom' },
  right: { position: [distance, 0, 0] as [number, number, number], name: 'Right' },
  left: { position: [-distance, 0, 0] as [number, number, number], name: 'Left' },
  isometric: { position: [distance, distance, distance] as [number, number, number], name: 'Isometric' },
});

// View direction vectors for projected face highlighting
const VIEW_DIRECTIONS: Record<string, [number, number, number]> = {
  front:     [0, 0, 1],
  back:      [0, 0, -1],
  top:       [0, 1, 0],
  bottom:    [0, -1, 0],
  right:     [1, 0, 0],
  left:      [-1, 0, 0],
  home:      [0.577, 0.577, 0.577],
  isometric: [0.577, 0.577, 0.577],
};

const VIEW_COLORS: Record<string, string> = {
  front:     '#06b6d4',
  back:      '#f97316',
  top:       '#22c55e',
  bottom:    '#a855f7',
  right:     '#3b82f6',
  left:      '#ef4444',
  home:      '#60a5fa',
  isometric: '#60a5fa',
};

function computeProjectedFaces(geometry: THREE.BufferGeometry, view: string): number[] {
  const pos = geometry.attributes.position as THREE.BufferAttribute;
  if (!pos) return [];
  const dirArr = VIEW_DIRECTIONS[view] ?? VIEW_DIRECTIONS.front!;
  const viewDir = new THREE.Vector3(...dirArr).normalize();
  const indices: number[] = [];
  const triangleCount = Math.floor(pos.count / 3);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), normal = new THREE.Vector3();
  for (let i = 0; i < triangleCount; i++) {
    a.fromBufferAttribute(pos, i * 3);
    b.fromBufferAttribute(pos, i * 3 + 1);
    c.fromBufferAttribute(pos, i * 3 + 2);
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    normal.crossVectors(ab, ac).normalize();
    if (normal.dot(viewDir) > 0.1) indices.push(i);
  }
  return indices;
}

function CameraFitter({
  onFit,
  resetKey,
}: {
  onFit: (distance: number, center: THREE.Vector3) => void;
  resetKey?: string;
}) {
  const { scene, camera, controls } = useThree();
  const fitted = useRef(false);

  useEffect(() => {
    fitted.current = false;
  }, [resetKey]);

  // Poll every frame until geometry is in the scene (STL loads async).
  useFrame(() => {
    if (fitted.current) return;

    const box = new THREE.Box3();
    scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) box.expandByObject(obj);
    });

    if (box.isEmpty()) return; // not loaded yet

    const center = new THREE.Vector3();
    box.getCenter(center);
    const size = box.getSize(new THREE.Vector3());

    // Use bounding-sphere radius so every dimension fits, regardless of aspect ratio.
    const radius = Math.sqrt(size.x ** 2 + size.y ** 2 + size.z ** 2) / 2;

    // Skip tiny helper objects (measurement points, axes markers) — wait for the real mesh.
    if (radius < 5) return;

    const perspCam = camera as THREE.PerspectiveCamera;
    const fov = perspCam.fov * (Math.PI / 180);
    // 1.9× gives comfortable padding without pushing past the clipping plane.
    const distance = (radius / Math.tan(fov / 2)) * 1.9;

    // Expand clipping planes to fit this specific model's scale before moving the camera.
    perspCam.near = Math.max(0.01, distance * 0.001);
    perspCam.far = distance * 20;
    perspCam.updateProjectionMatrix();

    // Isometric-ish angle (x=1, y=0.7, z=1 normalised) offset from center.
    const dir = new THREE.Vector3(1, 0.7, 1).normalize();
    camera.position.copy(center).addScaledVector(dir, distance);
    camera.lookAt(center);

    if (controls && 'target' in controls) {
      (controls as any).target.copy(center);
      (controls as any).update();
    }

    fitted.current = true;
    onFit(distance, center);
  });

  return null;
}

function AutoRotate({ isAnimating }: { isAnimating: boolean }) {
  const { camera } = useThree();

  useFrame(() => {
    if (isAnimating) {
      const radius = Math.sqrt(camera.position.x ** 2 + camera.position.z ** 2);
      const angle = Math.atan2(camera.position.z, camera.position.x);
      const newAngle = angle + 0.01;
      camera.position.x = radius * Math.cos(newAngle);
      camera.position.z = radius * Math.sin(newAngle);
      camera.lookAt(0, 0, 0);
    }
  });

  return null;
}

function AxesOrientation({ onOrientationChange }: { onOrientationChange: (matrix: THREE.Matrix4) => void }) {
  const { camera } = useThree();
  const lastUpdate = useRef(0);

  useFrame(({ clock }) => {
    if (clock.elapsedTime - lastUpdate.current > 0.066) {
      onOrientationChange(camera.matrixWorldInverse.clone());
      lastUpdate.current = clock.elapsedTime;
    }
  });

  return null;
}

function calculateVolume(geometry: THREE.BufferGeometry): number {
  const position = getBufferAttribute(geometry, 'position');
  if (!position) return 0;

  let volume = 0;
  for (let i = 0; i < position.count; i += 3) {
    const v1 = new THREE.Vector3(position.getX(i), position.getY(i), position.getZ(i));
    const v2 = new THREE.Vector3(position.getX(i + 1), position.getY(i + 1), position.getZ(i + 1));
    const v3 = new THREE.Vector3(position.getX(i + 2), position.getY(i + 2), position.getZ(i + 2));
    volume += v1.dot(v2.cross(v3)) / 6.0;
  }
  return Math.abs(volume);
}

// ─── DFM Color Constants ──────────────────────────────────────────────────────
const DFM_COLORS = {
  hole:      { hex: '#FF4757', rgb: [1.0, 0.278, 0.341] as [number, number, number], label: 'Holes' },
  pocket:    { hex: '#1E90FF', rgb: [0.118, 0.565, 1.0]  as [number, number, number], label: 'Pockets' },
  thin_wall: { hex: '#FFA502', rgb: [1.0, 0.647, 0.008] as [number, number, number], label: 'Thin Walls' },
  undercut:  { hex: '#9B59B6', rgb: [0.608, 0.349, 0.714] as [number, number, number], label: 'Undercuts' },
  slot:      { hex: '#2ED573', rgb: [0.180, 0.835, 0.451] as [number, number, number], label: 'Slots' },
  overhang:  { hex: '#FF6B81', rgb: [1.0, 0.42, 0.506]  as [number, number, number], label: 'Overhangs' },
} as const;

type DFMType = keyof typeof DFM_COLORS;

function DFMLegend({ activeTypes }: { activeTypes: DFMType[] }) {
  if (activeTypes.length === 0) return null;
  return (
    <Html
      position={[-999, -999, 0]}
      style={{ position: 'fixed', bottom: 72, left: 16, pointerEvents: 'none', userSelect: 'none' }}
    >
      <div style={{
        background: 'rgba(20,20,30,0.85)',
        backdropFilter: 'blur(8px)',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 10,
        padding: '8px 12px',
        minWidth: 140,
        boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
      }}>
        <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 10, fontWeight: 600, letterSpacing: 1, marginBottom: 6 }}>
          DFM LEGEND
        </div>
        {activeTypes.map(type => (
          <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
            <div style={{
              width: 12, height: 12, borderRadius: '50%',
              background: DFM_COLORS[type].hex,
              boxShadow: `0 0 6px ${DFM_COLORS[type].hex}99`,
              flexShrink: 0,
            }} />
            <span style={{ color: '#fff', fontSize: 11, fontWeight: 500 }}>{DFM_COLORS[type].label}</span>
          </div>
        ))}
      </div>
    </Html>
  );
}

function DFMColorMesh({
  geometry,
  features,
  selectedFeatureType,
  onFaceClick,
}: {
  geometry: THREE.BufferGeometry;
  features: ManufacturingFeature[];
  selectedFeatureType: string | null;
  onFaceClick: (type: string, worldPosition?: THREE.Vector3) => void;
}) {
  const coloredGeo = useMemo(() => {
    try {
      if (!geometry || !features || features.length === 0) return null;

      const geo = geometry.clone();
      const posAttr = getBufferAttribute(geo, 'position');
      if (!posAttr || posAttr.count === 0) return null;
      if (posAttr.count % 3 !== 0) {
        console.warn('DFM: Invalid geometry - vertex count not divisible by 3');
        return null;
      }

      geo.computeBoundingBox();
      const bbox = geo.boundingBox;
      if (!bbox) return null;

      const size = new THREE.Vector3();
      bbox.getSize(size);
      const center = new THREE.Vector3();
      bbox.getCenter(center);

      if (size.x === 0 || size.y === 0 || size.z === 0) {
        console.warn('DFM: Invalid bounding box - zero dimension detected');
        return null;
      }

      const halfX = size.x / 2 || 1;
      const halfZ = size.z / 2 || 1;

      const hasHoles     = features.some(f => f.type === 'hole');
      const hasPockets   = features.some(f => f.type === 'pocket');
      const hasUndercuts = features.some(f => f.type === 'undercut');
      const hasThinWalls = features.some(f => f.type === 'thin_wall');
      const hasSlots     = features.some(f => f.type === 'slot');
      const hasOverhangs = features.some(f => f.type === 'overhang');

      const minDim = Math.min(size.x, size.y, size.z);
      const thinThreshold = minDim * 0.18;

      const count = posAttr.count;
      const colors = new Float32Array(count * 3);
      const BASE: [number, number, number] = [0.65, 0.72, 0.82];

      for (let i = 0; i < count; i++) {
        colors[i * 3]     = BASE[0];
        colors[i * 3 + 1] = BASE[1];
        colors[i * 3 + 2] = BASE[2];
      }

      const v: [THREE.Vector3, THREE.Vector3, THREE.Vector3] = [
        new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()
      ];
      const edge1 = new THREE.Vector3();
      const edge2 = new THREE.Vector3();
      const normal = new THREE.Vector3();
      const centroid = new THREE.Vector3();

      for (let i = 0; i < count; i += 3) {
        try {
          if (i + 2 >= count) break;

          v[0].set(posAttr.getX(i),   posAttr.getY(i),   posAttr.getZ(i));
          v[1].set(posAttr.getX(i+1), posAttr.getY(i+1), posAttr.getZ(i+1));
          v[2].set(posAttr.getX(i+2), posAttr.getY(i+2), posAttr.getZ(i+2));

          if (!isFinite(v[0].x) || !isFinite(v[1].x) || !isFinite(v[2].x)) {
            for (let j = 0; j < 3; j++) {
              colors[(i + j) * 3]     = BASE[0];
              colors[(i + j) * 3 + 1] = BASE[1];
              colors[(i + j) * 3 + 2] = BASE[2];
            }
            continue;
          }

          edge1.subVectors(v[1], v[0]);
          edge2.subVectors(v[2], v[0]);
          normal.crossVectors(edge1, edge2);

          if (normal.length() < 1e-6) {
            for (let j = 0; j < 3; j++) {
              colors[(i + j) * 3]     = BASE[0];
              colors[(i + j) * 3 + 1] = BASE[1];
              colors[(i + j) * 3 + 2] = BASE[2];
            }
            continue;
          }

          normal.normalize();
          centroid.addVectors(v[0], v[1]).add(v[2]).divideScalar(3);

          const nx = centroid.x / halfX;
          const nz = centroid.z / halfZ;

          const onOuterPerimXZ =
            Math.abs(centroid.x - bbox.min.x) < size.x * 0.08 ||
            Math.abs(centroid.x - bbox.max.x) < size.x * 0.08 ||
            Math.abs(centroid.z - bbox.min.z) < size.z * 0.08 ||
            Math.abs(centroid.z - bbox.max.z) < size.z * 0.08;

          const rXZ = Math.sqrt(centroid.x * centroid.x + centroid.z * centroid.z);
          const normalHorizontal = Math.abs(normal.y) < 0.28;
          const normalUp   = normal.y > 0.65;
          const normalDown = normal.y < -0.45;

          let color: [number, number, number] = BASE;
          let detectedFeature: string | null = null;

          if (hasUndercuts && normalDown && centroid.y > bbox.min.y + size.y * 0.05) {
            detectedFeature = 'undercut';
          } else if (hasPockets && normalUp && centroid.y < bbox.max.y - size.y * 0.06 && centroid.y > bbox.min.y + size.y * 0.1) {
            detectedFeature = 'pocket';
          } else if (hasHoles) {
            const isVerticalFace = Math.abs(normal.y) < 0.6;
            const isHorizontalFace = Math.abs(normal.y) > 0.4;
            const distanceFromEdgeX = Math.min(
              Math.abs(centroid.x - bbox.min.x),
              Math.abs(centroid.x - bbox.max.x)
            );
            const distanceFromEdgeZ = Math.min(
              Math.abs(centroid.z - bbox.min.z),
              Math.abs(centroid.z - bbox.max.z)
            );
            const minEdgeDistance = Math.min(distanceFromEdgeX, distanceFromEdgeZ);
            const isInterior = minEdgeDistance > size.x * 0.05;
            const maxRadius = Math.min(halfX, halfZ) * 0.95;
            const minRadius = Math.min(size.x, size.z) * 0.01;
            const isReasonableSize = rXZ >= minRadius && rXZ <= maxRadius;
            if ((isVerticalFace || isHorizontalFace) && isInterior && isReasonableSize) {
              detectedFeature = 'hole';
            }
          } else if (hasSlots && normalHorizontal && !onOuterPerimXZ) {
            detectedFeature = 'slot';
          } else if (hasThinWalls && normalHorizontal && onOuterPerimXZ) {
            const edgeLen = Math.max(edge1.length(), edge2.length());
            if (edgeLen < thinThreshold * 2) {
              detectedFeature = 'thin_wall';
            }
          } else if (hasOverhangs && normalUp && (Math.abs(nx) > 0.7 || Math.abs(nz) > 0.7)) {
            detectedFeature = 'overhang';
          }

          if (detectedFeature) {
            if (selectedFeatureType === null) {
              color = DFM_COLORS[detectedFeature as DFMType].rgb;
            } else if (selectedFeatureType === detectedFeature) {
              color = DFM_COLORS[detectedFeature as DFMType].rgb;
            }
          }

          for (let j = 0; j < 3; j++) {
            colors[(i + j) * 3]     = color[0];
            colors[(i + j) * 3 + 1] = color[1];
            colors[(i + j) * 3 + 2] = color[2];
          }
        } catch {
          for (let j = 0; j < 3; j++) {
            colors[(i + j) * 3]     = BASE[0];
            colors[(i + j) * 3 + 1] = BASE[1];
            colors[(i + j) * 3 + 2] = BASE[2];
          }
        }
      }

      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      return geo;
    } catch (err) {
      console.error('DFM color mesh generation failed:', err);
      return null;
    }
  }, [geometry, features, selectedFeatureType]);

  if (!coloredGeo) return null;

  const handleMeshClick = (event: any) => {
    try {
      event.stopPropagation();
      const intersection = event.intersections?.[0];
      if (!intersection || !intersection.face || !intersection.point) return;

      const face = intersection.face;
      const worldPoint = intersection.point as THREE.Vector3;
      const colors = coloredGeo.attributes.color as THREE.BufferAttribute;
      if (!colors || !face) return;

      const colorSamples = [
        { r: colors.getX(face.a * 3), g: colors.getY(face.a * 3), b: colors.getZ(face.a * 3) },
        { r: colors.getX(face.b * 3), g: colors.getY(face.b * 3), b: colors.getZ(face.b * 3) },
        { r: colors.getX(face.c * 3), g: colors.getY(face.c * 3), b: colors.getZ(face.c * 3) },
      ];

      let bestMatch: string | null = null;
      let bestScore = Infinity;

      const testColors = [
        { type: 'hole', ...DFM_COLORS.hole },
        { type: 'pocket', ...DFM_COLORS.pocket },
        { type: 'thin_wall', ...DFM_COLORS.thin_wall },
        { type: 'undercut', ...DFM_COLORS.undercut },
        { type: 'slot', ...DFM_COLORS.slot },
        { type: 'overhang', ...DFM_COLORS.overhang },
      ];

      for (const testColor of testColors) {
        for (const sample of colorSamples) {
          const distance = Math.sqrt(
            Math.pow(sample.r - testColor.rgb[0], 2) +
            Math.pow(sample.g - testColor.rgb[1], 2) +
            Math.pow(sample.b - testColor.rgb[2], 2)
          );
          if (distance < bestScore && distance < 0.15) {
            bestScore = distance;
            bestMatch = testColor.type;
          }
        }
      }

      if (bestMatch) {
        onFaceClick(bestMatch, worldPoint);
      }
    } catch (err) {
      console.warn('DFM click detection error:', err);
    }
  };

  return (
    <group>
      <mesh
        geometry={coloredGeo}
        onClick={handleMeshClick}
        onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer'; }}
        onPointerOut={() => { document.body.style.cursor = 'auto'; }}
      >
        <meshStandardMaterial
          vertexColors
          transparent
          opacity={0.92}
          metalness={0.15}
          roughness={0.45}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

// ─── Measurement Highlight Components ────────────────────────────────────────

/** Build a BufferGeometry from a subset of STL triangles.  expand > 0 offsets vertices
 *  outward along each triangle's face normal by that distance (mm) — used for glow outlines. */
function useSubsetGeometry(
  triangleIndices: number[],
  geometry: THREE.BufferGeometry,
  expand: number,
): THREE.BufferGeometry | null {
  const geo = useMemo(() => {
    const posAttr = getBufferAttribute(geometry, 'position');
    if (!posAttr || triangleIndices.length === 0) return null;
    const verts = new Float32Array(triangleIndices.length * 9);
    triangleIndices.forEach((ti, i) => {
      const ax = posAttr.getX(ti*3),   ay = posAttr.getY(ti*3),   az = posAttr.getZ(ti*3);
      const bx = posAttr.getX(ti*3+1), by = posAttr.getY(ti*3+1), bz = posAttr.getZ(ti*3+1);
      const cx = posAttr.getX(ti*3+2), cy = posAttr.getY(ti*3+2), cz = posAttr.getZ(ti*3+2);
      let dx = 0, dy = 0, dz = 0;
      if (expand !== 0) {
        const ex = bx-ax, ey = by-ay, ez = bz-az;
        const fx = cx-ax, fy = cy-ay, fz = cz-az;
        const nx = ey*fz - ez*fy, ny = ez*fx - ex*fz, nz = ex*fy - ey*fx;
        const len = Math.sqrt(nx*nx + ny*ny + nz*nz) || 1;
        dx = (nx/len)*expand; dy = (ny/len)*expand; dz = (nz/len)*expand;
      }
      verts[i*9+0]=ax+dx; verts[i*9+1]=ay+dy; verts[i*9+2]=az+dz;
      verts[i*9+3]=bx+dx; verts[i*9+4]=by+dy; verts[i*9+5]=bz+dz;
      verts[i*9+6]=cx+dx; verts[i*9+7]=cy+dy; verts[i*9+8]=cz+dz;
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    return g;
  }, [triangleIndices, geometry, expand]);
  useEffect(() => () => { geo?.dispose(); }, [geo]);
  return geo;
}

function FaceHighlight({ triangleIndices, geometry, color, opacity = 0.45 }: {
  triangleIndices: number[];
  geometry: THREE.BufferGeometry;
  color: string;
  opacity?: number;
}) {
  const geo = useSubsetGeometry(triangleIndices, geometry, 0);
  if (!geo) return null;
  return (
    <mesh geometry={geo} renderOrder={100}>
      <meshBasicMaterial color={color} transparent opacity={opacity} depthTest={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

/** Selected-occurrence highlight: solid orange fill + BackSide glow ring from normal-expanded geometry. */
function SelectedFaceHighlight({
  triangleIndices,
  geometry,
  color = '#f97316',
}: {
  triangleIndices: number[];
  geometry: THREE.BufferGeometry;
  color?: string;
}) {
  const fillGeo = useSubsetGeometry(triangleIndices, geometry, 0);
  const glowGeo = useSubsetGeometry(triangleIndices, geometry, 0.3);
  if (!fillGeo) return null;
  return (
    <group>
      {glowGeo && (
        <mesh geometry={glowGeo} renderOrder={99}>
          <meshBasicMaterial color={color} side={THREE.BackSide} transparent opacity={0.85} depthTest={false} />
        </mesh>
      )}
      <mesh geometry={fillGeo} renderOrder={100}>
        <meshBasicMaterial color={color} transparent opacity={0.95} depthTest={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

// Context used to pass featureType + sheetThickness from EDrawingsViewer into the Canvas
// tree without touching STLModel/Scene prop types (avoids exactOptionalPropertyTypes cascade).
const FeatureOverlayCtx = React.createContext<{ featureType: string; sheetThickness: number }>({
  featureType: '',
  sheetThickness: 2,
});

/**
 * Synthetic disc overlay for laser-cut holes: solid orange fill + yellow HAZ ring.
 * HAZ width = sheet_thickness × 1.0 (laser heat affected zone).
 * Positioned just above the model surface using the feature normal.
 * Uses depthTest=true/depthWrite=false so it renders on the model surface, not floating.
 */
function HoleDiscOverlay({
  centroid,
  diameter_mm,
  normal = [0, 0, 1],
  sheetThickness = 2.0,
}: {
  centroid: [number, number, number];
  diameter_mm: number;
  normal?: [number, number, number];
  sheetThickness?: number;
}) {
  const quaternion = useMemo(() => {
    const n = new THREE.Vector3(...normal).normalize();
    return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
  }, [normal]);

  const r = diameter_mm / 2;
  const hazR = r + sheetThickness * 1.0;
  // Offset disc to just above the model surface (normal direction × half-thickness + small gap)
  const offset = sheetThickness / 2 + 0.3;
  const pos: [number, number, number] = [
    centroid[0] + normal[0] * offset,
    centroid[1] + normal[1] * offset,
    centroid[2] + normal[2] * offset,
  ];

  return (
    <group position={pos} quaternion={quaternion}>
      {/* HAZ ring — yellow disc at hazR, orange fill covers center leaving visible yellow ring */}
      <mesh renderOrder={101}>
        <circleGeometry args={[hazR, 48]} />
        <meshBasicMaterial
          color="#fbbf24" transparent opacity={0.40}
          depthTest={true} depthWrite={false}
          polygonOffset={true} polygonOffsetFactor={-2} polygonOffsetUnits={-2}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* Solid orange fill */}
      <mesh renderOrder={102}>
        <circleGeometry args={[r, 48]} />
        <meshBasicMaterial
          color="#f97316" transparent opacity={0.88}
          depthTest={true} depthWrite={false}
          polygonOffset={true} polygonOffsetFactor={-4} polygonOffsetUnits={-4}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

/**
 * Yellow influence zone around a selected press-brake bend.
 * Influence distance = bend_radius + sheet_thickness × 2 from bend axis.
 * Reuses useSubsetGeometry to expand bend face triangles outward by sheetThickness × 2.
 */
function BendInfluenceGlow({
  triangleIndices,
  geometry,
  sheetThickness = 2.0,
}: {
  triangleIndices: number[];
  geometry: THREE.BufferGeometry;
  sheetThickness?: number;
}) {
  const expand = sheetThickness * 2;
  const influenceGeo = useSubsetGeometry(triangleIndices, geometry, expand);
  if (!influenceGeo) return null;
  return (
    <mesh geometry={influenceGeo} renderOrder={98}>
      <meshBasicMaterial
        color="#fbbf24" transparent opacity={0.28}
        depthTest={true} depthWrite={false}
        side={THREE.BackSide}
      />
    </mesh>
  );
}

// Context-aware wrapper — reads featureType/sheetThickness from FeatureOverlayCtx
// so STLModel and Scene don't need useContext in their bodies.
function ContextBendInfluenceGlow({
  occurrenceFaceIndices,
  geometry,
}: {
  occurrenceFaceIndices: number[] | undefined;
  geometry: THREE.BufferGeometry;
}) {
  const { featureType, sheetThickness } = React.useContext(FeatureOverlayCtx);
  if (featureType !== 'bend' || !occurrenceFaceIndices?.length) return null;
  return (
    <BendInfluenceGlow
      triangleIndices={occurrenceFaceIndices}
      geometry={geometry}
      sheetThickness={sheetThickness}
    />
  );
}

function ContextHoleDiscOverlay({
  highlightOccurrences,
  selectedOccurrenceIndex,
}: {
  highlightOccurrences: FeatureNodeV2HL | null | undefined;
  selectedOccurrenceIndex: number | null;
}) {
  const { featureType, sheetThickness } = React.useContext(FeatureOverlayCtx);
  if (featureType !== 'hole' || selectedOccurrenceIndex === null) return null;
  const occ = highlightOccurrences?.occurrences[selectedOccurrenceIndex];
  if (!occ) return null;
  return (
    <HoleDiscOverlay
      centroid={occ.centroid}
      diameter_mm={highlightOccurrences!.diameter_mm ?? 5}
      {...(highlightOccurrences!.normal ? { normal: highlightOccurrences!.normal } : {})}
      sheetThickness={sheetThickness}
    />
  );
}

function EdgeHighlight({ start, end, color }: {
  start: THREE.Vector3; end: THREE.Vector3; color: string;
}) {
  const obj = useMemo(() => {
    const g = new THREE.BufferGeometry().setFromPoints([start.clone(), end.clone()]);
    const m = new THREE.LineBasicMaterial({ color, depthTest: false, linewidth: 4 });
    const line = new THREE.Line(g, m);
    return line;
  }, [start, end, color]);
  useEffect(() => () => {
    obj.geometry.dispose();
    (obj.material as THREE.Material).dispose();
  }, [obj]);
  return <primitive object={obj} renderOrder={101} />;
}

function VertexHighlight({ point, color, size }: {
  point: THREE.Vector3; color: string; size: number;
}) {
  return (
    <mesh position={point} renderOrder={102}>
      <sphereGeometry args={[size * 1.5, 10, 10]} />
      <meshBasicMaterial color={color} depthTest={false} transparent opacity={0.9} />
    </mesh>
  );
}


// triggerKey encodes what's selected (featureId + occurrence index) so the effect re-fires
// whenever the selection changes, not just when the feature type changes.
// cx/cy/viewSpan are read from refs at fire time to avoid stale closures.
function FeatureZoomEffect({
  triggerKey,
  cx,
  cy,
  viewSpan,
}: {
  triggerKey: string | undefined;
  cx: number;
  cy: number;
  viewSpan: number;
}) {
  const { camera, controls } = useThree();
  const cxRef = React.useRef(cx);
  const cyRef = React.useRef(cy);
  const spanRef = React.useRef(viewSpan);
  cxRef.current = cx;
  cyRef.current = cy;
  spanRef.current = viewSpan;

  useEffect(() => {
    if (!triggerKey || !controls || !('target' in controls)) return;
    const span = Math.max(spanRef.current, 8);
    const fov = (camera as THREE.PerspectiveCamera).fov * (Math.PI / 180);
    const dist = (span / (2 * Math.tan(fov / 2))) * 1.8;
    (controls as any).target.set(cxRef.current, cyRef.current, 0);
    camera.position.set(cxRef.current, cyRef.current, dist);
    (controls as any).update();
  }, [triggerKey, camera, controls]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

// Detect cylindrical surface (hole/boss) from a hit triangle
function detectCylinder(
  faceIndex: number,
  pos: THREE.BufferAttribute,
  normals: THREE.Vector3[],
  adj: number[][],
  mesh: THREE.Mesh,
): ArcSelection | null {
  // BFS with loose threshold — cylindrical normals rotate so tight threshold would miss them
  const visited = new Uint8Array(normals.length);
  visited[faceIndex] = 1;
  const queue = [faceIndex];
  const group: number[] = [faceIndex];
  let qi = 0;
  while (qi < queue.length && group.length < 3000) {
    const cur = queue[qi++]!;
    for (const nb of (adj[cur] ?? [])) {
      if (visited[nb]) continue;
      visited[nb] = 1;
      if ((normals[nb]?.dot(normals[cur]!) ?? 0) > 0.17) {
        group.push(nb);
        queue.push(nb);
      }
    }
  }
  if (group.length < 6) return null;

  // Find cylinder axis — cross product of two non-parallel normals in the group
  const n0 = normals[group[0]!]!;
  let axis: THREE.Vector3 | null = null;
  for (let i = 1; i < group.length; i++) {
    const ni = normals[group[i]!]!;
    if (Math.abs(n0.dot(ni)) < 0.98) {
      axis = new THREE.Vector3().crossVectors(n0, ni).normalize();
      break;
    }
  }
  if (!axis) return null;

  // Verify all normals are roughly perpendicular to the axis (cylindrical check)
  const sample = Math.min(group.length, 30);
  let perpCount = 0;
  for (let i = 0; i < sample; i++) {
    if (Math.abs(normals[group[i]!]!.dot(axis)) < 0.20) perpCount++;
  }
  if (perpCount < sample * 0.6) return null;

  // Collect world-space vertices
  const worldVerts: THREE.Vector3[] = [];
  for (const ti of group) {
    for (let vi = 0; vi < 3; vi++) {
      const idx = ti * 3 + vi;
      const v = new THREE.Vector3(pos.getX(idx), pos.getY(idx), pos.getZ(idx));
      worldVerts.push(mesh.localToWorld(v));
    }
  }

  // Centroid + world axis
  const centroid = new THREE.Vector3();
  for (const v of worldVerts) centroid.add(v);
  centroid.divideScalar(worldVerts.length);
  const worldAxis = axis.clone().transformDirection(mesh.matrixWorld).normalize();

  // Compute per-vertex radial distances from axis through centroid
  const radii: number[] = worldVerts.map(v => {
    const d = new THREE.Vector3().subVectors(v, centroid);
    const axComp = worldAxis.clone().multiplyScalar(d.dot(worldAxis));
    return new THREE.Vector3().subVectors(d, axComp).length();
  });

  const avgR = radii.reduce((a, b) => a + b, 0) / radii.length;
  if (avgR < 1e-6) return null;
  const stdDev = Math.sqrt(radii.reduce((acc, r) => acc + (r - avgR) ** 2, 0) / radii.length);
  if (stdDev / avgR > 0.25) return null; // too irregular to be a circle

  return { type: 'arc', center: centroid, radius: avgR, axis: worldAxis, triangleIndices: group };
}

// Classify a raycast hit into face / edge / vertex / arc selection
function classifyHit(
  hit: THREE.Intersection,
  camera: THREE.Camera,
  normals: THREE.Vector3[],
  adj: number[][],
  subMode: MeasureSubMode = 'auto',
): MeasureSelection {
  const mesh = hit.object as THREE.Mesh;
  const pos = getBufferAttribute(mesh.geometry as THREE.BufferGeometry, 'position');
  if (!pos || hit.faceIndex == null) {
    return { type: 'vertex', point: hit.point.clone() };
  }

  const faceIndex = hit.faceIndex;
  const triBase = faceIndex * 3;

  const getWorldVert = (idx: number) => {
    const v = new THREE.Vector3(pos.getX(idx), pos.getY(idx), pos.getZ(idx));
    return mesh.localToWorld(v);
  };

  const vA = getWorldVert(triBase);
  const vB = getWorldVert(triBase + 1);
  const vC = getWorldVert(triBase + 2);

  // ── Arc/circle mode ──────────────────────────────────────────────────────
  if (subMode === 'arc') {
    const arc = detectCylinder(faceIndex, pos, normals, adj, mesh);
    if (arc) return arc;
    // Fallback: snap to nearest vertex
    return { type: 'vertex', point: vA };
  }

  // ── Point mode ───────────────────────────────────────────────────────────
  if (subMode === 'point') {
    // Return nearest vertex of the hit triangle
    const project = (v: THREE.Vector3) => {
      const ndc = v.clone().project(camera);
      return { x: (ndc.x + 1) * window.innerWidth / 2, y: (-ndc.y + 1) * window.innerHeight / 2 };
    };
    const hitNDC = hit.point.clone().project(camera);
    const px = (hitNDC.x + 1) * window.innerWidth / 2;
    const py = (-hitNDC.y + 1) * window.innerHeight / 2;
    let bestV = vA, bestDist = Infinity;
    for (const v of [vA, vB, vC]) {
      const s = project(v);
      const d = Math.hypot(px - s.x, py - s.y);
      if (d < bestDist) { bestDist = d; bestV = v; }
    }
    return { type: 'vertex', point: bestV };
  }

  // ── Edge mode ─────────────────────────────────────────────────────────────
  if (subMode === 'edge') {
    const project = (v: THREE.Vector3) => {
      const ndc = v.clone().project(camera);
      return { x: (ndc.x + 1) * window.innerWidth / 2, y: (-ndc.y + 1) * window.innerHeight / 2 };
    };
    const hitNDC = hit.point.clone().project(camera);
    const px = (hitNDC.x + 1) * window.innerWidth / 2;
    const py = (-hitNDC.y + 1) * window.innerHeight / 2;
    const sA = project(vA), sB = project(vB), sC = project(vC);
    let bestEdgeDist = Infinity;
    let bestEdge = { start: vA, end: vB, midpoint: new THREE.Vector3().addVectors(vA, vB).multiplyScalar(0.5) };
    for (const [p1, p2, s1, s2] of [
      [vA, vB, sA, sB], [vB, vC, sB, sC], [vC, vA, sC, sA],
    ] as [THREE.Vector3, THREE.Vector3, {x:number;y:number}, {x:number;y:number}][]) {
      const d = screenDistToSeg(px, py, s1.x, s1.y, s2.x, s2.y);
      if (d < bestEdgeDist) {
        bestEdgeDist = d;
        bestEdge = { start: p1.clone(), end: p2.clone(), midpoint: new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5) };
      }
    }
    return { type: 'edge', ...bestEdge };
  }

  // ── Face mode ─────────────────────────────────────────────────────────────
  if (subMode === 'face') {
    const triIndices = findFaceGroup(faceIndex, normals, adj);
    const centroid = new THREE.Vector3();
    for (const ti of triIndices) {
      for (let vi = 0; vi < 3; vi++) {
        const idx = ti * 3 + vi;
        const v = new THREE.Vector3(pos.getX(idx), pos.getY(idx), pos.getZ(idx));
        mesh.localToWorld(v);
        centroid.add(v);
      }
    }
    centroid.divideScalar(triIndices.length * 3);
    const faceNormal = (normals[faceIndex] ?? new THREE.Vector3(0, 1, 0)).clone()
      .transformDirection(mesh.matrixWorld).normalize();
    return { type: 'face', triangleIndices: triIndices, normal: faceNormal, centroid };
  }

  // ── Auto mode ─────────────────────────────────────────────────────────────
  const project = (v: THREE.Vector3) => {
    const ndc = v.clone().project(camera);
    return { x: (ndc.x + 1) * window.innerWidth / 2, y: (-ndc.y + 1) * window.innerHeight / 2 };
  };
  const sA = project(vA), sB = project(vB), sC = project(vC);
  const hitNDC = hit.point.clone().project(camera);
  const px = (hitNDC.x + 1) * window.innerWidth / 2;
  const py = (-hitNDC.y + 1) * window.innerHeight / 2;

  // Vertex snap — 14px
  for (const { v, s } of [{ v: vA, s: sA }, { v: vB, s: sB }, { v: vC, s: sC }]) {
    if (Math.hypot(px - s.x, py - s.y) < 14) return { type: 'vertex', point: v };
  }

  // Edge snap — 10px
  let bestEdgeDist = Infinity;
  let bestEdge: { start: THREE.Vector3; end: THREE.Vector3; midpoint: THREE.Vector3 } | null = null;
  for (const [p1, p2, s1, s2] of [
    [vA, vB, sA, sB], [vB, vC, sB, sC], [vC, vA, sC, sA],
  ] as [THREE.Vector3, THREE.Vector3, {x:number;y:number}, {x:number;y:number}][]) {
    const d = screenDistToSeg(px, py, s1.x, s1.y, s2.x, s2.y);
    if (d < 10 && d < bestEdgeDist) {
      bestEdgeDist = d;
      bestEdge = { start: p1.clone(), end: p2.clone(), midpoint: new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5) };
    }
  }
  if (bestEdge) return { type: 'edge', ...bestEdge };

  // Auto-detect arc: try tight face group first, if small → try cylinder
  const tightGroup = findFaceGroup(faceIndex, normals, adj);
  if (tightGroup.length <= 8) {
    const arc = detectCylinder(faceIndex, pos, normals, adj, mesh);
    if (arc) return arc;
  }

  // Face
  const centroid = new THREE.Vector3();
  for (const ti of tightGroup) {
    for (let vi = 0; vi < 3; vi++) {
      const idx = ti * 3 + vi;
      const v = new THREE.Vector3(pos.getX(idx), pos.getY(idx), pos.getZ(idx));
      mesh.localToWorld(v);
      centroid.add(v);
    }
  }
  centroid.divideScalar(tightGroup.length * 3);
  const faceNormal = (normals[faceIndex] ?? new THREE.Vector3(0, 1, 0)).clone()
    .transformDirection(mesh.matrixWorld).normalize();
  return { type: 'face', triangleIndices: tightGroup, normal: faceNormal, centroid };
}

interface ExplodedPart {
  geometry: THREE.BufferGeometry;
  centroid: THREE.Vector3;
  boundingBox: THREE.Box3;
  explosionDirection: THREE.Vector3;
  targetPosition: THREE.Vector3;
  currentPosition: THREE.Vector3;
  id: string;
}

function calculateBoundingBoxDimensions(geometry: THREE.BufferGeometry) {
  try {
    geometry.computeBoundingBox();
    const bbox = geometry.boundingBox;
    if (!bbox) return { length: 0, width: 0, height: 0 };
    const size = new THREE.Vector3();
    bbox.getSize(size);
    return {
      length: Math.round(size.x * 1000) / 1000,
      width: Math.round(size.y * 1000) / 1000,
      height: Math.round(size.z * 1000) / 1000,
    };
  } catch (err) {
    console.warn('Error calculating dimensions:', err);
    return { length: 0, width: 0, height: 0 };
  }
}

function STLModel({
  url,
  color,
  sectionPlane,
  isTransparent,
  isWireframe,
  isExploded,
  explodeDistance,
  onLoad,
  onMeasurements,
  onGeometryLoad,
  manufacturingFeatures,
  selectedFeature,
  onFeatureSelect,
  showFeatures,
  selectedBOMItems,
  showOnlySelected,
  hoveredBOMItem,
  onPartsDetected,
  measureMode,
  measureSubMode,
  measureSelA,
  measureResults,
  selectedResultId,
  onMeasureClick,
  onMeasureHover,
  projectedFaceIndices,
  projectedHighlightColor,
  showProjectedHighlight,
  occurrenceFaceIndices,
  isDimmed,
  groupFaceIndices,
  riskGroups = [],
  selectedOccurrenceColor = '#f97316',
  groupHighlightColor,
  heatmapActive = false,
  heatmapSources,
  heatmapNormalization,
  heatmapRiskValuesRef,
  onHeatmapInspect,
}: {
  url: string;
  color: string;
  sectionPlane: number;
  isTransparent: boolean;
  isWireframe: boolean;
  isExploded?: boolean;
  explodeDistance?: number;
  onLoad?: () => void;
  onMeasurements?: (data: { volume: number; dimensions: { x: number; y: number; z: number }; surfaceArea: number; projectedArea?: number }) => void;
  onGeometryLoad?: (geometry: THREE.BufferGeometry) => void;
  manufacturingFeatures?: ManufacturingFeature[];
  selectedFeature?: ManufacturingFeature | null;
  onFeatureSelect?: (feature: ManufacturingFeature | null) => void;
  showFeatures?: boolean;
  selectedBOMItems?: any[];
  showOnlySelected?: boolean;
  hoveredBOMItem?: any;
  onPartsDetected?: (parts: any[]) => void;
  measureMode?: MeasureMode;
  measureSubMode?: MeasureSubMode;
  measureSelA?: MeasureSelection | null;
  measureResults?: MeasureResult[];
  selectedResultId?: string | null;
  onMeasureClick?: (sel: MeasureSelection) => void;
  onMeasureHover?: (sel: MeasureSelection | null) => void;
  projectedFaceIndices?: number[] | null;
  projectedHighlightColor?: string;
  showProjectedHighlight?: boolean;
  occurrenceFaceIndices?: number[];
  /** Dim the main mesh when face highlights are active */
  isDimmed?: boolean;
  /** Triangle indices for all occurrences of the selected feature (group highlight, fallback amber) */
  groupFaceIndices?: number[];
  /** Risk-level-bucketed triangle indices — replaces amber group when scores are available */
  riskGroups: Array<{ level: string; indices: number[] }>;
  /** Color for selected occurrence highlight — risk color when scores available, else orange */
  selectedOccurrenceColor: string;
  /** Override the fallback amber (#d97706) group-face color — used for operation-specific visualization */
  groupHighlightColor?: string;
  /** When true, vertex color heatmap is active — material uses vertexColors */
  heatmapActive?: boolean;
  /** Heatmap sources — when provided, STLModel computes and applies vertex colors */
  heatmapSources?: HeatmapSource[];
  /** Normalization mode for heatmap engine */
  heatmapNormalization?: HeatmapNormalization;
  /** Ref holding per-triangle risk values (0–1) from heatmap engine — for inspector */
  heatmapRiskValuesRef?: React.RefObject<Float32Array | null>;
  /** Called when user clicks model surface while heatmap is active */
  onHeatmapInspect?: ((worldPos: [number, number, number], triangleIndex: number, riskValue: number) => void) | undefined;
}) {
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  const [explodedParts, setExplodedParts] = useState<ExplodedPart[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingStage, setLoadingStage] = useState<string>('Initializing...');
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [previewReady, _setPreviewReady] = useState(false);
  const [detailsReady, _setDetailsReady] = useState(false);

  const meshRef = useRef<THREE.Mesh>(null);
  const groupRef = useRef<THREE.Group>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial | null>(null);

  // ─── Measurement classification refs ─────────────────────────────────────
  const normalsRef = useRef<THREE.Vector3[]>([]);
  const adjRef = useRef<number[][]>([]);
  const [localHoverSel, setLocalHoverSel] = useState<MeasureSelection | null>(null);

  // ─── Part Separation Helpers ──────────────────────────────────────────────

  const createPartGeometry = useCallback((
    faceIndices: number[],
    partIndex: number,
    totalParts: number,
    position: THREE.BufferAttribute,
    originalGeometry: THREE.BufferGeometry,
  ): ExplodedPart => {
    const partVertices: number[] = [];
    const partGeometry = new THREE.BufferGeometry();

    for (const faceIdx of faceIndices) {
      for (let vertIdx = 0; vertIdx < 3; vertIdx++) {
        const idx = faceIdx * 3 + vertIdx;
        partVertices.push(position.getX(idx), position.getY(idx), position.getZ(idx));
      }
    }

    partGeometry.setAttribute('position', new THREE.Float32BufferAttribute(partVertices, 3));
    partGeometry.computeVertexNormals();
    partGeometry.computeBoundingBox();

    const bbox = partGeometry.boundingBox!;
    const centroid = new THREE.Vector3();
    bbox.getCenter(centroid);

    const assemblyBBox = originalGeometry.boundingBox!;
    const assemblyCenter = new THREE.Vector3();
    assemblyBBox.getCenter(assemblyCenter);
    const assemblySize = new THREE.Vector3();
    assemblyBBox.getSize(assemblySize);

    let explosionDirection = new THREE.Vector3().subVectors(centroid, assemblyCenter);
    explosionDirection.divide(assemblySize).normalize();

    if (explosionDirection.length() < 0.1) {
      const ringCount = Math.ceil(Math.sqrt(totalParts));
      const ring = Math.floor(partIndex / ringCount);
      const posInRing = partIndex % ringCount;
      const angleStep = (2 * Math.PI) / Math.max(1, ringCount);
      const angle = posInRing * angleStep + ring * 0.3;
      const radius = 0.7 + ring * 0.3;
      const height = Math.sin(angle * 2) * 0.4 + ring * 0.2;
      explosionDirection.set(Math.cos(angle) * radius, height, Math.sin(angle) * radius).normalize();
    } else {
      const absX = Math.abs(explosionDirection.x);
      const absY = Math.abs(explosionDirection.y);
      const absZ = Math.abs(explosionDirection.z);
      if (absX > absY && absX > absZ) {
        explosionDirection.x *= 1.5;
      } else if (absY > absX && absY > absZ) {
        explosionDirection.y *= 1.5;
      } else {
        explosionDirection.z *= 1.5;
      }
      explosionDirection.normalize();
    }

    return {
      geometry: partGeometry,
      centroid: centroid.clone(),
      boundingBox: bbox.clone(),
      explosionDirection: explosionDirection.clone(),
      targetPosition: new THREE.Vector3(0, 0, 0),
      currentPosition: new THREE.Vector3(0, 0, 0), // Start at model origin — vertices encode position
      id: `part-${partIndex + 1}`,
    };
  }, []);

  const createSimplifiedExplodedView = useCallback((geo: THREE.BufferGeometry): ExplodedPart[] => {
    geo.computeBoundingBox();
    const center = new THREE.Vector3();
    geo.boundingBox!.getCenter(center);
    const posAttr = geo.attributes['position'] as THREE.BufferAttribute;
    if (!posAttr) return [];
    const faceCount = Math.floor(posAttr.count / 3);

    // Bucket faces by 60° wedge of face centroid in XZ plane
    const buckets: number[][] = Array.from({ length: 6 }, () => []);
    for (let f = 0; f < faceCount; f++) {
      const cx = (posAttr.getX(f*3) + posAttr.getX(f*3+1) + posAttr.getX(f*3+2)) / 3 - center.x;
      const cz = (posAttr.getZ(f*3) + posAttr.getZ(f*3+1) + posAttr.getZ(f*3+2)) / 3 - center.z;
      const angle = Math.atan2(cz, cx);
      const bucket = Math.floor(((angle + Math.PI) / (Math.PI * 2)) * 6) % 6;
      buckets[bucket]!.push(f);
    }

    const nonEmpty = buckets.filter(b => b.length > 0);
    return nonEmpty.map((faceIndices, i) =>
      createPartGeometry(faceIndices, i, nonEmpty.length, posAttr, geo)
    );
  }, [createPartGeometry]);

  const getSharedVertices = useCallback((
    faceA: number,
    faceB: number,
    position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
    tolerance: number,
  ): number => {
    const verticesA: number[][] = [];
    const verticesB: number[][] = [];

    for (let i = 0; i < 3; i++) {
      const idxA = faceA * 3 + i;
      const idxB = faceB * 3 + i;
      verticesA.push([position.getX(idxA), position.getY(idxA), position.getZ(idxA)]);
      verticesB.push([position.getX(idxB), position.getY(idxB), position.getZ(idxB)]);
    }

    let sharedCount = 0;
    for (const vA of verticesA) {
      for (const vB of verticesB) {
        const dist = Math.sqrt((vA[0]! - vB[0]!) ** 2 + (vA[1]! - vB[1]!) ** 2 + (vA[2]! - vB[2]!) ** 2);
        if (dist < tolerance) {
          sharedCount++;
          break;
        }
      }
    }
    return sharedCount;
  }, []);

  const detectGeometricParts = useCallback((
    position: THREE.BufferAttribute,
    faceCount: number,
    bbox: THREE.Box3,
  ): number[][] => {
    const size = new THREE.Vector3();
    bbox.getSize(size);
    const gridSize = 6;
    const cellSize = { x: size.x / gridSize, y: size.y / gridSize, z: size.z / gridSize };
    const spatialCells = new Map<string, number[]>();

    for (let faceIdx = 0; faceIdx < faceCount; faceIdx++) {
      const centroid = new THREE.Vector3();
      for (let vertIdx = 0; vertIdx < 3; vertIdx++) {
        const idx = faceIdx * 3 + vertIdx;
        centroid.add(new THREE.Vector3(position.getX(idx), position.getY(idx), position.getZ(idx)));
      }
      centroid.divideScalar(3);

      const cellX = Math.max(0, Math.min(gridSize - 1, Math.floor((centroid.x - bbox.min.x) / cellSize.x)));
      const cellY = Math.max(0, Math.min(gridSize - 1, Math.floor((centroid.y - bbox.min.y) / cellSize.y)));
      const cellZ = Math.max(0, Math.min(gridSize - 1, Math.floor((centroid.z - bbox.min.z) / cellSize.z)));
      const cellKey = `${cellX}-${cellY}-${cellZ}`;

      if (!spatialCells.has(cellKey)) spatialCells.set(cellKey, []);
      spatialCells.get(cellKey)!.push(faceIdx);
    }

    const geometricParts: number[][] = [];
    for (const [, faces] of spatialCells.entries()) {
      if (faces.length > 10) geometricParts.push(faces);
    }
    return geometricParts;
  }, []);

  const consolidateAdjacentParts = useCallback((
    components: number[][],
    _position: THREE.BufferAttribute,
    faceConnections: Map<number, Set<number>>,
  ): number[][] => {
    if (components.length <= 22) return components;

    const sortedComponents = [...components].sort((a, b) => a.length - b.length);
    const consolidated: number[][] = [];
    const used = new Set<number>();

    for (const component of sortedComponents) {
      if (used.has(component[0]!)) continue;
      let mergedComponent = [...component];
      const avgLen = components.reduce((sum, c) => sum + c.length, 0) / components.length;

      if (component.length < avgLen) {
        for (const face of component) {
          const adjacentFaces = faceConnections.get(face) ?? new Set<number>();
          for (const adjFace of adjacentFaces) {
            const targetComponent = sortedComponents.find(
              comp => comp.includes(adjFace) && !used.has(comp[0]!) && comp !== component,
            );
            if (targetComponent && targetComponent.length > component.length * 2) {
              mergedComponent = [...mergedComponent, ...targetComponent];
              used.add(targetComponent[0]!);
              break;
            }
          }
        }
      }
      used.add(component[0]!);
      consolidated.push(mergedComponent);
    }
    return consolidated.slice(0, 25);
  }, []);

  const createOptimizedPartSeparation = useCallback((geo: THREE.BufferGeometry): ExplodedPart[] => {
    try {
      const position = getBufferAttribute(geo, 'position');
      if (!position) return createSimplifiedExplodedView(geo);

      const faceCount = position.count / 3;
      geo.computeBoundingBox();
      const bbox = geo.boundingBox!;
      const size = new THREE.Vector3();
      bbox.getSize(size);

      const gridSize = 30;
      const cellSize = { x: size.x / gridSize, y: size.y / gridSize, z: size.z / gridSize };
      const cellMap = new Map<string, number[]>();
      const cellDensity = new Map<string, number>();
      const cellNormals = new Map<string, THREE.Vector3[]>();
      const neighborMap = new Map<string, Set<string>>();

      for (let faceIdx = 0; faceIdx < faceCount; faceIdx++) {
        const v1 = new THREE.Vector3(position.getX(faceIdx * 3), position.getY(faceIdx * 3), position.getZ(faceIdx * 3));
        const v2 = new THREE.Vector3(position.getX(faceIdx * 3 + 1), position.getY(faceIdx * 3 + 1), position.getZ(faceIdx * 3 + 1));
        const v3 = new THREE.Vector3(position.getX(faceIdx * 3 + 2), position.getY(faceIdx * 3 + 2), position.getZ(faceIdx * 3 + 2));

        const faceCentroid = new THREE.Vector3().addVectors(v1, v2).add(v3).divideScalar(3);
        const edge1 = new THREE.Vector3().subVectors(v2, v1);
        const edge2 = new THREE.Vector3().subVectors(v3, v1);
        const faceNormal = new THREE.Vector3().crossVectors(edge1, edge2).normalize();
        const faceArea = new THREE.Vector3().crossVectors(edge1, edge2).length() / 2;

        const clampedX = Math.max(0, Math.min(gridSize - 1, Math.floor((faceCentroid.x - bbox.min.x) / cellSize.x)));
        const clampedY = Math.max(0, Math.min(gridSize - 1, Math.floor((faceCentroid.y - bbox.min.y) / cellSize.y)));
        const clampedZ = Math.max(0, Math.min(gridSize - 1, Math.floor((faceCentroid.z - bbox.min.z) / cellSize.z)));
        const cellKey = `${clampedX}-${clampedY}-${clampedZ}`;

        if (!cellMap.has(cellKey)) {
          cellMap.set(cellKey, []);
          cellDensity.set(cellKey, 0);
          cellNormals.set(cellKey, []);
        }
        cellMap.get(cellKey)!.push(faceIdx);
        cellDensity.set(cellKey, (cellDensity.get(cellKey) ?? 0) + faceArea);
        cellNormals.get(cellKey)!.push(faceNormal.clone());
      }

      const densityValues = Array.from(cellDensity.values());
      const avgDensity = densityValues.reduce((a, b) => a + b, 0) / (densityValues.length || 1);
      const densityThreshold = avgDensity * 2;

      const densityPeaks: Array<{ key: string; density: number; x: number; y: number; z: number }> = [];

      for (const [cellKey, density] of cellDensity.entries()) {
        if (density < densityThreshold) continue;
        const coords = cellKey.split('-').map(Number);
        const x = coords[0] ?? 0;
        const y = coords[1] ?? 0;
        const z = coords[2] ?? 0;

        let isLocalMax = true;
        outer: for (let dx = -2; dx <= 2; dx++) {
          for (let dy = -2; dy <= 2; dy++) {
            for (let dz = -2; dz <= 2; dz++) {
              if (dx === 0 && dy === 0 && dz === 0) continue;
              const neighborDensity = cellDensity.get(`${x + dx}-${y + dy}-${z + dz}`) ?? 0;
              if (neighborDensity > density) { isLocalMax = false; break outer; }
            }
          }
        }
        if (isLocalMax) densityPeaks.push({ key: cellKey, density, x, y, z });
      }

      densityPeaks.sort((a, b) => b.density - a.density);
      const selectedPeaks = densityPeaks.slice(0, Math.min(50, densityPeaks.length));

      for (const [cellKey, faces] of cellMap.entries()) {
        if (faces.length === 0) continue;
        const neighbors = new Set<string>();
        const coords = cellKey.split('-').map(Number);
        const cx = coords[0] ?? 0;
        const cy = coords[1] ?? 0;
        const cz = coords[2] ?? 0;
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dz = -1; dz <= 1; dz++) {
              if (dx === 0 && dy === 0 && dz === 0) continue;
              const nk = `${cx + dx}-${cy + dy}-${cz + dz}`;
              if ((cellMap.get(nk)?.length ?? 0) > 0) neighbors.add(nk);
            }
          }
        }
        neighborMap.set(cellKey, neighbors);
      }

      const clusters: string[][] = [];
      const visitedCells = new Set<string>();

      for (const peak of selectedPeaks) {
        if (visitedCells.has(peak.key)) continue;
        const cluster: string[] = [peak.key];
        visitedCells.add(peak.key);

        const seedDensity = cellDensity.get(peak.key) ?? 0;
        const neighbors = neighborMap.get(peak.key) ?? new Set<string>();

        for (const neighbor of neighbors) {
          if (visitedCells.has(neighbor)) continue;
          const neighborDensity = cellDensity.get(neighbor) ?? 0;
          const maxD = Math.max(seedDensity, neighborDensity, 1);
          const densityRatio = Math.min(seedDensity, neighborDensity) / maxD;

          const seedNormals = cellNormals.get(peak.key) ?? [];
          const neighborNormals = cellNormals.get(neighbor) ?? [];
          let normalSimilarity = 0;
          if (seedNormals.length > 0 && neighborNormals.length > 0) {
            const avgSeed = seedNormals.reduce((s, n) => s.add(n), new THREE.Vector3()).normalize();
            const avgNeighbor = neighborNormals.reduce((s, n) => s.add(n), new THREE.Vector3()).normalize();
            normalSimilarity = avgSeed.dot(avgNeighbor);
          }

          const isDensitySimilar = densityRatio > 0.85 && Math.abs(seedDensity - neighborDensity) < 5;
          const isNormalSimilar = normalSimilarity > 0.7;

          if (isDensitySimilar && (seedNormals.length === 0 || isNormalSimilar)) {
            cluster.push(neighbor);
            visitedCells.add(neighbor);
          }
        }
        if (cluster.length > 0) clusters.push(cluster);
      }

      const remainingCells = Array.from(cellMap.keys()).filter(
        k => !visitedCells.has(k) && (cellDensity.get(k) ?? 0) > 3,
      );

      for (const cellKey of remainingCells) {
        if (visitedCells.has(cellKey)) continue;
        const cluster: string[] = [cellKey];
        visitedCells.add(cellKey);

        const coords = cellKey.split('-').map(Number);
        const cx = coords[0] ?? 0;
        const cy = coords[1] ?? 0;
        const cz = coords[2] ?? 0;

        for (const otherKey of remainingCells) {
          if (visitedCells.has(otherKey)) continue;
          const oc = otherKey.split('-').map(Number);
          const ox = oc[0] ?? 0;
          const oy = oc[1] ?? 0;
          const oz = oc[2] ?? 0;
          const dist = Math.sqrt((cx - ox) ** 2 + (cy - oy) ** 2 + (cz - oz) ** 2);
          if (dist <= 2) { cluster.push(otherKey); visitedCells.add(otherKey); }
        }
        if (cluster.length > 0) clusters.push(cluster);
      }

      for (const [cellKey, faces] of cellMap.entries()) {
        if (!visitedCells.has(cellKey) && faces.length > 0) {
          clusters.push([cellKey]);
          visitedCells.add(cellKey);
        }
      }

      const avgFacesPerPart = faceCount / 22;
      const minFacesForLargePart = Math.max(10, Math.floor(avgFacesPerPart * 0.02));

      const allClusters = clusters
        .map(cluster => {
          const allFaces: number[] = [];
          for (const ck of cluster) {
            allFaces.push(...(cellMap.get(ck) ?? []));
          }
          return { cluster, faces: allFaces, isSmall: allFaces.length < minFacesForLargePart };
        })
        .filter(({ faces, isSmall }) => isSmall ? faces.length >= 1 : faces.length >= minFacesForLargePart)
        .sort((a, b) => b.faces.length - a.faces.length);

      const significantClusters = allClusters.slice(0, 50);

      return significantClusters.map(({ faces }, partIndex) =>
        createPartGeometry(faces, partIndex, significantClusters.length, position, geo),
      );
    } catch (err) {
      console.error('Optimized separation failed:', err);
      return createSimplifiedExplodedView(geo);
    }
  }, [createSimplifiedExplodedView, createPartGeometry]);

  const createMechanicalPartSeparation = useCallback((geo: THREE.BufferGeometry): ExplodedPart[] => {
    try {
      const position = getBufferAttribute(geo, 'position');
      if (!position) return createSimplifiedExplodedView(geo);

      const faceCount = position.count / 3;
      geo.computeBoundingBox();
      const bbox = geo.boundingBox!;
      const size = new THREE.Vector3();
      bbox.getSize(size);

      const tolerance = Math.min(size.x, size.y, size.z) * 0.001;
      const vertexMap = new Map<string, number[]>();

      for (let faceIdx = 0; faceIdx < faceCount; faceIdx++) {
        for (let vertIdx = 0; vertIdx < 3; vertIdx++) {
          const idx = faceIdx * 3 + vertIdx;
          const x = position.getX(idx);
          const y = position.getY(idx);
          const z = position.getZ(idx);
          const vk = `${Math.round(x / tolerance)}_${Math.round(y / tolerance)}_${Math.round(z / tolerance)}`;
          if (!vertexMap.has(vk)) vertexMap.set(vk, []);
          vertexMap.get(vk)!.push(faceIdx);
        }
      }

      const faceConnections = new Map<number, Set<number>>();
      for (let i = 0; i < faceCount; i++) faceConnections.set(i, new Set());

      for (const [, faces] of vertexMap.entries()) {
        if (faces.length > 1 && faces.length < 8) {
          for (let i = 0; i < faces.length; i++) {
            for (let j = i + 1; j < faces.length; j++) {
              const fA = faces[i]!;
              const fB = faces[j]!;
              if (getSharedVertices(fA, fB, position, tolerance) >= 2) {
                faceConnections.get(fA)!.add(fB);
                faceConnections.get(fB)!.add(fA);
              }
            }
          }
        }
      }

      const visited = new Set<number>();
      const components: number[][] = [];

      for (let faceIdx = 0; faceIdx < faceCount; faceIdx++) {
        if (visited.has(faceIdx)) continue;
        const component: number[] = [];
        const stack: number[] = [faceIdx];
        while (stack.length > 0) {
          const cur = stack.pop()!;
          if (visited.has(cur)) continue;
          visited.add(cur);
          component.push(cur);
          for (const nb of (faceConnections.get(cur) ?? new Set())) {
            if (!visited.has(nb)) stack.push(nb);
          }
        }
        if (component.length > 0) components.push(component);
      }

      const minFacesPerPart = Math.max(100, Math.floor(faceCount * 0.01));
      const maxFacesPerPart = Math.floor(faceCount * 0.8);
      const totalVol = size.x * size.y * size.z;
      const minVol = Math.max(1.0, totalVol * 0.001);

      let sigComponents = components.filter(comp => {
        if (comp.length < minFacesPerPart || comp.length > maxFacesPerPart) return false;
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (const fi of comp) {
          for (let vi = 0; vi < 3; vi++) {
            const idx = fi * 3 + vi;
            const x = position.getX(idx), y = position.getY(idx), z = position.getZ(idx);
            minX = Math.min(minX, x); maxX = Math.max(maxX, x);
            minY = Math.min(minY, y); maxY = Math.max(maxY, y);
            minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
          }
        }
        return (maxX - minX) * (maxY - minY) * (maxZ - minZ) >= minVol;
      });

      if (sigComponents.length < 10) {
        const geomParts = detectGeometricParts(position, faceCount, bbox);
        sigComponents = [...sigComponents, ...geomParts];
      }

      sigComponents.sort((a, b) => b.length - a.length);
      sigComponents = sigComponents.slice(0, 30);

      const consolidated = consolidateAdjacentParts(sigComponents, position, faceConnections);

      vertexMap.clear();
      faceConnections.clear();

      return consolidated.map((faceIndices, idx) =>
        createPartGeometry(faceIndices, idx, consolidated.length, position, geo),
      );
    } catch (err) {
      console.error('Mechanical part separation failed:', err);
      return createOptimizedPartSeparation(geo);
    }
  }, [createSimplifiedExplodedView, getSharedVertices, detectGeometricParts, consolidateAdjacentParts, createPartGeometry, createOptimizedPartSeparation]);

  const separateAssemblyParts = useCallback((geo: THREE.BufferGeometry): ExplodedPart[] => {
    try {
      const position = getBufferAttribute(geo, 'position');
      if (!position) return [];

      const faceCount = position.count / 3;
      const MAX_FACES_FULL = 25000;
      const MAX_FACES_SIMPLIFIED = 200000;

      if (faceCount > MAX_FACES_SIMPLIFIED) {
        return createSimplifiedExplodedView(geo);
      }
      if (faceCount > MAX_FACES_FULL) {
        return createMechanicalPartSeparation(geo);
      }

      geo.computeBoundingBox();
      const bbox = geo.boundingBox!;
      const size = new THREE.Vector3();
      bbox.getSize(size);
      const avgDimension = (size.x + size.y + size.z) / 3;
      const tolerance = Math.max(0.001, avgDimension * 0.0001);

      const vertexMap = new Map<string, number[]>();
      const faceConnections = new Map<number, Set<number>>();
      for (let i = 0; i < faceCount; i++) faceConnections.set(i, new Set());

      const faceNormalMap = new Map<number, THREE.Vector3>();
      for (let faceIdx = 0; faceIdx < faceCount; faceIdx++) {
        const i1 = faceIdx * 3, i2 = faceIdx * 3 + 1, i3 = faceIdx * 3 + 2;
        const v1 = new THREE.Vector3(position.getX(i1), position.getY(i1), position.getZ(i1));
        const v2 = new THREE.Vector3(position.getX(i2), position.getY(i2), position.getZ(i2));
        const v3 = new THREE.Vector3(position.getX(i3), position.getY(i3), position.getZ(i3));
        const n = v2.clone().sub(v1).cross(v3.clone().sub(v1)).normalize();
        faceNormalMap.set(faceIdx, n);
      }

      const BATCH_SIZE = 1000;
      for (let batchStart = 0; batchStart < faceCount; batchStart += BATCH_SIZE) {
        const batchEnd = Math.min(batchStart + BATCH_SIZE, faceCount);
        for (let faceIdx = batchStart; faceIdx < batchEnd; faceIdx++) {
          for (let vi = 0; vi < 3; vi++) {
            const idx = faceIdx * 3 + vi;
            const kx = Math.round(position.getX(idx) / tolerance);
            const ky = Math.round(position.getY(idx) / tolerance);
            const kz = Math.round(position.getZ(idx) / tolerance);
            const key = `${kx}:${ky}:${kz}`;
            if (!vertexMap.has(key)) vertexMap.set(key, []);
            vertexMap.get(key)!.push(faceIdx);
          }
        }
      }

      const normalThreshold = 0.5;
      for (const faceIndices of vertexMap.values()) {
        if (faceIndices.length > 1 && faceIndices.length < 50) {
          for (let i = 0; i < faceIndices.length; i++) {
            for (let j = i + 1; j < faceIndices.length; j++) {
              const fA = faceIndices[i]!;
              const fB = faceIndices[j]!;
              const nA = faceNormalMap.get(fA);
              const nB = faceNormalMap.get(fB);
              if (nA && nB) {
                if (Math.abs(nA.dot(nB)) > normalThreshold) {
                  faceConnections.get(fA)!.add(fB);
                  faceConnections.get(fB)!.add(fA);
                }
              } else {
                faceConnections.get(fA)!.add(fB);
                faceConnections.get(fB)!.add(fA);
              }
            }
          }
        }
      }

      const visited = new Set<number>();
      const components: number[][] = [];

      for (let i = 0; i < faceCount; i++) {
        if (!visited.has(i)) {
          const component: number[] = [];
          const stack: number[] = [i];
          while (stack.length > 0) {
            const cur = stack.pop()!;
            if (visited.has(cur)) continue;
            visited.add(cur);
            component.push(cur);
            for (const nb of (faceConnections.get(cur) ?? new Set())) {
              if (!visited.has(nb)) stack.push(nb);
            }
            if (component.length > faceCount) break;
          }
          if (component.length > 0) components.push(component);
        }
      }

      const minComponentSize = Math.max(50, Math.floor(faceCount * 0.02));
      let sigComponents = components.filter(c => c.length >= minComponentSize);
      if (sigComponents.length > 50) {
        sigComponents.sort((a, b) => b.length - a.length);
        sigComponents = sigComponents.slice(0, 50);
      }

      vertexMap.clear();
      faceConnections.clear();

      return sigComponents.map((faceIndices, idx) =>
        createPartGeometry(faceIndices, idx, sigComponents.length, position, geo),
      );
    } catch (err) {
      console.error('Failed to separate assembly parts:', err);
      return createSimplifiedExplodedView(geo);
    }
  }, [createSimplifiedExplodedView, createMechanicalPartSeparation, createPartGeometry]);

  // ─── Stable refs for callbacks ───────────────────────────────────────────

  const stableOnPartsDetected = useRef(onPartsDetected);
  const stableOnLoad = useRef(onLoad);
  useEffect(() => { stableOnPartsDetected.current = onPartsDetected; });
  useEffect(() => { stableOnLoad.current = onLoad; });

  // ─── Geometry processing ────────────────────────────────────────────────

  const processGeometryAfterLoad = useCallback((loadedGeometry: THREE.BufferGeometry) => {
    const positionArray = getBufferAttribute(loadedGeometry, 'position');
    const faceCount = positionArray ? positionArray.count / 3 : 0;
    const vertexCount = positionArray ? positionArray.count : 0;
    const estimatedMemoryMB = (vertexCount * 3 * 4) / (1024 * 1024);

    if (estimatedMemoryMB > 500) {
      setLoadingError(`File too large (${estimatedMemoryMB.toFixed(1)}MB). Please use a smaller file.`);
      setIsLoading(false);
      return;
    }
    if (faceCount > 1_000_000) {
      setLoadingError(`File too complex (${faceCount.toLocaleString()} triangles). Please simplify the model.`);
      setIsLoading(false);
      return;
    }

    setIsLoading(false);
    setLoadingProgress(100);

    let detectedParts: ExplodedPart[] = [];

    try {
      try {
        setGeometry(loadedGeometry);
        onGeometryLoad?.(loadedGeometry); // Pass geometry to parent component
      } catch (memErr) {
        if (memErr instanceof RangeError && (memErr as Error).message.includes('Array buffer allocation failed')) {
          setLoadingError('File too large for browser memory. Please use a smaller model.');
          setIsLoading(false);
          return;
        }
        throw memErr;
      }

      const parts = separateAssemblyParts(loadedGeometry);
      if (parts.length > 0) {
        detectedParts = parts;
        setExplodedParts(parts);
      } else {
        const fallback = createSimplifiedExplodedView(loadedGeometry);
        setExplodedParts(fallback);
      }
    } catch (err) {
      if (err instanceof RangeError && (err as Error).message.includes('Array buffer allocation failed')) {
        setLoadingError('File too large for browser memory. Please use a smaller model.');
        setIsLoading(false);
        return;
      }
      try {
        const fallback = createSimplifiedExplodedView(loadedGeometry);
        setExplodedParts(fallback);
      } catch {
        setExplodedParts([]);
      }
    }

    if (stableOnPartsDetected.current && detectedParts.length > 0) {
      const partData = detectedParts.map((part, index) => ({
        id: part.id,
        name: `Component ${index + 1}`,
        geometry: part.geometry,
        partNumber: part.id.toUpperCase(),
        material: 'Unknown',
        quantity: 1,
        faceCount: (getBufferAttribute(part.geometry, 'position')?.count ?? 0) / 3,
        volume: calculateVolume(part.geometry),
        ...calculateBoundingBoxDimensions(part.geometry),
      }));
      stableOnPartsDetected.current(partData);
    }

    stableOnLoad.current?.();
  }, [separateAssemblyParts, createSimplifiedExplodedView]);

  // ─── Load STL / STEP ────────────────────────────────────────────────────

  useEffect(() => {
    if (!url) return;
    if (isLoading) return;

    try { new URL(url); } catch {
      setLoadingError('Invalid file URL format');
      return;
    }

    const isStepFile = url.toLowerCase().includes('.step') || url.toLowerCase().includes('.stp');

    if (isStepFile) {
      setLoadingStage('Processing STEP file...');
      setLoadingProgress(10);

      const loadStepFile = async () => {
        setIsLoading(true);
        setLoadingProgress(0);
        setLoadingError(null);

        const loadingTimeout = setTimeout(() => {
          setLoadingError('Processing timeout - STEP file may be too complex');
          setIsLoading(false);
        }, 60000);

        try {
          setLoadingStage('Analyzing STEP file...');
          setLoadingProgress(20);

          const response = await fetch(url);
          if (!response.ok) throw new Error(`Failed to fetch STEP file: ${response.statusText}`);

          const stepBlob = await response.blob();
          const formData = new FormData();
          formData.append('file', stepBlob, 'model.step');

          setLoadingStage('Converting with CAD engine...');
          setLoadingProgress(40);

          const cadResponse = await fetch('/api/cad', {
            method: 'POST',
            body: formData,
          });

          if (!cadResponse.ok) throw new Error(`CAD engine failed: ${cadResponse.statusText}`);

          setLoadingStage('Processing converted model...');
          setLoadingProgress(60);

          const result = await cadResponse.json();
          if (!result.success) throw new Error(result.error ?? 'STEP processing failed');

          setLoadingStage('Loading 3D model...');
          setLoadingProgress(80);

          if (result.stl_base64) {
            const stlData = atob(result.stl_base64);
            const stlArray = new Uint8Array(stlData.length);
            for (let i = 0; i < stlData.length; i++) stlArray[i] = stlData.charCodeAt(i);
            setLoadingProgress(90);

            const loader = new STLLoader();
            try {
              const geo = loader.parse(stlArray.buffer);
              clearTimeout(loadingTimeout);
              processGeometryAfterLoad(geo);
            } catch (parseErr) {
              clearTimeout(loadingTimeout);
              setLoadingError('Failed to parse converted 3D model');
              setIsLoading(false);
            }
          } else {
            throw new Error('No STL data received from CAD engine');
          }
        } catch (err) {
          clearTimeout(loadingTimeout);
          const msg = err instanceof Error ? err.message : String(err);
          setLoadingError(`Failed to process STEP file: ${msg}`);
          setIsLoading(false);
        }
      };

      loadStepFile();
      return;
    }

    setIsLoading(true);
    setLoadingProgress(0);
    setLoadingError(null);

    const loader = new STLLoader();
    const loadingTimeout = setTimeout(() => {
      setLoadingError('Loading timeout - file may be too large or server unresponsive');
      setIsLoading(false);
    }, 60000);

    loader.load(
      url,
      (loadedGeometry) => {
        clearTimeout(loadingTimeout);
        processGeometryAfterLoad(loadedGeometry);
      },
      (progress) => {
        if (progress.lengthComputable && progress.total > 0) {
          const pct = (progress.loaded / progress.total) * 100;
          setLoadingProgress(pct);
          setLoadingStage(`Loading model... ${pct.toFixed(0)}%`);
        } else {
          setLoadingStage('Processing model data...');
        }
      },
      (error) => {
        clearTimeout(loadingTimeout);
        setIsLoading(false);
        const msg = error instanceof Error ? error.message : String(error);
        let errorMessage = 'Failed to load 3D model';
        if (msg.includes('404')) errorMessage = 'File not found';
        else if (msg.includes('403')) errorMessage = 'Access denied';
        else if (msg.includes('NetworkError') || msg.includes('network')) errorMessage = 'Network error';
        else if (msg.includes('CORS')) errorMessage = 'Cross-origin request blocked';
        else if (error instanceof RangeError && msg.includes('Array buffer allocation failed')) {
          errorMessage = 'File too large for browser memory.';
        } else {
          errorMessage = `Loading failed: ${msg}`;
        }
        setLoadingError(errorMessage);
        console.error('Error loading STL:', error);
      },
    );

    return () => clearTimeout(loadingTimeout);
  }, [url]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Pre-compute normals + adjacency for measurement classification ─────────
  useEffect(() => {
    if (!geometry) { normalsRef.current = []; adjRef.current = []; return; }
    const pos = getBufferAttribute(geometry, 'position');
    if (!pos) return;
    const triCount = Math.floor(pos.count / 3);
    normalsRef.current = computeTriangleNormals(pos, triCount);
    adjRef.current = buildTriangleAdjacency(pos, triCount);
  }, [geometry]);

  // ─── Heatmap vertex colour computation ────────────────────────────────────
  // Runs inside STLModel so we have access to both geometry AND materialRef.
  // After setting the colour attribute we MUST call material.needsUpdate = true;
  // otherwise Three.js uses the already-compiled shader that omitted USE_COLOR
  // because the attribute did not exist at first compile time.
  useEffect(() => {
    if (!geometry) return;
    const posAttr = geometry.attributes.position as THREE.BufferAttribute | undefined;
    if (!posAttr) return;

    if (!heatmapSources?.length) {
      if (geometry.hasAttribute('color')) {
        geometry.deleteAttribute('color');
        if (materialRef.current) materialRef.current.needsUpdate = true;
      }
      return;
    }

    const positions = posAttr.array as Float32Array;
    geometry.computeBoundingBox();
    const bboxCenter = new THREE.Vector3();
    geometry.boundingBox?.getCenter(bboxCenter);

    const offsetSources = heatmapSources.map((s) => ({
      ...s,
      centroid: [
        s.centroid[0] + bboxCenter.x,
        s.centroid[1] + bboxCenter.y,
        s.centroid[2] + bboxCenter.z,
      ] as [number, number, number],
    }));

    const { colors, riskValues } = computeHeatmap({
      positions,
      sources: offsetSources,
      colorRamp: MANUFACTURING_RISK_RAMP,
      normalization: heatmapNormalization ?? 'relative',
    });

    if (heatmapRiskValuesRef) heatmapRiskValuesRef.current = riskValues;
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.attributes.color!.needsUpdate = true;
    if (materialRef.current) materialRef.current.needsUpdate = true;
    console.log('[STLModel] heatmap applied: triCount=', riskValues.length, 'materialNeedsUpdate set');
  }, [heatmapSources, heatmapNormalization, geometry, heatmapRiskValuesRef]);

  // ─── Measurements ────────────────────────────────────────────────────────

  useEffect(() => {
    if (!geometry) return;

    geometry.center();
    geometry.computeVertexNormals();

    const volume = calculateVolume(geometry);
    geometry.computeBoundingBox();
    const bbox = geometry.boundingBox;
    const dimensions = {
      x: bbox ? bbox.max.x - bbox.min.x : 0,
      y: bbox ? bbox.max.y - bbox.min.y : 0,
      z: bbox ? bbox.max.z - bbox.min.z : 0,
    };

    const position = getBufferAttribute(geometry, 'position');
    if (!position) {
      onMeasurements?.({ volume, dimensions, surfaceArea: 0 });
      onLoad?.();
      return;
    }

    let surfaceArea = 0;
    for (let i = 0; i < position.count; i += 3) {
      const v1 = new THREE.Vector3(position.getX(i),   position.getY(i),   position.getZ(i));
      const v2 = new THREE.Vector3(position.getX(i+1), position.getY(i+1), position.getZ(i+1));
      const v3 = new THREE.Vector3(position.getX(i+2), position.getY(i+2), position.getZ(i+2));
      const e1 = new THREE.Vector3().subVectors(v2, v1);
      const e2 = new THREE.Vector3().subVectors(v3, v1);
      surfaceArea += new THREE.Vector3().crossVectors(e1, e2).length() / 2;
    }

    onMeasurements?.({ volume, dimensions, surfaceArea });
    onLoad?.();
  }, [geometry, onLoad, onMeasurements]);

  // ─── Section plane ───────────────────────────────────────────────────────

  useEffect(() => {
    if (!meshRef.current) return;
    const mat = meshRef.current.material as any;
    if (sectionPlane > 0 && geometry) {
      geometry.computeBoundingBox();
      const bbox = geometry.boundingBox!;
      const yMin = bbox.min.y;
      const yMax = bbox.max.y;
      // <Center> translates the model so its centroid sits at world origin.
      // After that, world Y runs from -(yMax-yMin)/2 to +(yMax-yMin)/2.
      // Map sectionPlane (0→1): 0.5 → cutY=0 (mid-height), 0 → bottom, 1 → top
      const cutY = (sectionPlane - 0.5) * (yMax - yMin);
      // Plane normal (0,-1,0): visible where y <= cutY — hides top, shows bottom (cross-section)
      mat.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, -1, 0), cutY)];
      mat.clipShadows = true;
    } else {
      mat.clippingPlanes = [];
    }
    (meshRef.current.material as THREE.Material).needsUpdate = true;
  }, [sectionPlane, geometry]);

  useEffect(() => {
    return () => {
      if (meshRef.current) {
        (meshRef.current.material as THREE.Material)?.dispose();
      }
    };
  }, []);

  // ─── Explosion targets ──────────────────────────────────────────────────

  const partGroupRefs = useRef<Map<string, THREE.Group>>(new Map());

  const explosionTargets = useMemo(() => {
    if (!explodedParts.length) return new Map<string, THREE.Vector3>();
    const targets = new Map<string, THREE.Vector3>();

    // Scale relative to model bounding box so any model size looks right
    geometry?.computeBoundingBox();
    const size = new THREE.Vector3();
    geometry?.boundingBox?.getSize(size);
    const modelDiag = size.length() || 100;
    const dist = ((explodeDistance ?? 0) / 100) * modelDiag * 0.8;

    explodedParts.forEach((part) => {
      targets.set(
        part.id,
        isExploded && (explodeDistance ?? 0) > 0
          ? part.explosionDirection.clone().multiplyScalar(dist)
          : new THREE.Vector3(0, 0, 0),
      );
    });
    return targets;
  }, [isExploded, explodeDistance, explodedParts.length, geometry]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    explodedParts.forEach(part => {
      const tp = explosionTargets.get(part.id);
      if (tp) {
        part.targetPosition.copy(tp);
      }
    });
  }, [explosionTargets, explodedParts]);

  useFrame(() => {
    if (!explodedParts.length) return;
    explodedParts.forEach((part) => {
      const d = part.currentPosition.distanceTo(part.targetPosition);
      if (d > 0.01) {
        part.currentPosition.lerp(part.targetPosition, 0.08);
      }
      // Drive the Three.js group directly — bypasses React for smooth animation
      const group = partGroupRefs.current.get(part.id);
      if (group) group.position.copy(part.currentPosition);
    });
  });

  // ─── DFM legend types ───────────────────────────────────────────────────

  const activeTypes = (manufacturingFeatures ?? [])
    .map(f => f.type)
    .filter((t, i, arr) => arr.indexOf(t) === i)
    .filter(t => t in DFM_COLORS) as DFMType[];

  // ─── Render states ──────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <group>
        <Html position={[0, 0, 0]} center>
          <div className="bg-background/80 backdrop-blur p-4 rounded-lg border">
            <div className="flex flex-col items-center gap-3">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent animate-spin rounded-full" />
              <div className="text-sm font-medium">Loading 3D Model</div>
              <div className="text-xs text-muted-foreground">
                {loadingStage || (loadingProgress > 0 ? `${loadingProgress.toFixed(1)}%` : 'Preparing...')}
              </div>
              <div className="w-48 h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-500 ease-out"
                  style={{ width: `${Math.max(2, Math.min(100, loadingProgress))}%` }}
                />
              </div>
              {previewReady && !detailsReady && (
                <div className="text-xs text-yellow-400">Preview ready • Loading details...</div>
              )}
            </div>
          </div>
        </Html>
      </group>
    );
  }

  if (loadingError) {
    return (
      <group>
        <Html position={[0, 0, 0]} center>
          <div className="bg-background/80 backdrop-blur p-4 rounded-lg border border-destructive">
            <div className="flex flex-col items-center gap-3 text-center max-w-sm">
              <div className="text-destructive">⚠️</div>
              <div className="text-sm font-medium">Failed to Load 3D Model</div>
              <div className="text-xs text-muted-foreground">{loadingError}</div>
            </div>
          </div>
        </Html>
      </group>
    );
  }

  if (!geometry) return null;

  return (
    <group ref={groupRef}>
      {geometry && (
        <mesh
          ref={meshRef}
          geometry={geometry}
          castShadow
          receiveShadow
          visible={!isExploded || explodedParts.length === 0}
          onClick={(e) => {
            // Heatmap inspector — fires when heatmap is active (takes priority over measurement)
            if (heatmapActive && onHeatmapInspect && e.intersections.length > 0) {
              e.stopPropagation();
              const hit = e.intersections[0]!;
              const triIndex = hit.faceIndex ?? 0;
              const riskValue = heatmapRiskValuesRef?.current?.[triIndex] ?? 0;
              const wp = hit.point;
              onHeatmapInspect([wp.x, wp.y, wp.z], triIndex, riskValue);
              return;
            }
            const isMeasuring = measureMode === 'PICKING_A' || measureMode === 'PICKING_B';
            if (isMeasuring && e.intersections.length > 0) {
              e.stopPropagation();
              const sel = classifyHit(e.intersections[0]!, e.camera, normalsRef.current, adjRef.current, measureSubMode ?? 'auto');
              onMeasureClick?.(sel);
            }
          }}
          onPointerMove={(e) => {
            const isMeasuring = measureMode === 'PICKING_A' || measureMode === 'PICKING_B';
            if (isMeasuring && e.intersections.length > 0) {
              e.stopPropagation();
              const sel = classifyHit(e.intersections[0]!, e.camera, normalsRef.current, adjRef.current, measureSubMode ?? 'auto');
              setLocalHoverSel(sel);
              onMeasureHover?.(sel);
            }
          }}
          onPointerLeave={() => {
            const isMeasuring = measureMode === 'PICKING_A' || measureMode === 'PICKING_B';
            if (isMeasuring) {
              setLocalHoverSel(null);
              onMeasureHover?.(null);
            }
          }}
        >
          <meshStandardMaterial
            ref={materialRef}
            vertexColors={heatmapActive}
            color={heatmapActive ? 'white' : isDimmed ? '#1a3050' : showFeatures ? '#8899aa' : color}
            metalness={0.2}
            roughness={0.45}
            side={THREE.DoubleSide}
            transparent={!heatmapActive && (isDimmed || isTransparent || !!showFeatures)}
            opacity={heatmapActive ? 1 : isDimmed ? 0.50 : isTransparent ? 0.3 : showFeatures ? 0.22 : 1}
            wireframe={isWireframe}
          />
        </mesh>
      )}

      {(showFeatures || (selectedFeature != null && !(selectedFeature as any)._surfaceOverlay)) && manufacturingFeatures && manufacturingFeatures.length > 0 && !isExploded && (
        <DFMColorMesh
          geometry={geometry}
          features={manufacturingFeatures}
          selectedFeatureType={selectedFeature?.type ?? null}
          onFaceClick={(type) => {
            const f = manufacturingFeatures.find(mf => mf.type === type);
            const isNewSelection = !selectedFeature || f?.id !== selectedFeature.id;
            if (isNewSelection && f) {
              onFeatureSelect?.(f);
            } else {
              onFeatureSelect?.(null);
            }
          }}
        />
      )}

      {explodedParts.length > 0 && isExploded
        ? explodedParts.map((part) => {
            const posAttr = getBufferAttribute(part.geometry, 'position');
            if (!posAttr || posAttr.count === 0) return null;

            const isSelected = selectedBOMItems?.some(item => item.id === part.id) ?? false;
            const isHovered = hoveredBOMItem?.id === part.id;
            const shouldHighlight = isSelected || isHovered;
            const highlightColor = isSelected ? '#00ff88' : isHovered ? '#ffaa00' : color;
            const isVisible = showOnlySelected ? isSelected : true;

            if (!isVisible) return null;

            return (
              <group
                key={part.id}
                ref={(el) => {
                  if (el) partGroupRefs.current.set(part.id, el);
                  else partGroupRefs.current.delete(part.id);
                }}
              >
                <mesh
                  geometry={part.geometry}
                  castShadow
                  receiveShadow
                  onClick={(e) => {
                    e.stopPropagation();
                    console.log('Part selected:', part.id);
                  }}
                  onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer'; }}
                  onPointerOut={(e) => { e.stopPropagation(); document.body.style.cursor = 'default'; }}
                >
                  <meshStandardMaterial
                    color={showFeatures ? '#8899aa' : shouldHighlight ? highlightColor : color}
                    metalness={shouldHighlight ? 0.4 : 0.2}
                    roughness={shouldHighlight ? 0.3 : 0.45}
                    side={THREE.DoubleSide}
                    transparent={isTransparent || !!showFeatures || shouldHighlight}
                    opacity={isTransparent ? 0.4 : showFeatures ? 0.25 : 0.9}
                    wireframe={isWireframe}
                    emissive={shouldHighlight ? new THREE.Color(highlightColor).multiplyScalar(0.1) : new THREE.Color(0x000000)}
                  />
                </mesh>
                {shouldHighlight && (
                  <mesh geometry={part.geometry} scale={1.005}>
                    <meshBasicMaterial color={highlightColor} side={THREE.BackSide} transparent opacity={0.3} />
                  </mesh>
                )}
              </group>
            );
          })
        : null}

      {showFeatures && activeTypes.length > 0 && !isExploded && (
        <DFMLegend activeTypes={activeTypes} />
      )}

      {/* ─── Measurement highlights ─── */}
      {geometry && measureMode !== 'IDLE' && (() => {
        geometry.computeBoundingBox();
        const bbox = geometry.boundingBox;
        const s = bbox ? new THREE.Vector3() : null;
        if (s && bbox) bbox.getSize(s);
        const d = s ? Math.sqrt(s.x**2 + s.y**2 + s.z**2) : 2;
        const markerSize = Math.min(Math.max(d * 0.008, 0.05), 5);

        const renderSel = (sel: MeasureSelection | null, color: string, keyPrefix: string) => {
          if (!sel) return null;
          if (sel.type === 'face') {
            return <FaceHighlight key={keyPrefix} triangleIndices={sel.triangleIndices} geometry={geometry} color={color} opacity={0.55} />;
          }
          if (sel.type === 'arc') {
            return <FaceHighlight key={keyPrefix} triangleIndices={sel.triangleIndices} geometry={geometry} color={color} opacity={0.4} />;
          }
          if (sel.type === 'edge') {
            return <EdgeHighlight key={keyPrefix} start={sel.start} end={sel.end} color={color} />;
          }
          return <VertexHighlight key={keyPrefix} point={sel.point} color={color} size={markerSize} />;
        };

        return (
          <>
            {/* Persistent colored highlights — only selected result if one is chosen */}
            {(measureResults ?? [])
              .filter(r => !selectedResultId || r.id === selectedResultId)
              .map((r) => {
              const idx = (measureResults ?? []).indexOf(r);
              const { a: colA, b: colB } = getResultColors(idx);
              return (
                <group key={r.id}>
                  {renderSel(r.selA, colA, `${r.id}-a`)}
                  {renderSel(r.selB, colB, `${r.id}-b`)}
                </group>
              );
            })}

            {/* Live in-progress: hover (white) + locked A (bright blue) */}
            {renderSel(localHoverSel, '#ffffff', 'hover')}
            {renderSel(measureSelA ?? null, '#60a5fa', 'selA')}
          </>
        );
      })()}

      {/* Projected area face highlight */}
      {showProjectedHighlight && projectedFaceIndices && projectedFaceIndices.length > 0 && geometry && (
        <FaceHighlight
          triangleIndices={projectedFaceIndices}
          geometry={geometry}
          color={projectedHighlightColor ?? '#06b6d4'}
          opacity={0.42}
        />
      )}

      {/* Group highlights — suppressed when heatmap is active (heatmap encodes risk spatially) */}
      {!heatmapActive && riskGroups.length > 0 && geometry && riskGroups.map(({ level, indices }) =>
        indices.length > 0 && (
          <FaceHighlight key={`risk-${level}`} triangleIndices={indices} geometry={geometry}
            color={RISK_HIGHLIGHT_COLORS[level] ?? '#d97706'} opacity={0.60}
          />
        )
      )}
      {!heatmapActive && riskGroups.length === 0 && groupFaceIndices && groupFaceIndices.length > 0 && geometry && (
        <FaceHighlight triangleIndices={groupFaceIndices} geometry={geometry} color={groupHighlightColor ?? '#d97706'} opacity={0.65} />
      )}

      {/* Selected occurrence — risk-colored fill + glow ring */}
      {occurrenceFaceIndices && occurrenceFaceIndices.length > 0 && geometry && (
        <SelectedFaceHighlight
          triangleIndices={occurrenceFaceIndices}
          geometry={geometry}
          color={selectedOccurrenceColor}
        />
      )}

      {/* Bend influence zone — context-aware, reads featureType+sheetThickness from FeatureOverlayCtx */}
      {occurrenceFaceIndices && occurrenceFaceIndices.length > 0 && geometry && (
        <ContextBendInfluenceGlow occurrenceFaceIndices={occurrenceFaceIndices} geometry={geometry} />
      )}
    </group>
  );
}

// ─── Camera Controller ────────────────────────────────────────────────────────

function CameraController({
  viewPosition,
  autoFit,
  fitCenter,
}: {
  viewPosition: [number, number, number];
  autoFit: boolean;
  fitCenter: [number, number, number];
}) {
  const { camera, controls } = useThree();

  useEffect(() => {
    if (!autoFit && controls && 'target' in controls) {
      camera.position.set(...viewPosition);
      (controls as any).target.set(...fitCenter);
      (controls as any).update();
    }
  }, [viewPosition, camera, controls, autoFit, fitCenter]);

  return null;
}

// ─── Scene ────────────────────────────────────────────────────────────────────

function Scene({
  fileUrl, modelColor, showGrid, viewPosition, autoFit, fitCenter, onFit, onModelLoad,
  isAnimating, sectionPlane, isTransparent, isWireframe, isExploded, explodeDistance,
  onMeasurements, onOrientationChange, manufacturingFeatures, selectedFeature,
  onFeatureSelect, showFeatures, selectedBOMItems, showOnlySelected, hoveredBOMItem, onPartsDetected,
  onGeometryLoad,
  measureMode, measureSubMode, measureSelA, measureResults, selectedResultId, onMeshMeasureClick, onMeshMeasureHover,
  projectedFaceIndices, projectedHighlightColor, showProjectedHighlight,
  highlightOccurrences,
  selectedOccurrenceIndex,
  occurrenceFaceIndices, groupFaceIndices,
  riskGroups, selectedOccurrenceColor, groupHighlightColor,
  heatmapActive, heatmapSources, heatmapNormalization, heatmapRiskValuesRef, onHeatmapInspect,
}: {
  fileUrl: string; modelColor: string; showGrid: boolean;
  viewPosition: [number, number, number]; autoFit: boolean; fitCenter: [number, number, number];
  onFit: (distance: number, center: THREE.Vector3) => void; onModelLoad: () => void;
  isAnimating: boolean; sectionPlane: number; isTransparent: boolean; isWireframe: boolean;
  isExploded?: boolean; explodeDistance?: number;
  onMeasurements?: (data: { volume: number; dimensions: { x: number; y: number; z: number }; surfaceArea: number; projectedArea?: number }) => void;
  onOrientationChange: (matrix: THREE.Matrix4) => void;
  manufacturingFeatures?: ManufacturingFeature[]; selectedFeature?: ManufacturingFeature | null;
  onFeatureSelect?: (feature: ManufacturingFeature | null) => void; showFeatures?: boolean;
  selectedBOMItems?: any[]; showOnlySelected?: boolean; hoveredBOMItem?: any;
  onPartsDetected?: (parts: any[]) => void;
  onGeometryLoad?: (geometry: THREE.BufferGeometry) => void;
  measureMode: MeasureMode;
  measureSubMode: MeasureSubMode;
  measureSelA?: MeasureSelection | null;
  measureResults: MeasureResult[];
  selectedResultId: string | null;
  onMeshMeasureClick: (sel: MeasureSelection) => void;
  onMeshMeasureHover: (sel: MeasureSelection | null) => void;
  projectedFaceIndices: number[];
  projectedHighlightColor: string;
  showProjectedHighlight: boolean;
  highlightOccurrences?: FeatureNodeV2HL | null;
  selectedOccurrenceIndex: number | null;
  occurrenceFaceIndices: number[];
  groupFaceIndices: number[];
  riskGroups: Array<{ level: string; indices: number[] }>;
  selectedOccurrenceColor: string;
  groupHighlightColor?: string;
  heatmapActive?: boolean;
  heatmapSources?: HeatmapSource[];
  heatmapNormalization?: HeatmapNormalization;
  heatmapRiskValuesRef?: React.RefObject<Float32Array | null>;
  onHeatmapInspect?: ((worldPos: [number, number, number], triangleIndex: number, riskValue: number) => void) | undefined;
}) {
  return (
<>
      <PerspectiveCamera makeDefault position={viewPosition} fov={50} near={0.01} far={10_000_000} />
      <CameraController viewPosition={viewPosition} autoFit={autoFit} fitCenter={fitCenter} />
      {autoFit && <CameraFitter onFit={onFit} resetKey={fileUrl} />}
      <AutoRotate isAnimating={isAnimating} />
      <AxesOrientation onOrientationChange={onOrientationChange} />

      <ambientLight intensity={0.6} />
      <directionalLight
        position={[10, 10, 5]} intensity={1.2} castShadow
        shadow-mapSize-width={1024} shadow-mapSize-height={1024}
        shadow-camera-left={-50} shadow-camera-right={50}
        shadow-camera-top={50} shadow-camera-bottom={-50}
        shadow-camera-near={0.1} shadow-camera-far={200}
        shadow-bias={-0.0001} shadow-normalBias={0.02}
      />
      <directionalLight position={[-10, -10, -5]} intensity={0.4} />
      <hemisphereLight args={['#ffffff', '#444444', 0.6]} />

      {showGrid && (
        <Grid
          args={[20, 20]} cellSize={0.5} cellThickness={0.5}
          cellColor="#888888" sectionSize={2} sectionThickness={1}
          sectionColor="#3b82f6" fadeDistance={30} infiniteGrid
        />
      )}

      {/* Zoom camera to selected occurrence centroid, or all-occurrences bbox if none selected */}
      {highlightOccurrences && (() => {
        const selOcc = selectedOccurrenceIndex !== null
          ? highlightOccurrences.occurrences[selectedOccurrenceIndex]
          : null;
        let cx = 0, cy = 0, viewSpan = 80;
        let triggerKey: string;
        if (selOcc) {
          cx = selOcc.centroid[0];
          cy = selOcc.centroid[1];
          const d = highlightOccurrences.diameter_mm;
          const r = highlightOccurrences.radius_mm;
          const sizeHint = d ? d * 4 : r ? r * Math.PI * 3 : 40;
          viewSpan = Math.max(sizeHint, 30);
          triggerKey = `${highlightOccurrences.id}#${selectedOccurrenceIndex}`;
        } else {
          const b = highlightOccurrences.bbox_centered;
          if (b) {
            cx = (b.x_min + b.x_max) / 2;
            cy = (b.y_min + b.y_max) / 2;
            viewSpan = Math.max(b.x_max - b.x_min, b.y_max - b.y_min, 8);
          }
          triggerKey = `${highlightOccurrences.id}#all`;
        }
        return <FeatureZoomEffect triggerKey={triggerKey} cx={cx} cy={cy} viewSpan={viewSpan} />;
      })()}

      {/* Hole disc fill + HAZ ring — context-aware, reads featureType+sheetThickness from FeatureOverlayCtx */}
      <ContextHoleDiscOverlay
        highlightOccurrences={highlightOccurrences}
        selectedOccurrenceIndex={selectedOccurrenceIndex}
      />

      <Suspense fallback={null}>
        <Center>
          <STLModel
            url={fileUrl} color={modelColor} sectionPlane={sectionPlane}
            isTransparent={isTransparent} isWireframe={isWireframe}
            isExploded={isExploded} explodeDistance={explodeDistance}
            onLoad={onModelLoad} onMeasurements={onMeasurements} onGeometryLoad={onGeometryLoad}
            manufacturingFeatures={manufacturingFeatures} selectedFeature={selectedFeature}
            onFeatureSelect={onFeatureSelect} showFeatures={showFeatures}
            selectedBOMItems={selectedBOMItems} showOnlySelected={showOnlySelected}
            hoveredBOMItem={hoveredBOMItem} onPartsDetected={onPartsDetected}
            measureMode={measureMode}
            measureSubMode={measureSubMode}
            measureSelA={measureSelA}
            measureResults={measureResults}
            selectedResultId={selectedResultId}
            onMeasureClick={onMeshMeasureClick}
            onMeasureHover={onMeshMeasureHover}
            projectedFaceIndices={projectedFaceIndices}
            projectedHighlightColor={projectedHighlightColor}
            showProjectedHighlight={showProjectedHighlight}
            occurrenceFaceIndices={occurrenceFaceIndices}
            isDimmed={!!highlightOccurrences}
            groupFaceIndices={groupFaceIndices}
            riskGroups={riskGroups}
            selectedOccurrenceColor={selectedOccurrenceColor}
            groupHighlightColor={groupHighlightColor}
            heatmapActive={heatmapActive}
            {...(heatmapSources !== undefined ? { heatmapSources } : {})}
            {...(heatmapNormalization !== undefined ? { heatmapNormalization } : {})}
            heatmapRiskValuesRef={heatmapRiskValuesRef}
            onHeatmapInspect={onHeatmapInspect}
          />
        </Center>
      </Suspense>


      <OrbitControls
        makeDefault enableDamping={false}
        minDistance={0.1} maxDistance={1000} enabled={!isAnimating}
        enablePan enableRotate enableZoom screenSpacePanning={false}
        panSpeed={2} rotateSpeed={0.8} zoomSpeed={1.2}
        mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }}
        touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
      />
    </>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export const EDrawingsViewer = React.memo(function EDrawingsViewer({
  fileUrl, fileName, isExploded = false, explodeDistance = 50,
  onMeasurements, manufacturingFeatures, selectedFeature, onFeatureSelect, showFeatures,
  selectedBOMItems, showOnlySelected = false, hoveredBOMItem, onPartsDetected, dfmAnalysisData,
  cameraPreset, onScreenshotReady,
  highlightOccurrences, selectedOccurrenceIndex = null,
  faceMap, sheetThickness,
  dfmOccurrenceScores,
  heatmapSources,
  heatmapNormalization = 'absolute',
  onHeatmapInspect,
  highlightColor,
}: EDrawingsViewerProps) {
  const [loading, setLoading] = useState(true);
  const [modelColor] = useState('#3d7ab5');
  const [showGrid, setShowGrid] = useState(false);
  const [currentView, setCurrentView] = useState<string>('home');
  const [autoFit, setAutoFit] = useState(true);
  const [viewPosition, setViewPosition] = useState<[number, number, number]>([5, 5, 5]);
  const [fitCenter, setFitCenter] = useState<[number, number, number]>([0, 0, 0]);
  const fittedCenterRef = useRef<[number, number, number]>([0, 0, 0]);
  const [isAnimating, setIsAnimating] = useState(false);
  const [sectionPlane, setSectionPlane] = useState(0);
  const [isTransparent, setIsTransparent] = useState(false);
  const [isWireframe, setIsWireframe] = useState(false);
  const [showCrossSection, setShowCrossSection] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [axesRotation, setAxesRotation] = useState<{ x: number; y: number; z: number }>({ x: 0, y: 0, z: 0 });
  const [measurements, setMeasurements] = useState<{
    volume: number;
    dimensions: { x: number; y: number; z: number };
    surfaceArea: number;
    projectedArea?: number;
  } | null>(null);
  const [internalShowFeatures, setInternalShowFeatures] = useState(false);
  const [internalSelectedFeature, setInternalSelectedFeature] = useState<ManufacturingFeature | null>(null);

  const features = manufacturingFeatures ?? [];
  // Use prop if parent manages selection, otherwise fall back to internal state
  const currentSelectedFeature = selectedFeature !== undefined ? (selectedFeature ?? null) : internalSelectedFeature;

  // showFeatures prop intentionally not synced — user controls this via the toolbar button

  const tempVectors = useRef({
    x: new THREE.Vector3(),
    y: new THREE.Vector3(),
    z: new THREE.Vector3(),
  });

  const webglCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => { webglCleanupRef.current?.(); }, []);


  // Store the current geometry for projected area calculation
  const [currentGeometry, setCurrentGeometry] = useState<THREE.BufferGeometry | null>(null);
  const [showProjectedAreaHighlight, setShowProjectedAreaHighlight] = useState(false);
const [projectedFaceIndices, setProjectedFaceIndices] = useState<number[]>([]);
  const fittedDistanceRef = useRef(15);

  // ─── Measurement Tool State ────────────────────────────────────────────────
  const [measureMode, setMeasureMode] = useState<MeasureMode>('IDLE');
  const [measureSubMode, setMeasureSubMode] = useState<MeasureSubMode>('face');
  const [measureSelA, setMeasureSelA] = useState<MeasureSelection | null>(null);
  const [hoverSel, setHoverSel] = useState<MeasureSelection | null>(null);
  const [measureResults, setMeasureResults] = useState<MeasureResult[]>([]);
  const [measureUnit, setMeasureUnit] = useState<MeasureUnit>('mm');
  const [selectedResultId, setSelectedResultId] = useState<string | null>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);

  // Marker size: 1% of bounding box diagonal, clamped to a reasonable range
  const measureMarkerSize = useMemo(() => {
    if (!currentGeometry) return 0.5;
    currentGeometry.computeBoundingBox();
    const bbox = currentGeometry.boundingBox;
    if (!bbox) return 0.5;
    const size = new THREE.Vector3();
    bbox.getSize(size);
    const diag = Math.sqrt(size.x ** 2 + size.y ** 2 + size.z ** 2);
    return Math.min(Math.max(diag * 0.008, 0.05), 5);
  }, [currentGeometry]);


  // face_id → FaceMapEntry lookup for O(1) triangle range access
  const faceMapIndex = useMemo((): Map<number, FaceMapEntry> => {
    if (!faceMap?.length) return new Map();
    return new Map(faceMap.map((e) => [e.face_id, e]));
  }, [faceMap]);

  // ─── Heatmap Engine ───────────────────────────────────────────────────────────
  const heatmapActive = !!heatmapSources?.length;
  const heatmapRiskValuesRef = useRef<Float32Array | null>(null);

  // Computation and colour attribute are now managed inside STLModel (where materialRef lives).
  // EDrawingsViewer only needs to reset the ref when heatmap is off.

  // Group highlight: all occurrences EXCEPT the selected one (amber — secondary, fallback)
  const groupFaceIndices = useMemo((): number[] => {
    if (!highlightOccurrences || !faceMapIndex.size) return [];
    const result: number[] = [];
    for (let i = 0; i < highlightOccurrences.occurrences.length; i++) {
      if (i === selectedOccurrenceIndex) continue;  // selected gets SelectedFaceHighlight
      const occ = highlightOccurrences.occurrences[i];
      if (!occ) continue;
      for (const fid of (occ.face_ids ?? [])) {
        const entry = faceMapIndex.get(fid);
        if (entry && entry.tri_count > 0) {
          for (let t = entry.tri_start; t < entry.tri_start + entry.tri_count; t++) {
            result.push(t);
          }
        }
      }
    }
    return result;
  }, [highlightOccurrences, faceMapIndex, selectedOccurrenceIndex]);

  // Risk-colored group highlights — one bucket per risk level, replaces amber group when scores available
  const riskGroups = useMemo((): Array<{ level: string; indices: number[] }> => {
    if (!dfmOccurrenceScores?.length || !highlightOccurrences || !faceMapIndex.size) return [];
    const map = new Map<string, number[]>();
    for (let i = 0; i < highlightOccurrences.occurrences.length; i++) {
      if (i === selectedOccurrenceIndex) continue;
      const scored = dfmOccurrenceScores.find((s) => s.occurrenceIndex === i);
      const level = scored?.riskLevel ?? 'low';
      const occ = highlightOccurrences.occurrences[i];
      if (!occ) continue;
      const arr = map.get(level) ?? [];
      for (const fid of (occ.face_ids ?? [])) {
        const entry = faceMapIndex.get(fid);
        if (entry && entry.tri_count > 0) {
          for (let t = entry.tri_start; t < entry.tri_start + entry.tri_count; t++) arr.push(t);
        }
      }
      map.set(level, arr);
    }
    return Array.from(map.entries()).map(([level, indices]) => ({ level, indices }));
  }, [dfmOccurrenceScores, highlightOccurrences, faceMapIndex, selectedOccurrenceIndex]);

  // Color for the selected occurrence — risk color when scores available, orange otherwise
  const selectedOccurrenceColor = useMemo((): string => {
    if (!dfmOccurrenceScores?.length || selectedOccurrenceIndex === null) return '#f97316';
    const scored = dfmOccurrenceScores.find((s) => s.occurrenceIndex === selectedOccurrenceIndex);
    return RISK_HIGHLIGHT_COLORS[scored?.riskLevel ?? 'high'] ?? '#f97316';
  }, [dfmOccurrenceScores, selectedOccurrenceIndex]);

  // Selected-occurrence highlight: triangle indices for one specific occurrence's face_ids
  const occurrenceFaceIndices = useMemo((): number[] => {
    if (selectedOccurrenceIndex === null || !highlightOccurrences || !faceMapIndex.size) return [];
    const occ = highlightOccurrences.occurrences[selectedOccurrenceIndex];
    if (!occ) return [];
    const result: number[] = [];
    for (const fid of (occ.face_ids ?? [])) {
      const entry = faceMapIndex.get(fid);
      if (entry && entry.tri_count > 0) {
        for (let i = entry.tri_start; i < entry.tri_start + entry.tri_count; i++) {
          result.push(i);
        }
      }
    }
    return result;
  }, [selectedOccurrenceIndex, highlightOccurrences, faceMapIndex]);

  // Cursor crosshair when measurement mode is active
  useEffect(() => {
    const el = canvasContainerRef.current;
    if (!el) return;
    el.style.cursor = (measureMode === 'PICKING_A' || measureMode === 'PICKING_B') ? 'crosshair' : '';
  }, [measureMode]);

  const handleMeshMeasureClick = useCallback((sel: MeasureSelection) => {
    if (measureMode === 'PICKING_A') {
      setMeasureSelA(sel);
      setHoverSel(null);
      setMeasureMode('PICKING_B');
    } else if (measureMode === 'PICKING_B' && measureSelA) {
      const partial = computeMeasurementBetween(measureSelA, sel);
      const result: MeasureResult = { id: crypto.randomUUID(), createdAt: Date.now(), ...partial };
      setMeasureResults(prev => [...prev, result]);
      setSelectedResultId(result.id);
      // Auto-reset: immediately ready for next measurement
      setMeasureSelA(null);
      setHoverSel(null);
      setMeasureMode('PICKING_A');
    }
  }, [measureMode, measureSelA]);

  const handleMeshMeasureHover = useCallback((sel: MeasureSelection | null) => {
    setHoverSel(sel);
  }, []);

  const startMeasure = useCallback(() => {
    setMeasureMode('PICKING_A');
    setMeasureSelA(null);
    setHoverSel(null);
    setMeasureResults([]);
    setSelectedResultId(null);
  }, []);

  const exitMeasure = useCallback(() => {
    setMeasureMode('IDLE');
    setMeasureSelA(null);
    setHoverSel(null);
    setSelectedResultId(null);
  }, []);

  const deleteMeasureResult = useCallback((id: string) => {
    setMeasureResults(prev => prev.filter(r => r.id !== id));
    setSelectedResultId(prev => prev === id ? null : prev);
  }, []);

  const clearAllMeasureResults = useCallback(() => {
    setMeasureResults([]);
    setSelectedResultId(null);
    setMeasureMode('IDLE');
    setMeasureSelA(null);
    setHoverSel(null);
  }, []);

  // Calculate accurate 2D projected silhouette area (like casting a shadow)
  const calculateProjectedAreaFromMesh = useCallback((geometry: THREE.BufferGeometry | null, view: string): number => {
    if (!geometry) return 0;

    const position = getBufferAttribute(geometry, 'position');
    if (!position || position.count === 0) return 0;

    // Define projection direction and coordinate mapping
    let projectionPlane: 'xy' | 'xz' | 'yz';
    let projectionDirection: THREE.Vector3;
    
    switch (view) {
      case 'front':
      case 'back':
        projectionPlane = 'xy'; // Project onto XY plane (width × height)
        projectionDirection = new THREE.Vector3(0, 0, view === 'front' ? 1 : -1);
        break;
      case 'top':
      case 'bottom':
        projectionPlane = 'xz'; // Project onto XZ plane (width × depth)
        projectionDirection = new THREE.Vector3(0, view === 'top' ? -1 : 1, 0);
        break;
      case 'right':
      case 'left':
        projectionPlane = 'yz'; // Project onto YZ plane (height × depth)
        projectionDirection = new THREE.Vector3(view === 'right' ? -1 : 1, 0, 0);
        break;
      case 'isometric':
      case 'home':
        // For isometric, use a diagonal projection
        projectionPlane = 'xy';
        projectionDirection = new THREE.Vector3(1, 1, 1).normalize();
        break;
      default:
        projectionPlane = 'xy';
        projectionDirection = new THREE.Vector3(0, 0, 1);
    }

    // Collect all triangle silhouettes projected onto the 2D plane
    const projected2DTriangles: Array<{points: THREE.Vector2[], isVisible: boolean}> = [];
    const highlightVertices: number[] = [];
    const highlightColors: number[] = [];

    // First pass: collect all forward-facing triangles with depth information
    const candidateTriangles: Array<{
      vertices: [THREE.Vector3, THREE.Vector3, THREE.Vector3];
      center: THREE.Vector3;
      normal: THREE.Vector3;
      depthFromView: number;
      projected2D: [THREE.Vector2, THREE.Vector2, THREE.Vector2];
    }> = [];
    
    for (let i = 0; i < position.count; i += 3) {
      const v1 = new THREE.Vector3(position.getX(i), position.getY(i), position.getZ(i));
      const v2 = new THREE.Vector3(position.getX(i + 1), position.getY(i + 1), position.getZ(i + 1));
      const v3 = new THREE.Vector3(position.getX(i + 2), position.getY(i + 2), position.getZ(i + 2));
      
      // Calculate triangle normal and center
      const edge1 = new THREE.Vector3().subVectors(v2, v1);
      const edge2 = new THREE.Vector3().subVectors(v3, v1);
      const triangleNormal = new THREE.Vector3().crossVectors(edge1, edge2).normalize();
      const triangleCenter = new THREE.Vector3().addVectors(v1, v2).add(v3).multiplyScalar(1/3);
      
      // Check if triangle faces toward the viewer (external face only)
      const dotProduct = triangleNormal.dot(projectionDirection);
      if (dotProduct <= 0.01) continue; // Skip back-facing or edge-on triangles
      
      // Calculate depth from view direction (higher = more external/closer to viewer)
      const depthFromView = triangleCenter.dot(projectionDirection);
      
      // Project 3D points to 2D coordinates
      const p1 = project3DTo2D(v1, projectionPlane);
      const p2 = project3DTo2D(v2, projectionPlane);
      const p3 = project3DTo2D(v3, projectionPlane);
      
      candidateTriangles.push({
        vertices: [v1, v2, v3],
        center: triangleCenter,
        normal: triangleNormal,
        depthFromView,
        projected2D: [p1, p2, p3]
      });
    }
    
    // Second pass: keep only the most external (frontmost) triangles in each 2D region
    const gridResolution = 100; // Higher resolution for better external face detection
    const bounds2D = new THREE.Box2();
    candidateTriangles.forEach(tri => {
      tri.projected2D.forEach(p => bounds2D.expandByPoint(p));
    });
    
    if (bounds2D.isEmpty()) {
      return 0;
    }
    
    const gridWidth = bounds2D.max.x - bounds2D.min.x;
    const gridHeight = bounds2D.max.y - bounds2D.min.y;
    const cellWidth = gridWidth / gridResolution;
    const cellHeight = gridHeight / gridResolution;
    
    // Create depth buffer - only keep the most external triangle in each cell
    const depthBuffer: Map<string, { triangle: typeof candidateTriangles[0], depth: number }> = new Map();
    
    candidateTriangles.forEach(triangle => {
      const [p1, p2, p3] = triangle.projected2D;
      
      // Find all grid cells this triangle overlaps
      const minX = Math.floor((Math.min(p1.x, p2.x, p3.x) - bounds2D.min.x) / cellWidth);
      const maxX = Math.ceil((Math.max(p1.x, p2.x, p3.x) - bounds2D.min.x) / cellWidth);
      const minY = Math.floor((Math.min(p1.y, p2.y, p3.y) - bounds2D.min.y) / cellHeight);
      const maxY = Math.ceil((Math.max(p1.y, p2.y, p3.y) - bounds2D.min.y) / cellHeight);
      
      for (let x = Math.max(0, minX); x <= Math.min(gridResolution - 1, maxX); x++) {
        for (let y = Math.max(0, minY); y <= Math.min(gridResolution - 1, maxY); y++) {
          const cellKey = `${x},${y}`;
          const existing = depthBuffer.get(cellKey);
          
          if (!existing || triangle.depthFromView > existing.depth + 0.001) {
            // This triangle is more external (closer to viewer) in this cell
            depthBuffer.set(cellKey, { triangle, depth: triangle.depthFromView });
          }
        }
      }
    });
    
    // Third pass: collect only the external face triangles
    const externalTriangles = new Set<typeof candidateTriangles[0]>();
    depthBuffer.forEach(({ triangle }) => {
      externalTriangles.add(triangle);
    });
    
    // Add external triangles to the projection and highlight
    externalTriangles.forEach(triangle => {
      projected2DTriangles.push({
        points: triangle.projected2D,
        isVisible: true
      });
      
      // Add to highlight (only external faces)
      const [v1, v2, v3] = triangle.vertices;
      highlightVertices.push(
        v1.x, v1.y, v1.z,
        v2.x, v2.y, v2.z,
        v3.x, v3.y, v3.z
      );
      
      // Color external faces in bright blue to distinguish from internal
      for (let j = 0; j < 3; j++) {
        highlightColors.push(0.1, 0.6, 1.0); // Bright blue for external faces only
      }
    });

    // Calculate the area of the complete 2D silhouette boundary
    const visibleTriangles = projected2DTriangles.filter(t => t.isVisible);
    const silhouetteArea = calculateSilhouetteArea(visibleTriangles);
    
    return silhouetteArea;
  }, []);

  // Helper function to project 3D point to 2D based on view plane
  const project3DTo2D = (point: THREE.Vector3, plane: 'xy' | 'xz' | 'yz'): THREE.Vector2 => {
    switch (plane) {
      case 'xy': return new THREE.Vector2(point.x, point.y);
      case 'xz': return new THREE.Vector2(point.x, point.z);
      case 'yz': return new THREE.Vector2(point.y, point.z);
    }
  };

  // Calculate area of complete 2D silhouette boundary (full continuous area)
  const calculateSilhouetteArea = (triangles: Array<{points: THREE.Vector2[]}>): number => {
    if (triangles.length === 0) return 0;
    
    // Create a unified point cloud from all external triangles
    const allPoints: THREE.Vector2[] = [];
    triangles.forEach(triangle => {
      triangle.points.forEach(point => {
        allPoints.push(new THREE.Vector2(point.x, point.y));
      });
    });
    
    if (allPoints.length === 0) return 0;
    
    // Find the convex hull to get the complete silhouette boundary
    const hull = computeConvexHull(allPoints);
    
    if (hull.length < 3) return 0;
    
    // Calculate area of the complete silhouette polygon using shoelace formula
    let area = 0;
    for (let i = 0; i < hull.length; i++) {
      const j = (i + 1) % hull.length;
      area += hull[i]!.x * hull[j]!.y;
      area -= hull[j]!.x * hull[i]!.y;
    }
    
    return Math.abs(area) / 2;
  };
  
  // Compute convex hull using Graham scan algorithm for complete boundary
  const computeConvexHull = (points: THREE.Vector2[]): THREE.Vector2[] => {
    if (points.length <= 1) return points;
    
    // Remove duplicate points
    const uniquePoints = points.filter((point, index, arr) => 
      index === arr.findIndex(p => Math.abs(p.x - point.x) < 0.001 && Math.abs(p.y - point.y) < 0.001)
    );
    
    if (uniquePoints.length <= 2) return uniquePoints;
    
    // Find the bottom-most point (lowest Y, then leftmost X)
    let start: THREE.Vector2 = uniquePoints[0]!;
    for (const point of uniquePoints) {
      if (point.y < start.y || (Math.abs(point.y - start.y) < 0.001 && point.x < start.x)) {
        start = point;
      }
    }

    // Sort points by polar angle relative to start point
    const sortedPoints = uniquePoints
      .filter(p => p !== start)
      .sort((a, b) => {
        const angleA = Math.atan2(a.y - start!.y, a.x - start!.x);
        const angleB = Math.atan2(b.y - start!.y, b.x - start!.x);
        if (Math.abs(angleA - angleB) < 0.001) {
          const distA = start!.distanceToSquared(a);
          const distB = start!.distanceToSquared(b);
          return distA - distB;
        }
        return angleA - angleB;
      });

    // Graham scan
    const hull: THREE.Vector2[] = [start];

    for (const point of sortedPoints) {
      // Remove points that create clockwise turn
      while (hull.length > 1 && crossProduct(hull[hull.length - 2]!, hull[hull.length - 1]!, point) <= 0) {
        hull.pop();
      }
      hull.push(point);
    }
    
    return hull;
  };
  
  // Calculate cross product for three points (used in convex hull)
  const crossProduct = (o: THREE.Vector2, a: THREE.Vector2, b: THREE.Vector2): number => {
    return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  };

  // Legacy fallback for when geometry is not available
  const calculateProjectedAreaFallback = useCallback((dimensions: { x: number; y: number; z: number }, view: string): number => {
    switch (view) {
      case 'front':
      case 'back':
        return dimensions.x * dimensions.y;
      case 'top':
      case 'bottom':
        return dimensions.x * dimensions.z;
      case 'right':
      case 'left':
        return dimensions.y * dimensions.z;
      case 'isometric':
      case 'home':
        return Math.sqrt(Math.pow(dimensions.x * dimensions.y, 2) + Math.pow(dimensions.y * dimensions.z, 2) + Math.pow(dimensions.x * dimensions.z, 2)) / Math.sqrt(3);
      default:
        return dimensions.x * dimensions.y;
    }
  }, []);

  const handleMeasurements = useCallback((data: {
    volume: number; dimensions: { x: number; y: number; z: number }; surfaceArea: number;
  }) => {
    // Use mesh-based calculation if geometry is available, otherwise fallback to bounding box
    const projectedArea = currentGeometry 
      ? calculateProjectedAreaFromMesh(currentGeometry, currentView)
      : calculateProjectedAreaFallback(data.dimensions, currentView);
      
    const measurementsWithProjection = { ...data, projectedArea };
    setMeasurements(measurementsWithProjection);
    onMeasurements?.(measurementsWithProjection);
  }, [onMeasurements, calculateProjectedAreaFromMesh, calculateProjectedAreaFallback, currentView, currentGeometry]);

  const screenshotCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const screenshotFiredRef  = useRef(false);

  // Reset the fired flag whenever the file changes so each new part gets captured
  useEffect(() => {
    screenshotFiredRef.current = false;
  }, [fileUrl]);

  const handleModelLoad = useCallback(() => {
    setLoading(false);
    if (onScreenshotReady && !screenshotFiredRef.current) {
      // Wait 600 ms so Three.js has time to render at least a few frames
      setTimeout(() => {
        const source = screenshotCanvasRef.current;
        if (!source) return;
        try {
          // Composite onto an opaque dark background (WebGL canvas has alpha:true)
          const offscreen = document.createElement('canvas');
          offscreen.width  = source.width;
          offscreen.height = source.height;
          const ctx = offscreen.getContext('2d');
          if (!ctx) return;
          ctx.fillStyle = '#2d2d2d';
          ctx.fillRect(0, 0, offscreen.width, offscreen.height);
          ctx.drawImage(source, 0, 0);
          const dataUrl = offscreen.toDataURL('image/png');
          if (dataUrl && dataUrl !== 'data:,') {
            screenshotFiredRef.current = true;
            onScreenshotReady(dataUrl);
          }
        } catch { /* cross-origin or context lost */ }
      }, 600);
    }
  }, [onScreenshotReady]);
  
  const handleGeometryLoad = useCallback((geometry: THREE.BufferGeometry) => {
    setCurrentGeometry(geometry);

    // Recalculate projected area with the new geometry
    if (measurements) {
      const projectedArea = calculateProjectedAreaFromMesh(geometry, currentView);
      setMeasurements(prev => prev ? { ...prev, projectedArea } : null);
    }

    // Compute projected face indices but keep highlight off until user enables it
    setProjectedFaceIndices(computeProjectedFaces(geometry, currentView));
  }, [calculateProjectedAreaFromMesh, currentView, measurements]);

  const handleOrientationChange = useCallback((matrix: THREE.Matrix4) => {
    const { x: xAxis, y: yAxis, z: zAxis } = tempVectors.current;
    xAxis.set(1, 0, 0).applyMatrix4(matrix).normalize();
    yAxis.set(0, 1, 0).applyMatrix4(matrix).normalize();
    zAxis.set(0, 0, 1).applyMatrix4(matrix).normalize();
    setAxesRotation({
      x: Math.atan2(xAxis.y, xAxis.x),
      y: Math.atan2(yAxis.y, yAxis.x),
      z: Math.atan2(zAxis.y, zAxis.x),
    });
  }, []);

  const handleFit = (distance: number, center: THREE.Vector3) => {
    fittedDistanceRef.current = distance;
    const c: [number, number, number] = [center.x, center.y, center.z];
    fittedCenterRef.current = c;
    setFitCenter(c);
    // Position is already set by CameraFitter directly; we just record it for view presets.
    const dir = new THREE.Vector3(1, 0.7, 1).normalize().multiplyScalar(distance);
    setViewPosition([center.x + dir.x, center.y + dir.y, center.z + dir.z]);
    setAutoFit(false);
  };

  useEffect(() => {
    if (!cameraPreset) return;
    const d = fittedDistanceRef.current;
    const [cx, cy, cz] = fittedCenterRef.current;
    const views = getCADViews(d);
    const viewConfig = views[cameraPreset as keyof typeof views];
    if (viewConfig) {
      const [vx, vy, vz] = viewConfig.position;
      setViewPosition([cx + vx, cy + vy, cz + vz]);
      setAutoFit(false);
    }
  }, [cameraPreset]);

  const handleViewChange = (view: string) => {
    setCurrentView(view);

    const fixedDistance = fittedDistanceRef.current;
    const [cx, cy, cz] = fittedCenterRef.current;
    const viewsWithDistance = getCADViews(fixedDistance);
    const viewConfig = viewsWithDistance[view as keyof typeof viewsWithDistance];

    if (viewConfig) {
      const [vx, vy, vz] = viewConfig.position;
      setViewPosition([cx + vx, cy + vy, cz + vz]);
      setAutoFit(false);
    }
    
    // Recalculate projected area for the new view using mesh data if available
    if (measurements) {
      const projectedArea = currentGeometry
        ? calculateProjectedAreaFromMesh(currentGeometry, view)
        : calculateProjectedAreaFallback(measurements.dimensions, view);
      setMeasurements(prev => prev ? { ...prev, projectedArea } : null);
    }

    // Recompute projected faces for the new view (keep user's highlight toggle state)
    if (currentGeometry) {
      setProjectedFaceIndices(computeProjectedFaces(currentGeometry, view));
    }
  };

  const handleResetView = () => {
    setAutoFit(true);
    setCurrentView('home');
    setSectionPlane(0);
    setShowCrossSection(false);
  };

  const handleFitToScreen = () => { setAutoFit(true); setCurrentView('home'); };
  const toggleAnimation = () => setIsAnimating(v => !v);
  const toggleTransparent = () => setIsTransparent(v => !v);
  const toggleWireframe = () => setIsWireframe(v => !v);
  const toggleCrossSection = () => {
    const next = !showCrossSection;
    setShowCrossSection(next);
    setSectionPlane(next ? 0.5 : 0);
  };

  return (
    <div className="h-full w-full flex flex-col bg-[#2d2d2d]">
      {/* Top Toolbar */}
      <div className="bg-[#3f3f3f] border-b border-[#555555] px-3 py-1.5 shrink-0 overflow-x-auto">
        <div className="flex items-center justify-between min-w-max">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={toggleTransparent} title="Transparent"
              className={`font-medium text-xs ${isTransparent ? 'bg-green-600 hover:bg-green-700 text-white border-green-700' : 'bg-[#505050] hover:bg-[#606060] text-white border-[#666666]'}`}>
              <Eye className="h-3.5 w-3.5" />
            </Button>
            <Button variant="outline" size="sm" onClick={toggleWireframe} title="Wireframe"
              className={`font-medium text-xs ${isWireframe ? 'bg-green-600 hover:bg-green-700 text-white border-green-700' : 'bg-[#505050] hover:bg-[#606060] text-white border-[#666666]'}`}>
              <Square className="h-3.5 w-3.5" />
            </Button>
            <Button variant="outline" size="sm" onClick={toggleCrossSection} title="Cross Section"
              className={`font-medium text-xs ${showCrossSection ? 'bg-green-600 hover:bg-green-700 text-white border-green-700' : 'bg-[#505050] hover:bg-[#606060] text-white border-[#666666]'}`}>
              <Slice className="h-3.5 w-3.5" />
            </Button>

            {features.length > 0 && (
              <>
                <Separator orientation="vertical" className="h-6 bg-[#555555]" />
                <Button variant="outline" size="sm" onClick={() => setInternalShowFeatures(v => !v)}
                  className={`gap-1.5 font-medium text-xs ${internalShowFeatures ? 'bg-green-600 hover:bg-green-700 text-white border-green-700' : 'bg-[#505050] hover:bg-[#606060] text-white border-[#666666]'}`}>
                  <Target className="h-3.5 w-3.5" /> DFM Features ({features.length})
                </Button>
              </>
            )}

            <Separator orientation="vertical" className="h-6 bg-[#555555]" />
            <Button variant="ghost" size="sm" onClick={handleResetView} className="text-white hover:bg-[#505050] gap-2">
              <Home className="h-4 w-4" /><span className="hidden md:inline">Home</span>
            </Button>
            <Button variant="ghost" size="sm" onClick={handleFitToScreen} className="text-white hover:bg-[#505050] gap-2">
              <Maximize className="h-4 w-4" /><span className="hidden md:inline">Fit</span>
            </Button>
            <Separator orientation="vertical" className="h-6 bg-[#555555]" />

            <Select value={currentView} onValueChange={handleViewChange}>
              <SelectTrigger className="w-[140px] bg-[#505050] border-[#666666] text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#3f3f3f] border-[#666666]">
                {['home','front','back','top','bottom','right','left','isometric'].map(v => (
                  <SelectItem key={v} value={v} className="text-white capitalize">{v.charAt(0).toUpperCase() + v.slice(1)}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Separator orientation="vertical" className="h-6 bg-[#555555]" />
            <Button variant="ghost" size="sm" onClick={() => setShowGrid(v => !v)}
              className={`text-white hover:bg-[#505050] ${showGrid ? 'bg-[#505050]' : ''}`}>
              <Grid3x3 className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={toggleAnimation}
              className={`text-white hover:bg-[#505050] ${isAnimating ? 'bg-[#505050]' : ''}`}>
              {isAnimating ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowProjectedAreaHighlight(v => !v)}
              className={`text-white hover:bg-[#505050] ${showProjectedAreaHighlight ? 'bg-[#505050]' : ''}`}
              title="Toggle Projected Area Highlight"
            >
              <Layers className="h-4 w-4" />
            </Button>
            <Separator orientation="vertical" className="h-6 bg-[#555555]" />
            <Button
              variant="ghost"
              size="sm"
              onClick={measureMode === 'IDLE' ? startMeasure : exitMeasure}
              className={`text-white hover:bg-[#505050] gap-1.5 text-xs font-medium ${measureMode !== 'IDLE' ? 'bg-blue-600 hover:bg-blue-700' : ''}`}
              title="Measure tool — click two points on the model"
            >
              <Ruler className="h-3.5 w-3.5" />
              <span className="hidden md:inline">Measure</span>
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setShowSidebar(v => !v)}
              className={`text-white hover:bg-[#505050] ${showSidebar ? 'bg-[#505050]' : ''}`}>
              {showSidebar ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
            </Button>
            <Separator orientation="vertical" className="h-6 bg-[#555555]" />
            <Button variant="ghost" size="sm" className="text-white hover:bg-[#505050]" asChild>
              <a href={fileUrl} download><Download className="h-4 w-4" /></a>
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex relative min-h-0 overflow-hidden">
        {/* 3D Viewport */}
        <div ref={canvasContainerRef} className="flex-1 relative bg-gradient-to-b from-[#4a4a4a] to-[#2d2d2d]">
          <FeatureOverlayCtx.Provider value={{ featureType: highlightOccurrences?.feature_type ?? '', sheetThickness: sheetThickness ?? 2 }}>
          <Canvas
            shadows
            dpr={[1, 2]}
            resize={{ debounce: 0 }}
            gl={{
              antialias: true, alpha: true, powerPreference: 'high-performance',
              localClippingEnabled: true,
              preserveDrawingBuffer: !!onScreenshotReady,
              failIfMajorPerformanceCaveat: false,
            }}
            onCreated={(state) => {
              state.gl.localClippingEnabled = true;
              const canvas = state.gl.domElement;
              screenshotCanvasRef.current = canvas;
              const onLost = (e: Event) => { e.preventDefault(); setLoading(true); };
              const onRestored = () => setLoading(false);
              canvas.addEventListener('webglcontextlost', onLost);
              canvas.addEventListener('webglcontextrestored', onRestored);
              webglCleanupRef.current = () => {
                canvas.removeEventListener('webglcontextlost', onLost);
                canvas.removeEventListener('webglcontextrestored', onRestored);
              };
              setLoading(false);
            }}
          >
            <Scene
              fileUrl={fileUrl} modelColor={modelColor} showGrid={showGrid}
              viewPosition={viewPosition} autoFit={autoFit} fitCenter={fitCenter} onFit={handleFit}
              onModelLoad={handleModelLoad} isAnimating={isAnimating}
              sectionPlane={sectionPlane} isTransparent={isTransparent} isWireframe={isWireframe}
              isExploded={isExploded} explodeDistance={explodeDistance}
              onMeasurements={handleMeasurements} onOrientationChange={handleOrientationChange}
              manufacturingFeatures={features} selectedFeature={currentSelectedFeature}
              onFeatureSelect={onFeatureSelect} showFeatures={internalShowFeatures}
              selectedBOMItems={selectedBOMItems} showOnlySelected={showOnlySelected}
              hoveredBOMItem={hoveredBOMItem} onPartsDetected={onPartsDetected}
              onGeometryLoad={handleGeometryLoad}
              measureMode={measureMode}
              measureSubMode={measureSubMode}
              measureSelA={measureSelA}
              measureResults={measureResults}
              selectedResultId={selectedResultId}
              onMeshMeasureClick={handleMeshMeasureClick}
              onMeshMeasureHover={handleMeshMeasureHover}
              projectedFaceIndices={projectedFaceIndices}
              projectedHighlightColor={VIEW_COLORS[currentView] ?? '#06b6d4'}
              showProjectedHighlight={showProjectedAreaHighlight}
              highlightOccurrences={highlightOccurrences}
              selectedOccurrenceIndex={selectedOccurrenceIndex}
              occurrenceFaceIndices={occurrenceFaceIndices}
              groupFaceIndices={groupFaceIndices}
              riskGroups={riskGroups}
              selectedOccurrenceColor={selectedOccurrenceColor}
              groupHighlightColor={highlightColor}
              heatmapActive={heatmapActive}
              heatmapSources={heatmapSources}
              heatmapNormalization={heatmapNormalization}
              heatmapRiskValuesRef={heatmapRiskValuesRef}
              {...(onHeatmapInspect ? { onHeatmapInspect } : {})}
            />
            {measureMode !== 'IDLE' && (
              <MeasurementOverlay
                mode={measureMode}
                selA={measureSelA}
                results={measureResults}
                unit={measureUnit}
                markerSize={measureMarkerSize}
                selectedResultId={selectedResultId}
              />
            )}
          </Canvas>
          </FeatureOverlayCtx.Provider>

          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#2d2d2d]">
              <div className="text-center text-white">
                <Loader2 className="h-12 w-12 mx-auto mb-3 animate-spin" />
                <p className="text-sm font-medium">Loading 3D model...</p>
                <p className="text-xs text-gray-400 mt-1">Calculating optimal view...</p>
              </div>
            </div>
          )}

          {/* XYZ Axes Indicator */}
          <div className="absolute bottom-20 left-4 bg-[#3f3f3f]/90 backdrop-blur-sm border border-[#555555] rounded-lg p-3">
            <svg width="80" height="80" viewBox="0 0 80 80">
              {(['x','y','z'] as const).map((axis) => {
                const rot = axesRotation[axis];
                const colors = { x: '#ef4444', y: '#22c55e', z: '#3b82f6' };
                const labels = { x: 'X', y: 'Y', z: 'Z' };
                const c = colors[axis];
                const tx = 40 + Math.cos(rot) * 30;
                const ty = 40 - Math.sin(rot) * 30;
                return (
                  <g key={axis}>
                    <line x1="40" y1="40" x2={tx} y2={ty} stroke={c} strokeWidth="2.5" strokeLinecap="round" />
                    <polygon
                      points={`${tx},${ty} ${40 + Math.cos(rot)*25 - Math.sin(rot)*3},${40 - Math.sin(rot)*25 - Math.cos(rot)*3} ${40 + Math.cos(rot)*25 + Math.sin(rot)*3},${40 - Math.sin(rot)*25 + Math.cos(rot)*3}`}
                      fill={c}
                    />
                    <text x={40 + Math.cos(rot)*35} y={40 - Math.sin(rot)*35 + 4} fill={c} fontSize="12" fontWeight="bold" textAnchor="middle">
                      {labels[axis]}
                    </text>
                  </g>
                );
              })}
              <circle cx="40" cy="40" r="3" fill="#ffffff" stroke="#555555" strokeWidth="1.5" />
            </svg>
          </div>

          <div className="absolute top-4 left-4 bg-[#3f3f3f]/90 backdrop-blur-sm border border-[#555555] rounded-lg px-2 py-1">
            <p className="text-[10px] text-white font-medium">{fileName}</p>
          </div>

          {highlightOccurrences && (
            <div className="absolute top-12 left-4 z-10 bg-black/70 backdrop-blur border border-white/20 rounded px-2.5 py-1 text-xs flex items-center gap-2 pointer-events-none">
              <span className="w-2 h-2 rounded-full bg-blue-400 shrink-0" />
              <span className="font-medium text-white">
                {highlightOccurrences.feature_type === 'hole'
                  ? `Ø${highlightOccurrences.diameter_mm?.toFixed(1) ?? '?'}mm`
                  : `R${highlightOccurrences.radius_mm?.toFixed(1) ?? '?'}mm bend`}
              </span>
              <span className="text-white/60">
                {highlightOccurrences.occurrences.length} instances
              </span>
              {selectedOccurrenceIndex !== null && (
                <span className="text-orange-400">· #{selectedOccurrenceIndex + 1} selected</span>
              )}
            </div>
          )}
        </div>

        {/* Right Sidebar — absolutely positioned so it overlays the canvas without shrinking it */}
        <div className={`absolute right-0 top-0 h-full w-64 bg-[#3f3f3f] border-l border-[#555555] flex flex-col z-10 transition-transform duration-300 ease-in-out ${showSidebar ? 'translate-x-0' : 'translate-x-full'}`}>
          <div className="px-1.5 py-1 border-b border-[#555555]">
            <h3 className="text-[9px] font-semibold text-white">Properties</h3>
            <p className="text-[7px] text-gray-400">Model controls and information</p>
          </div>

          <div className="flex-1 overflow-y-auto overflow-x-hidden p-0.5 space-y-0.5 scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-gray-800">
            {measurements && (
              <Card className="bg-[#505050] border-[#666666]">
                <div className="p-1 space-y-0.5">
                  <h4 className="text-[9px] font-semibold text-white flex items-center gap-0.5">
                    <Box className="h-2.5 w-2.5" /> Part Details
                  </h4>
                  <div className="space-y-0.5 text-[8px]">
                    <div>
                      <span className="text-gray-400 font-medium">Dimensions</span>
                      <div className="bg-[#3f3f3f] rounded px-1 py-0.5 font-mono text-white text-[9px] mt-0.5">
                        {measurements.dimensions.x.toFixed(1)} × {measurements.dimensions.y.toFixed(1)} × {measurements.dimensions.z.toFixed(1)} mm
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-gray-400">Volume</span>
                      <span className="text-white font-mono text-[10px]">{measurements.volume.toFixed(2)} mm³</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-gray-400">Surface</span>
                      <span className="text-white font-mono text-[10px]">{measurements.surfaceArea.toFixed(2)} mm²</span>
                    </div>
                    <div
                      className="flex items-center justify-between cursor-pointer rounded px-0.5 py-0.5 transition-colors hover:bg-[#3a3a3a]"
                      onClick={() => setShowProjectedAreaHighlight(v => !v)}
                      title="Click to toggle projected area highlight"
                    >
                      <span className="text-gray-400 flex items-center gap-1">
                        <span className="inline-block w-2 h-2 rounded-sm" style={{ background: VIEW_COLORS[currentView] ?? '#06b6d4', opacity: showProjectedAreaHighlight ? 1 : 0.3 }} />
                        Projected ({currentView})
                      </span>
                      <span className="text-white font-mono text-[10px]">{measurements.projectedArea?.toFixed(2)} mm²</span>
                    </div>
                  </div>
                </div>
              </Card>
            )}

            {/* Projected Area Info Card */}
            {measurements && showProjectedAreaHighlight && projectedFaceIndices.length > 0 && (
              <Card className="border" style={{ background: '#2a2a2a', borderColor: (VIEW_COLORS[currentView] ?? '#06b6d4') + '55' }}>
                <div className="p-1 space-y-0.5">
                  <div className="flex items-center justify-between">
                    <h4 className="text-[9px] font-semibold text-white flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: VIEW_COLORS[currentView] ?? '#06b6d4' }} />
                      Projected — <span className="capitalize">{currentView}</span>
                    </h4>
                    <button
                      onClick={() => setShowProjectedAreaHighlight(false)}
                      className="text-gray-500 hover:text-white transition-colors"
                      title="Hide highlight"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[8px] text-gray-400">Projected area</span>
                    <span className="font-mono text-[11px] font-bold" style={{ color: VIEW_COLORS[currentView] ?? '#06b6d4' }}>
                      {measurements.projectedArea?.toFixed(2)} mm²
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[8px] text-gray-400">Facing faces</span>
                    <span className="font-mono text-[9px] text-white">{projectedFaceIndices.length.toLocaleString()}</span>
                  </div>
                </div>
              </Card>
            )}

            {currentSelectedFeature && (
              <Card className="bg-[#505050] border-[#666666]">
                <div className="p-1">
                  <h4 className="text-[9px] font-semibold text-white flex items-center gap-0.5 mb-0.5">
                    <Box className="h-2.5 w-2.5" /> DFM Analysis
                    <span className="ml-auto text-[8px] text-gray-400 font-normal">{currentSelectedFeature.type.replace('_', ' ')}</span>
                  </h4>
                  <div className="space-y-1 text-[8px]">
                    <div>
                      <span className="text-gray-400 font-medium">Process:</span>
                      <div className="text-white mt-0.5">{currentSelectedFeature.manufacturingProcess}</div>
                    </div>
                    {Object.keys(currentSelectedFeature.dimensions ?? {}).length > 0 && (
                      <div>
                        <span className="text-gray-400 font-medium">Dimensions:</span>
                        <div className="text-white mt-0.5 space-y-0.5">
                          {Object.entries(currentSelectedFeature.dimensions ?? {})
                            .filter(([, value]) => value)
                            .map(([key, value]) => (
                              <div key={key} className="flex justify-between">
                                <span className="text-gray-400 capitalize">{key}:</span>
                                <span>{value}mm</span>
                              </div>
                            ))}
                        </div>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-gray-400">Cycle Time:</span>
                      <span className="text-white">{currentSelectedFeature.cycleTime}min</span>
                    </div>
                    {(currentSelectedFeature.warnings ?? []).length > 0 && (
                      <div>
                        <span className="text-amber-400 font-medium flex items-center gap-1">
                          <AlertTriangle className="h-2 w-2" /> Warnings:
                        </span>
                        {(currentSelectedFeature.warnings ?? []).map((w: string, i: number) => (
                          <div key={i} className="text-amber-400 text-[8px] leading-tight">• {w}</div>
                        ))}
                      </div>
                    )}
                    {(currentSelectedFeature.aiRecommendations ?? []).length > 0 && (
                      <div>
                        <span className="text-green-400 font-medium">Recommendations:</span>
                        {(currentSelectedFeature.aiRecommendations ?? []).map((r: string, i: number) => (
                          <div key={i} className="text-green-400 text-[8px] leading-tight">• {r}</div>
                        ))}
                      </div>
                    )}
                    {(currentSelectedFeature.tooling ?? []).length > 0 && (
                      <div>
                        <span className="text-purple-400 font-medium">Required Tools:</span>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {(currentSelectedFeature.tooling ?? []).map((t: string, i: number) => (
                            <span key={i} className="bg-purple-900/30 text-purple-300 px-1 py-0.5 rounded text-[7px]">{t}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            )}

            {features.length > 0 && (
              <Card className="bg-[#505050] border-[#666666]">
                <div className="p-1">
                  <h4 className="text-[9px] font-semibold text-white flex items-center gap-0.5 mb-0.5">
                    <Target className="h-2.5 w-2.5" /> DFM Features
                    <span className="ml-auto text-[8px] text-gray-400 font-normal">click to highlight</span>
                  </h4>
                  <div className="flex flex-wrap gap-0.5 mb-1">
                    {(['hole','pocket','thin_wall','undercut'] as const).map(t => (
                      <span key={t} className="flex items-center gap-0.5 text-[7px] text-gray-300">
                        <span className="inline-block w-1.5 h-1.5 rounded-full" style={{
                          background: t === 'hole' ? '#FF6B6B' : t === 'pocket' ? '#4ECDC4' : t === 'thin_wall' ? '#FFA07A' : '#D63031',
                        }} />
                        {t.replace('_',' ')}
                      </span>
                    ))}
                  </div>
                  <div className="space-y-0.5 max-h-40 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-500 scrollbar-track-gray-700 pr-0.5">
                    {features.map((feature) => {
                      const featureColor =
                        feature.type === 'hole' ? '#FF6B6B' :
                        feature.type === 'pocket' ? '#4ECDC4' :
                        feature.type === 'thin_wall' ? '#FFA07A' :
                        feature.type === 'undercut' ? '#D63031' : '#74B9FF';
                      const isSel = currentSelectedFeature?.id === feature.id;
                      return (
                        <button key={feature.id}
                          onClick={() => {
                            const next = isSel ? null : feature;
                            onFeatureSelect?.(next);
                            setInternalSelectedFeature(next);
                            if (next) setInternalShowFeatures(true);
                          }}
                          className={`w-full text-left p-0.5 rounded border transition-all ${isSel ? 'border-blue-400 bg-blue-900/30' : 'border-[#666666] bg-[#3f3f3f] hover:bg-[#484848]'}`}
                        >
                          <div className="flex items-center gap-1 mb-0.5">
                            <Crosshair className="h-2.5 w-2.5 flex-shrink-0" style={{ color: featureColor }} />
                            <span className="text-[9px] font-semibold truncate" style={{ color: featureColor }}>
                              {feature.type.replace('_', ' ').toUpperCase()}
                            </span>
                          </div>
                          <div className="text-[8px] text-gray-300 truncate mb-0.5">{feature.manufacturingProcess}</div>
                          <div className="flex items-center gap-2 text-[7px] text-gray-400">
                            <span className="flex items-center gap-0.5"><Clock className="h-1.5 w-1.5" />{feature.cycleTime}min</span>
                          </div>
                          {feature.warnings.length > 0 && (
                            <div className="flex items-start gap-0.5 mt-0.5">
                              <AlertTriangle className="h-2 w-2 text-amber-400 flex-shrink-0 mt-px" />
                              <span className="text-[7px] text-amber-400 leading-tight">{feature.warnings[0]}</span>
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </Card>
            )}

            {dfmAnalysisData && (
              <Card className="bg-[#505050] border-[#666666]">
                <div className="p-1 space-y-0.5">
                  <h4 className="text-[9px] font-semibold text-white flex items-center gap-0.5">
                    <Target className="h-2.5 w-2.5" /> Assembly DFM Analysis
                  </h4>
                  {dfmAnalysisData.dfmAnalysis?.manufacturabilityScore && (
                    <div className="bg-[#3f3f3f] rounded px-1 py-0.5">
                      <div className="text-[7px] text-gray-400">Manufacturability Score</div>
                      <div className="text-[9px] font-bold text-green-400">
                        {Math.round(dfmAnalysisData.dfmAnalysis.manufacturabilityScore * 100)}%
                      </div>
                    </div>
                  )}
                  {dfmAnalysisData.dfmAnalysis?.recommendedProcesses?.length > 0 && (
                    <div className="bg-[#3f3f3f] rounded px-1 py-0.5">
                      <div className="text-[7px] text-gray-400 mb-0.5">Recommended Processes</div>
                      {dfmAnalysisData.dfmAnalysis.recommendedProcesses.slice(0, 3).map((p: string, i: number) => (
                        <div key={i} className="text-[8px] text-blue-300 flex items-center gap-1">
                          <span className="w-1 h-1 bg-blue-400 rounded-full flex-shrink-0" />{p}
                        </div>
                      ))}
                    </div>
                  )}
                  {dfmAnalysisData.dfmAnalysis?.warnings?.length > 0 && (
                    <div className="bg-amber-900/20 border border-amber-600/30 rounded px-1 py-0.5">
                      <div className="text-[7px] text-amber-400 mb-0.5 flex items-center gap-0.5">
                        <AlertTriangle className="h-2 w-2" /> Warnings
                      </div>
                      {dfmAnalysisData.dfmAnalysis.warnings.slice(0, 2).map((w: any, i: number) => (
                        <div key={i} className="text-[7px] text-amber-300 leading-tight">
                          {typeof w === 'string' ? w : w.message ?? 'Manufacturing consideration'}
                        </div>
                      ))}
                    </div>
                  )}
                  {dfmAnalysisData.geometryFeatures && (
                    <div className="bg-[#3f3f3f] rounded px-1 py-0.5">
                      <div className="text-[7px] text-gray-400 mb-0.5">Geometry Analysis</div>
                      <div className="grid grid-cols-2 gap-1 text-[7px]">
                        {dfmAnalysisData.geometryFeatures.volume && (
                          <div>
                            <span className="text-gray-400">Volume:</span>
                            <div className="text-white font-mono">{Math.round(dfmAnalysisData.geometryFeatures.volume).toLocaleString()} mm³</div>
                          </div>
                        )}
                        {dfmAnalysisData.geometryFeatures.complexityScore && (
                          <div>
                            <span className="text-gray-400">Complexity:</span>
                            <div className="text-white font-mono">{dfmAnalysisData.geometryFeatures.complexityScore.toFixed(1)}/10</div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </Card>
            )}

            {measureMode !== 'IDLE' && (
              <MeasurementPanel
                mode={measureMode}
                selA={measureSelA}
                hoverSel={hoverSel}
                results={measureResults}
                unit={measureUnit}
                measureSubMode={measureSubMode}
                selectedResultId={selectedResultId}
                onSelectResult={(id) => setSelectedResultId(prev => prev === id ? null : id)}
                onUnitChange={setMeasureUnit}
                onSubModeChange={setMeasureSubMode}
                onExit={exitMeasure}
                onDelete={deleteMeasureResult}
                onClearAll={clearAllMeasureResults}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
});
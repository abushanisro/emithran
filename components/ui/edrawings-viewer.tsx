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
import { apiConfig } from '@/lib/api/config';
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
} from 'lucide-react';

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

interface EDrawingsViewerProps {
  fileUrl: string;
  fileName: string;
  isExploded?: boolean;
  explodeDistance?: number;
  onMeasurements?: (data: {
    volume: number;
    dimensions: { x: number; y: number; z: number };
    surfaceArea: number;
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
}

// Helper: safely get BufferAttribute from geometry
function getBufferAttribute(geometry: THREE.BufferGeometry, name: string): THREE.BufferAttribute | null {
  const attr = geometry.attributes[name];
  if (!attr) return null;
  return attr as THREE.BufferAttribute;
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

function CameraFitter({ onFit, resetKey }: { onFit: (distance: number) => void; resetKey?: string }) {
  const { scene, camera } = useThree();
  const fitted = useRef(false);

  useEffect(() => {
    fitted.current = false;
  }, [resetKey]);

  useEffect(() => {
    if (!fitted.current) {
      const box = new THREE.Box3();
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          box.expandByObject(obj);
        }
      });

      if (!box.isEmpty()) {
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const fov = (camera as THREE.PerspectiveCamera).fov * (Math.PI / 180);
        const cameraDistance = Math.abs(maxDim / Math.sin(fov / 2)) * 1.2;
        onFit(cameraDistance);
        fitted.current = true;
      }
    }
  }, [scene, camera, onFit]);

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
  manufacturingFeatures,
  selectedFeature,
  onFeatureSelect,
  showFeatures,
  selectedBOMItems,
  showOnlySelected,
  hoveredBOMItem,
  onPartsDetected,
}: {
  url: string;
  color: string;
  sectionPlane: number;
  isTransparent: boolean;
  isWireframe: boolean;
  isExploded?: boolean;
  explodeDistance?: number;
  onLoad?: () => void;
  onMeasurements?: (data: { volume: number; dimensions: { x: number; y: number; z: number }; surfaceArea: number }) => void;
  manufacturingFeatures?: ManufacturingFeature[];
  selectedFeature?: ManufacturingFeature | null;
  onFeatureSelect?: (feature: ManufacturingFeature | null) => void;
  showFeatures?: boolean;
  selectedBOMItems?: any[];
  showOnlySelected?: boolean;
  hoveredBOMItem?: any;
  onPartsDetected?: (parts: any[]) => void;
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

  // ─── Part Separation Helpers ──────────────────────────────────────────────

  const createSimplifiedExplodedView = useCallback((geo: THREE.BufferGeometry): ExplodedPart[] => {
    geo.computeBoundingBox();
    const bbox = geo.boundingBox!;
    const geometryCenter = new THREE.Vector3();
    bbox.getCenter(geometryCenter);

    const sections = 6;
    const parts: ExplodedPart[] = [];

    for (let i = 0; i < sections; i++) {
      const angle = (i / sections) * Math.PI * 2;
      const height = Math.sin(i * 0.8) * 0.4;
      const direction = new THREE.Vector3(
        Math.cos(angle) * 0.8,
        height + 0.3,
        Math.sin(angle) * 0.8,
      ).normalize();

      parts.push({
        geometry: geo.clone(),
        centroid: geometryCenter.clone(),
        boundingBox: geo.boundingBox?.clone() ?? new THREE.Box3(),
        explosionDirection: direction,
        targetPosition: new THREE.Vector3(0, 0, 0),
        currentPosition: new THREE.Vector3(0, 0, 0),
        id: `simplified-section-${i}`,
      });
    }
    return parts;
  }, []);

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
      currentPosition: centroid.clone(),
      id: `part-${partIndex + 1}`,
    };
  }, []);

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

          const cadResponse = await fetch(`${apiConfig.endpoints.cad}/convert/step-to-stl-base64`, {
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
    if (meshRef.current) {
      const mat = meshRef.current.material as any;
      if (sectionPlane > 0) {
        mat.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, 1, 0), sectionPlane - 0.5)];
        mat.clipShadows = true;
      } else {
        mat.clippingPlanes = [];
      }
      (meshRef.current.material as THREE.Material).needsUpdate = true;
    }
  }, [sectionPlane]);

  useEffect(() => {
    return () => {
      if (meshRef.current) {
        (meshRef.current.material as THREE.Material)?.dispose();
      }
    };
  }, []);

  // ─── Explosion targets ──────────────────────────────────────────────────

  const explosionTargets = useMemo(() => {
    if (!explodedParts.length) return new Map<string, THREE.Vector3>();
    const targets = new Map<string, THREE.Vector3>();
    const dist = ((explodeDistance ?? 0) / 100) * 120;

    explodedParts.forEach((part) => {
      if (isExploded && (explodeDistance ?? 0) > 0) {
        targets.set(part.id, part.explosionDirection.clone().multiplyScalar(dist));
      } else {
        targets.set(part.id, new THREE.Vector3(0, 0, 0));
      }
    });
    return targets;
  }, [isExploded, explodeDistance, explodedParts.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    explodedParts.forEach(part => {
      const tp = explosionTargets.get(part.id);
      if (tp) {
        part.targetPosition.copy(tp);
        if (part.currentPosition.length() === 0) part.currentPosition.copy(tp);
      }
    });
  }, [explosionTargets, explodedParts]);

  useFrame(() => {
    if (!explodedParts.length) return;
    explodedParts.forEach((part) => {
      const d = part.currentPosition.distanceTo(part.targetPosition);
      if (d > 0.01) part.currentPosition.lerp(part.targetPosition, 0.08);
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
        >
          <meshStandardMaterial
            color={showFeatures ? '#8899aa' : color}
            metalness={0.2}
            roughness={0.45}
            side={THREE.DoubleSide}
            transparent={isTransparent || !!showFeatures}
            opacity={isTransparent ? 0.3 : showFeatures ? 0.22 : 1}
            wireframe={isWireframe}
          />
        </mesh>
      )}

      {showFeatures && manufacturingFeatures && manufacturingFeatures.length > 0 && !isExploded && (
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
              <group key={part.id} position={part.currentPosition}>
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
    </group>
  );
}

// ─── Camera Controller ────────────────────────────────────────────────────────

function CameraController({ viewPosition, autoFit }: { viewPosition: [number, number, number]; autoFit: boolean }) {
  const { camera, controls } = useThree();

  useEffect(() => {
    if (!autoFit && controls && 'target' in controls) {
      camera.position.set(...viewPosition);
      (controls as any).target.set(0, 0, 0);
      (controls as any).update();
    }
  }, [viewPosition, camera, controls, autoFit]);

  return null;
}

// ─── Scene ────────────────────────────────────────────────────────────────────

function Scene({
  fileUrl, modelColor, showGrid, viewPosition, autoFit, onFit, onModelLoad,
  isAnimating, sectionPlane, isTransparent, isWireframe, isExploded, explodeDistance,
  onMeasurements, onOrientationChange, manufacturingFeatures, selectedFeature,
  onFeatureSelect, showFeatures, selectedBOMItems, showOnlySelected, hoveredBOMItem, onPartsDetected,
}: {
  fileUrl: string; modelColor: string; showGrid: boolean;
  viewPosition: [number, number, number]; autoFit: boolean;
  onFit: (distance: number) => void; onModelLoad: () => void;
  isAnimating: boolean; sectionPlane: number; isTransparent: boolean; isWireframe: boolean;
  isExploded?: boolean; explodeDistance?: number;
  onMeasurements?: (data: { volume: number; dimensions: { x: number; y: number; z: number }; surfaceArea: number }) => void;
  onOrientationChange: (matrix: THREE.Matrix4) => void;
  manufacturingFeatures?: ManufacturingFeature[]; selectedFeature?: ManufacturingFeature | null;
  onFeatureSelect?: (feature: ManufacturingFeature | null) => void; showFeatures?: boolean;
  selectedBOMItems?: any[]; showOnlySelected?: boolean; hoveredBOMItem?: any;
  onPartsDetected?: (parts: any[]) => void;
}) {
  return (
    <>
      <PerspectiveCamera makeDefault position={viewPosition} fov={50} />
      <CameraController viewPosition={viewPosition} autoFit={autoFit} />
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

      <Suspense fallback={null}>
        <Center>
          <STLModel
            url={fileUrl} color={modelColor} sectionPlane={sectionPlane}
            isTransparent={isTransparent} isWireframe={isWireframe}
            isExploded={isExploded} explodeDistance={explodeDistance}
            onLoad={onModelLoad} onMeasurements={onMeasurements}
            manufacturingFeatures={manufacturingFeatures} selectedFeature={selectedFeature}
            onFeatureSelect={onFeatureSelect} showFeatures={showFeatures}
            selectedBOMItems={selectedBOMItems} showOnlySelected={showOnlySelected}
            hoveredBOMItem={hoveredBOMItem} onPartsDetected={onPartsDetected}
          />
        </Center>
      </Suspense>

      <OrbitControls
        makeDefault enableDamping dampingFactor={0.05}
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
}: EDrawingsViewerProps) {
  const [loading, setLoading] = useState(true);
  const [modelColor] = useState('#3b82f6');
  const [showGrid, setShowGrid] = useState(true);
  const [currentView, setCurrentView] = useState<string>('home');
  const [cameraDistance, setCameraDistance] = useState(5);
  const [autoFit, setAutoFit] = useState(true);
  const [viewPosition, setViewPosition] = useState<[number, number, number]>([5, 5, 5]);
  const [isAnimating, setIsAnimating] = useState(false);
  const [sectionPlane, setSectionPlane] = useState(0);
  const [isTransparent, setIsTransparent] = useState(false);
  const [isWireframe, setIsWireframe] = useState(false);
  const [showCrossSection, setShowCrossSection] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [axesRotation, setAxesRotation] = useState<{ x: number; y: number; z: number }>({ x: 0, y: 0, z: 0 });
  const [measurements, setMeasurements] = useState<{
    volume: number;
    dimensions: { x: number; y: number; z: number };
    surfaceArea: number;
  } | null>(null);
  const [internalShowFeatures, setInternalShowFeatures] = useState(showFeatures ?? false);

  const features = manufacturingFeatures ?? [];
  const currentSelectedFeature = selectedFeature ?? null;

  useEffect(() => {
    if (showFeatures !== undefined) setInternalShowFeatures(showFeatures);
  }, [showFeatures]);

  const tempVectors = useRef({
    x: new THREE.Vector3(),
    y: new THREE.Vector3(),
    z: new THREE.Vector3(),
  });

  const webglCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => { webglCleanupRef.current?.(); }, []);

  const CAD_VIEWS = getCADViews(cameraDistance);

  const handleMeasurements = useCallback((data: {
    volume: number; dimensions: { x: number; y: number; z: number }; surfaceArea: number;
  }) => {
    setMeasurements(data);
    onMeasurements?.(data);
  }, [onMeasurements]);

  const handleModelLoad = useCallback(() => setLoading(false), []);

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

  const handleFit = (distance: number) => {
    setCameraDistance(distance);
    setViewPosition([distance, distance, distance]);
    setAutoFit(false);
  };

  const handleViewChange = (view: string) => {
    setCurrentView(view);
    const viewConfig = CAD_VIEWS[view as keyof typeof CAD_VIEWS];
    if (viewConfig) { setViewPosition(viewConfig.position); setAutoFit(false); }
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
      <div className="bg-[#3f3f3f] border-b border-[#555555] px-3 py-1.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={toggleTransparent}
              className={`gap-1.5 font-medium text-xs ${isTransparent ? 'bg-green-600 hover:bg-green-700 text-white border-green-700' : 'bg-[#505050] hover:bg-[#606060] text-white border-[#666666]'}`}>
              <Eye className="h-3.5 w-3.5" /> Transparent
            </Button>
            <Button variant="outline" size="sm" onClick={toggleWireframe}
              className={`gap-1.5 font-medium text-xs ${isWireframe ? 'bg-green-600 hover:bg-green-700 text-white border-green-700' : 'bg-[#505050] hover:bg-[#606060] text-white border-[#666666]'}`}>
              <Square className="h-3.5 w-3.5" /> Wireframe
            </Button>
            <Button variant="outline" size="sm" onClick={toggleCrossSection}
              className={`gap-1.5 font-medium text-xs ${showCrossSection ? 'bg-green-600 hover:bg-green-700 text-white border-green-700' : 'bg-[#505050] hover:bg-[#606060] text-white border-[#666666]'}`}>
              <Slice className="h-3.5 w-3.5" /> Cross Section
            </Button>

            {features.length > 0 && (
              <>
                <Separator orientation="vertical" className="h-6 bg-[#555555]" />
                <Button variant="outline" size="sm" onClick={() => setInternalShowFeatures(v => !v)}
                  className={`gap-1.5 font-medium text-xs ${internalShowFeatures ? 'bg-blue-600 hover:bg-blue-700 text-white border-blue-700' : 'bg-[#505050] hover:bg-[#606060] text-white border-[#666666]'}`}>
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
      <div className="flex-1 flex relative">
        {/* 3D Viewport */}
        <div className="flex-1 relative bg-gradient-to-b from-[#4a4a4a] to-[#2d2d2d]">
          <Canvas
            shadows
            dpr={[1, 2]}
            gl={{
              antialias: true, alpha: true, powerPreference: 'high-performance',
              localClippingEnabled: true, preserveDrawingBuffer: false, failIfMajorPerformanceCaveat: false,
            }}
            onCreated={(state) => {
              const canvas = state.gl.domElement;
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
              viewPosition={viewPosition} autoFit={autoFit} onFit={handleFit}
              onModelLoad={handleModelLoad} isAnimating={isAnimating}
              sectionPlane={sectionPlane} isTransparent={isTransparent} isWireframe={isWireframe}
              isExploded={isExploded} explodeDistance={explodeDistance}
              onMeasurements={handleMeasurements} onOrientationChange={handleOrientationChange}
              manufacturingFeatures={features} selectedFeature={currentSelectedFeature}
              onFeatureSelect={onFeatureSelect} showFeatures={internalShowFeatures}
              selectedBOMItems={selectedBOMItems} showOnlySelected={showOnlySelected}
              hoveredBOMItem={hoveredBOMItem} onPartsDetected={onPartsDetected}
            />
          </Canvas>

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
        </div>

        {/* Right Sidebar */}
        <div className={`flex-shrink-0 w-64 bg-[#3f3f3f] border-l border-[#555555] flex flex-col max-h-screen transition-transform duration-300 ease-in-out ${showSidebar ? 'translate-x-0' : 'translate-x-full'}`}>
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
                    {Object.keys(currentSelectedFeature.dimensions).length > 0 && (
                      <div>
                        <span className="text-gray-400 font-medium">Dimensions:</span>
                        <div className="text-white mt-0.5 space-y-0.5">
                          {Object.entries(currentSelectedFeature.dimensions)
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
                    {currentSelectedFeature.warnings.length > 0 && (
                      <div>
                        <span className="text-amber-400 font-medium flex items-center gap-1">
                          <AlertTriangle className="h-2 w-2" /> Warnings:
                        </span>
                        {currentSelectedFeature.warnings.map((w, i) => (
                          <div key={i} className="text-amber-400 text-[8px] leading-tight">• {w}</div>
                        ))}
                      </div>
                    )}
                    {currentSelectedFeature.aiRecommendations.length > 0 && (
                      <div>
                        <span className="text-green-400 font-medium">Recommendations:</span>
                        {currentSelectedFeature.aiRecommendations.map((r, i) => (
                          <div key={i} className="text-green-400 text-[8px] leading-tight">• {r}</div>
                        ))}
                      </div>
                    )}
                    {currentSelectedFeature.tooling.length > 0 && (
                      <div>
                        <span className="text-purple-400 font-medium">Required Tools:</span>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {currentSelectedFeature.tooling.map((t, i) => (
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
                          onClick={() => onFeatureSelect?.(isSel ? null : feature)}
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
          </div>
        </div>
      </div>
    </div>
  );
});
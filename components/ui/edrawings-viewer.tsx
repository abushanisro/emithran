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
import { Slider } from '@/components/ui/slider';
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

/**
 * Professional CAD Viewer - eDrawings Style
 * Industry-standard 3D viewer matching eDrawings UI/UX
 *
 * Features:
 * - Auto-fit models to viewport
 * - Exploded view with slider control
 * - Animation rotation
 * - Section/cut plane view
 * - Professional toolbar with standard CAD views
 * - Measurement and properties panel
 */

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
  // BOM Integration Props
  selectedBOMItems?: any[]; // Selected BOM items for highlighting (multiple selection)
  showOnlySelected?: boolean; // Show only the selected parts
  hoveredBOMItem?: any; // Hovered BOM item for highlighting
  onPartsDetected?: (parts: any[]) => void; // Callback when parts are detected
  dfmAnalysisData?: any; // Assembly DFM analysis data for Properties panel
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

// Auto-fit camera to model
function CameraFitter({ onFit, resetKey }: { onFit: (distance: number) => void; resetKey?: string }) {
  const { scene, camera } = useThree();
  const fitted = useRef(false);

  // Reset fitted flag when model changes
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

// Animated rotation
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

// Dynamic Axes Helper - Updates orientation based on camera
function AxesOrientation({ onOrientationChange }: { onOrientationChange: (matrix: THREE.Matrix4) => void }) {
  const { camera } = useThree();
  const lastUpdate = useRef(0);

  useFrame(({ clock }) => {
    // Throttle to ~15fps for UI indicator to reduce re-renders
    if (clock.elapsedTime - lastUpdate.current > 0.066) {
      onOrientationChange(camera.matrixWorldInverse.clone());
      lastUpdate.current = clock.elapsedTime;
    }
  });

  return null;
}

// Calculate volume from STL geometry
function calculateVolume(geometry: THREE.BufferGeometry): number {
  const position = geometry.attributes.position;
  if (!position) return 0;

  let volume = 0;

  for (let i = 0; i < position.count; i += 3) {
    const v1 = new THREE.Vector3(
      position.getX(i),
      position.getY(i),
      position.getZ(i)
    );
    const v2 = new THREE.Vector3(
      position.getX(i + 1),
      position.getY(i + 1),
      position.getZ(i + 1)
    );
    const v3 = new THREE.Vector3(
      position.getX(i + 2),
      position.getY(i + 2),
      position.getZ(i + 2)
    );

    // Calculate signed volume of tetrahedron
    volume += v1.dot(v2.cross(v3)) / 6.0;
  }

  return Math.abs(volume);
}


// ─── DFM Color Constants ─────────────────────────────────────────────────────
const DFM_COLORS = {
  hole:      { hex: '#FF4757', rgb: [1.0, 0.278, 0.341] as [number,number,number], label: 'Holes' },
  pocket:    { hex: '#1E90FF', rgb: [0.118, 0.565, 1.0]  as [number,number,number], label: 'Pockets' },
  thin_wall: { hex: '#FFA502', rgb: [1.0, 0.647, 0.008] as [number,number,number], label: 'Thin Walls' },
  undercut:  { hex: '#9B59B6', rgb: [0.608, 0.349, 0.714] as [number,number,number], label: 'Undercuts' },
  slot:      { hex: '#2ED573', rgb: [0.180, 0.835, 0.451] as [number,number,number], label: 'Slots' },
  overhang:  { hex: '#FF6B81', rgb: [1.0, 0.42, 0.506]  as [number,number,number], label: 'Overhangs' },
} as const;

type DFMType = keyof typeof DFM_COLORS;

// ─── DFM Legend ───────────────────────────────────────────────────────────────
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


// ─── DFM Color Mesh ──────────────────────────────────────────────────────────
/**
 * Classifies each STL triangle by face-normal analysis and paints
 * it directly with a DFM category color. No coordinate guessing needed —
 * the colors are always pixel-perfect on the actual geometry.
 */
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
      // Validation checks
      if (!geometry || !features || features.length === 0) return null;

      const geo = geometry.clone();
      const posAttr = geo.attributes.position;
      if (!posAttr || posAttr.count === 0) return null;

      // Ensure geometry is valid
      if (posAttr.count % 3 !== 0) {
        console.warn('DFM: Invalid geometry - vertex count not divisible by 3');
        return null;
      }

      // Compute bounding box on centered geometry
      geo.computeBoundingBox();
      const bbox = geo.boundingBox;
      if (!bbox) return null;
      
      const size = new THREE.Vector3();
      bbox.getSize(size);
      const center = new THREE.Vector3();
      bbox.getCenter(center);

      // Validate bounding box
      if (size.x === 0 || size.y === 0 || size.z === 0) {
        console.warn('DFM: Invalid bounding box - zero dimension detected');
        return null;
      }

    const halfX = size.x / 2 || 1;
    const halfZ = size.z / 2 || 1;

    // Detect which feature types are active
    const hasHoles     = features.some(f => f.type === 'hole');
    const hasPockets   = features.some(f => f.type === 'pocket');
    const hasUndercuts = features.some(f => f.type === 'undercut');
    const hasThinWalls = features.some(f => f.type === 'thin_wall');
    const hasSlots     = features.some(f => f.type === 'slot');
    const hasOverhangs = features.some(f => f.type === 'overhang');

    // Estimate thin-wall threshold: 15% of the smallest bounding dimension
    const minDim = Math.min(size.x, size.y, size.z);
    const thinThreshold = minDim * 0.18;

    const count = posAttr.count; // total vertex count (3 per triangle)
    const triangleCount = count / 3;
    
    // Optimize for large meshes
    if (triangleCount > 50000) {
      console.log(`DFM: Processing large mesh with ${triangleCount.toLocaleString()} triangles`);
    }
    
    const colors = new Float32Array(count * 3);

    // Base color (steel blue-grey)
    const BASE = [0.65, 0.72, 0.82] as [number,number,number];

    // Pre-fill with base color for performance
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
        // Read three vertices of this triangle - with bounds checking
        if (i + 2 >= count) break;
        
        v[0].set(posAttr.getX(i),   posAttr.getY(i),   posAttr.getZ(i));
        v[1].set(posAttr.getX(i+1), posAttr.getY(i+1), posAttr.getZ(i+1));
        v[2].set(posAttr.getX(i+2), posAttr.getY(i+2), posAttr.getZ(i+2));

        // Validate vertices are finite
        if (!isFinite(v[0].x) || !isFinite(v[1].x) || !isFinite(v[2].x)) {
          // Use base color for invalid triangles
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
        
        // Check for degenerate triangles
        if (normal.length() < 1e-6) {
          // Use base color for degenerate triangles
          for (let j = 0; j < 3; j++) {
            colors[(i + j) * 3]     = BASE[0];
            colors[(i + j) * 3 + 1] = BASE[1];
            colors[(i + j) * 3 + 2] = BASE[2];
          }
          continue;
        }
        
        normal.normalize();
        centroid.addVectors(v[0], v[1]).add(v[2]).divideScalar(3);

        // Normalize centroid to [-1,+1]
        const nx = centroid.x / halfX;
        const nz = centroid.z / halfZ;

        // Face is on outer perimeter of the XZ bounding rectangle
        const onOuterPerimXZ =
          Math.abs(centroid.x - bbox.min.x) < size.x * 0.08 ||
          Math.abs(centroid.x - bbox.max.x) < size.x * 0.08 ||
          Math.abs(centroid.z - bbox.min.z) < size.z * 0.08 ||
          Math.abs(centroid.z - bbox.max.z) < size.z * 0.08;

        // Distance from Y-axis (for cylindrical interior detection)
        const rXZ = Math.sqrt(centroid.x * centroid.x + centroid.z * centroid.z);
        const normalHorizontal = Math.abs(normal.y) < 0.28; // mostly horizontal normal
        const normalUp   = normal.y > 0.65;
        const normalDown = normal.y < -0.45;

        let color: [number,number,number] = BASE;

        // Detect feature type first
        let detectedFeature: string | null = null;

        // ── UNDERCUT: faces pointing downward (not bottom face) ──────────
        if (hasUndercuts && normalDown && centroid.y > bbox.min.y + size.y * 0.05) {
          detectedFeature = 'undercut';
        }
        // ── POCKET: upward-facing recessed faces (NOT the top surface) ──
        else if (hasPockets && normalUp && centroid.y < bbox.max.y - size.y * 0.06 && centroid.y > bbox.min.y + size.y * 0.1) {
          detectedFeature = 'pocket';
        }
        // ── HOLE: cylindrical interior faces (comprehensive detection) ────
        else if (hasHoles) {
          // Multiple criteria for hole detection
          const isVerticalFace = Math.abs(normal.y) < 0.6; // Vertical or angled faces
          const isHorizontalFace = Math.abs(normal.y) > 0.4; // Horizontal or angled faces
          
          // Interior detection - faces that are away from the outer edges
          const distanceFromEdgeX = Math.min(
            Math.abs(centroid.x - bbox.min.x),
            Math.abs(centroid.x - bbox.max.x)
          );
          const distanceFromEdgeZ = Math.min(
            Math.abs(centroid.z - bbox.min.z),
            Math.abs(centroid.z - bbox.max.z)
          );
          const minEdgeDistance = Math.min(distanceFromEdgeX, distanceFromEdgeZ);
          const isInterior = minEdgeDistance > size.x * 0.05; // 5% inward from edges
          
          // Size constraints
          const maxRadius = Math.min(halfX, halfZ) * 0.95;
          const minRadius = Math.min(size.x, size.z) * 0.01; // Minimum hole size
          const isReasonableSize = rXZ >= minRadius && rXZ <= maxRadius;
          
          if ((isVerticalFace || isHorizontalFace) && isInterior && isReasonableSize) {
            detectedFeature = 'hole';
          }
        }
        // ── SLOT (long narrow cut): horizontal interior faces ──────────
        else if (hasSlots && normalHorizontal && !onOuterPerimXZ) {
          detectedFeature = 'slot';
        }
        // ── THIN WALL: nearly-vertical faces near the edges ────────────
        else if (hasThinWalls && normalHorizontal && onOuterPerimXZ) {
          // Detect if it's a particularly thin outer wall
          const edgeLen = Math.max(edge1.length(), edge2.length());
          if (edgeLen < thinThreshold * 2) {
            detectedFeature = 'thin_wall';
          }
        }
        // ── OVERHANG: upward faces at extremes of X or Z ───────────────
        else if (hasOverhangs && normalUp && (Math.abs(nx) > 0.7 || Math.abs(nz) > 0.7)) {
          detectedFeature = 'overhang';
        }

        // Apply color based on selection logic
        if (detectedFeature) {
          // If no feature is selected, show all features
          if (selectedFeatureType === null) {
            color = DFM_COLORS[detectedFeature as DFMType].rgb;
          }
          // If a specific feature is selected, only show that feature
          else if (selectedFeatureType === detectedFeature) {
            color = DFM_COLORS[detectedFeature as DFMType].rgb;
          }
          // Otherwise keep base color (no highlighting for non-selected features)
        }

        // Write color for all 3 vertices of this triangle
        for (let j = 0; j < 3; j++) {
          colors[(i + j) * 3]     = color[0];
          colors[(i + j) * 3 + 1] = color[1];
          colors[(i + j) * 3 + 2] = color[2];
        }
      } catch (triangleError) {
        // If triangle processing fails, use base color
        for (let j = 0; j < 3; j++) {
          colors[(i + j) * 3]     = BASE[0];
          colors[(i + j) * 3 + 1] = BASE[1];
          colors[(i + j) * 3 + 2] = BASE[2];
        }
      }
    }

      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      return geo;
    } catch (error) {
      console.error('DFM color mesh generation failed:', error);
      return null;
    }
  }, [geometry, features, selectedFeatureType]);

  if (!coloredGeo) return null;

  const handleMeshClick = (event: any) => {
    try {
      console.log('DFMColorMesh clicked:', event);
      event.stopPropagation();
      
      // Get the clicked intersection
      const intersection = event.intersections?.[0];
      console.log('Intersection:', intersection);
      if (!intersection || !intersection.face || !intersection.point) {
        console.log('No valid intersection found');
        return;
      }
      
      const face = intersection.face;
      const worldPoint = intersection.point; // 3D world position
      
      // Get vertex colors for this triangle
      const colors = coloredGeo.attributes.color;
      if (!colors || !face) return;
      
      // Sample all three vertex colors for better accuracy
      const colorSamples = [
        { r: colors.getX(face.a * 3), g: colors.getY(face.a * 3), b: colors.getZ(face.a * 3) },
        { r: colors.getX(face.b * 3), g: colors.getY(face.b * 3), b: colors.getZ(face.b * 3) },
        { r: colors.getX(face.c * 3), g: colors.getY(face.c * 3), b: colors.getZ(face.c * 3) }
      ];
      
      // Find the most common color among the three vertices
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
    } catch (error) {
      console.warn('DFM click detection error:', error);
    }
  };

  console.log('DFMColorMesh rendering with geometry:', !!coloredGeo, 'features:', features?.length);
  
  return (
    <group>
      {/* Main DFM colored mesh */}
      <mesh
        geometry={coloredGeo}
        onClick={handleMeshClick}
        onPointerOver={(e) => { 
          e.stopPropagation(); 
          document.body.style.cursor = 'pointer'; 
        }}
        onPointerOut={() => { 
          document.body.style.cursor = 'auto'; 
        }}
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

// ─── Feature Insight Tooltip (HTML overlay shown in sidebar, not 3D) ─────────
// (See ManufacturingAnalysisPanel for sidebar rendering)

// Individual part data for exploded view
interface ExplodedPart {
  geometry: THREE.BufferGeometry;
  centroid: THREE.Vector3;
  boundingBox: THREE.Box3;
  explosionDirection: THREE.Vector3;
  targetPosition: THREE.Vector3;
  currentPosition: THREE.Vector3;
  id: string;
}

// Helper function for part analysis (calculateVolume already exists above)
function calculateBoundingBoxDimensions(geometry: THREE.BufferGeometry) {
  try {
    geometry.computeBoundingBox();
    const bbox = geometry.boundingBox;
    if (!bbox) return { length: 0, width: 0, height: 0 };
    
    const size = new THREE.Vector3();
    bbox.getSize(size);
    
    return {
      length: Math.round(size.x * 1000) / 1000, // Round to 3 decimal places
      width: Math.round(size.y * 1000) / 1000,
      height: Math.round(size.z * 1000) / 1000
    };
  } catch (error) {
    console.warn('Error calculating dimensions:', error);
    return { length: 0, width: 0, height: 0 };
  }
}

// STL Model with section plane and measurements
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
  onPartsDetected
}: {
  url: string;
  color: string;
  sectionPlane: number;
  isTransparent: boolean;
  isWireframe: boolean;
  isExploded?: boolean;
  explodeDistance?: number;
  onLoad?: () => void;
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
}) {
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  const [explodedParts, setExplodedParts] = useState<ExplodedPart[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingStage, setLoadingStage] = useState<string>('Initializing...');
  const [loadingError, setLoadingError] = useState<string | null>(null);
  
  // Progressive loading states
  const [previewReady, setPreviewReady] = useState(false);
  const [detailsReady, setDetailsReady] = useState(false);
  
  // Cache for processed parts to prevent re-calculation on selection changes
  const [processedPartsCache] = useState(new Map<string, ExplodedPart[]>());
  const meshRef = useRef<THREE.Mesh>(null);
  const groupRef = useRef<THREE.Group>(null);


  // Function to separate assembly into individual parts based on connectivity
  // Principal Engineer Solution: Iterative algorithm with performance optimizations
  // Optimized part separation with proper caching
const separateAssemblyParts = useCallback((geometry: THREE.BufferGeometry): ExplodedPart[] => {
    try {
      const position = geometry.attributes.position;
      if (!position) return [];

      const faceCount = position.count / 3;
      
      // Performance guard: Adaptive approach for large meshes
      const MAX_FACES_FULL = 25000;
      const MAX_FACES_SIMPLIFIED = 200000; // Increased limit - use optimized approach longer
      
      if (faceCount > MAX_FACES_SIMPLIFIED) {
        console.warn(`Mesh extremely large: ${faceCount} faces (limit: ${MAX_FACES_SIMPLIFIED}). Using directional explosion.`);
        return createSimplifiedExplodedView(geometry);
      }
      
      if (faceCount > MAX_FACES_FULL) {
        console.log(`Large mesh detected: ${faceCount} faces. Using connected component analysis to detect real mechanical parts.`);
        return createMechanicalPartSeparation(geometry);
      }

      console.log(`Processing assembly with ${faceCount} faces...`);

      // Adaptive tolerance based on mesh size
      geometry.computeBoundingBox();
      const bbox = geometry.boundingBox!;
      const size = new THREE.Vector3();
      bbox.getSize(size);
      const avgDimension = (size.x + size.y + size.z) / 3;
      const tolerance = Math.max(0.001, avgDimension * 0.0001);

      // Build vertex adjacency map with optimized key generation
      const vertexMap = new Map<string, number[]>();
      const faceConnections = new Map<number, Set<number>>();
      
      // Initialize face connections
      for (let i = 0; i < faceCount; i++) {
        faceConnections.set(i, new Set());
      }

      // Process faces in batches to avoid memory spikes
      const BATCH_SIZE = 1000;
      for (let batchStart = 0; batchStart < faceCount; batchStart += BATCH_SIZE) {
        const batchEnd = Math.min(batchStart + BATCH_SIZE, faceCount);
        
        for (let faceIdx = batchStart; faceIdx < batchEnd; faceIdx++) {
          for (let vertIdx = 0; vertIdx < 3; vertIdx++) {
            const idx = faceIdx * 3 + vertIdx;
            const x = position.getX(idx);
            const y = position.getY(idx);
            const z = position.getZ(idx);
            
            // Optimized key generation with fixed precision
            const kx = Math.round(x / tolerance);
            const ky = Math.round(y / tolerance);
            const kz = Math.round(z / tolerance);
            const key = `${kx}:${ky}:${kz}`;
            
            if (!vertexMap.has(key)) {
              vertexMap.set(key, []);
            }
            vertexMap.get(key)!.push(faceIdx);
          }
        }
      }

      // Build face adjacency efficiently with surface normal analysis
      let connectionCount = 0;
      const normalThreshold = 0.5; // ~60 degrees - much more conservative for real parts
      
      // Calculate face normals for better part separation
      const faceNormalMap = new Map<number, THREE.Vector3>();
      for (let faceIdx = 0; faceIdx < faceCount; faceIdx++) {
        // Get triangle vertices
        const idx1 = faceIdx * 3;
        const idx2 = faceIdx * 3 + 1;
        const idx3 = faceIdx * 3 + 2;
        
        const v1 = new THREE.Vector3(position.getX(idx1), position.getY(idx1), position.getZ(idx1));
        const v2 = new THREE.Vector3(position.getX(idx2), position.getY(idx2), position.getZ(idx2));
        const v3 = new THREE.Vector3(position.getX(idx3), position.getY(idx3), position.getZ(idx3));
        
        // Calculate face normal using cross product
        const edge1 = v2.clone().sub(v1);
        const edge2 = v3.clone().sub(v1);
        const normal = edge1.cross(edge2).normalize();
        
        faceNormalMap.set(faceIdx, normal);
      }
      
      for (const faceIndices of vertexMap.values()) {
        if (faceIndices.length > 1 && faceIndices.length < 50) { // Skip vertices with too many connections (likely artifacts)
          for (let i = 0; i < faceIndices.length; i++) {
            for (let j = i + 1; j < faceIndices.length; j++) {
              const faceA = faceIndices[i];
              const faceB = faceIndices[j];
              
              // Check surface normal similarity for real part boundaries
              const normalA = faceNormalMap.get(faceA);
              const normalB = faceNormalMap.get(faceB);
              
              if (normalA && normalB) {
                const dotProduct = normalA.dot(normalB);
                // Only connect faces with similar normals (same part surface)
                if (Math.abs(dotProduct) > normalThreshold) {
                  faceConnections.get(faceA)!.add(faceB);
                  faceConnections.get(faceB)!.add(faceA);
                  connectionCount++;
                }
              } else {
                // Fallback to direct connection if normals not available
                faceConnections.get(faceA)!.add(faceB);
                faceConnections.get(faceB)!.add(faceA);
                connectionCount++;
              }
            }
          }
        }
      }

      console.log(`Built ${connectionCount} face connections`);

      // ITERATIVE DFS using stack to avoid call stack overflow
      const visited = new Set<number>();
      const components: number[][] = [];

      const iterativeDFS = (startFace: number): number[] => {
        const component: number[] = [];
        const stack: number[] = [startFace];
        
        while (stack.length > 0) {
          const currentFace = stack.pop()!;
          
          if (visited.has(currentFace)) continue;
          
          visited.add(currentFace);
          component.push(currentFace);
          
          // Add all unvisited neighbors to stack
          const connections = faceConnections.get(currentFace) || new Set();
          for (const neighbor of connections) {
            if (!visited.has(neighbor)) {
              stack.push(neighbor);
            }
          }
          
          // Safety guard against infinite loops
          if (component.length > faceCount) {
            console.warn('Component size exceeded face count, breaking DFS');
            break;
          }
        }
        
        return component;
      };

      // Find all connected components
      for (let i = 0; i < faceCount; i++) {
        if (!visited.has(i)) {
          const component = iterativeDFS(i);
          if (component.length > 0) {
            components.push(component);
          }
        }
      }

      // Filter components with improved heuristics
      const minComponentSize = Math.max(50, Math.floor(faceCount * 0.02)); // 2% minimum - only detect substantial parts
      const maxComponents = 50; // Allow detection of all actual assembly parts
      
      let significantComponents = components.filter(comp => comp.length >= minComponentSize);
      
      // Sort by size and take largest components if too many
      if (significantComponents.length > maxComponents) {
        significantComponents.sort((a, b) => b.length - a.length);
        significantComponents = significantComponents.slice(0, maxComponents);
      }

      console.log(`Assembly analysis: Found ${significantComponents.length} parts from ${faceCount} faces`);

      // Create geometries for each part
      const parts: ExplodedPart[] = significantComponents.map((faceIndices, partIndex) => {
        return createPartGeometry(faceIndices, partIndex, significantComponents.length, position, geometry);
      });

      // Clean up large data structures
      vertexMap.clear();
      faceConnections.clear();

      return parts;

    } catch (error) {
      console.error('Failed to separate assembly parts:', error);
      // Fallback to simplified view
      return createSimplifiedExplodedView(geometry);
    }
  }, []); // Stable function, no dependencies needed

  // Mechanical part separation using connected component analysis  
  const createMechanicalPartSeparation = (geometry: THREE.BufferGeometry): ExplodedPart[] => {
    console.log('Creating mechanical part separation for assembly');
    
    try {
      const position = geometry.attributes.position;
      const faceCount = position.count / 3;
      
      geometry.computeBoundingBox();
      const bbox = geometry.boundingBox!;
      const size = new THREE.Vector3();
      bbox.getSize(size);
      
      console.log(`Assembly dimensions: ${size.x.toFixed(1)} × ${size.y.toFixed(1)} × ${size.z.toFixed(1)} mm`);
      
      // Enhanced part detection using surface normal analysis
      const vertexMap = new Map<string, number[]>();
      const faceNormalMap = new Map<number, THREE.Vector3>();
      const tolerance = Math.min(size.x, size.y, size.z) * 0.001; // Balanced tolerance for real assemblies
      
      // Calculate face normals manually for better accuracy
      for (let faceIdx = 0; faceIdx < faceCount; faceIdx++) {
        // Get triangle vertices
        const idx1 = faceIdx * 3;
        const idx2 = faceIdx * 3 + 1;
        const idx3 = faceIdx * 3 + 2;
        
        const v1 = new THREE.Vector3(position.getX(idx1), position.getY(idx1), position.getZ(idx1));
        const v2 = new THREE.Vector3(position.getX(idx2), position.getY(idx2), position.getZ(idx2));
        const v3 = new THREE.Vector3(position.getX(idx3), position.getY(idx3), position.getZ(idx3));
        
        // Calculate face normal using cross product
        const edge1 = v2.clone().sub(v1);
        const edge2 = v3.clone().sub(v1);
        const normal = edge1.cross(edge2).normalize();
        
        faceNormalMap.set(faceIdx, normal);
      }
      
      for (let faceIdx = 0; faceIdx < faceCount; faceIdx++) {
        for (let vertIdx = 0; vertIdx < 3; vertIdx++) {
          const idx = faceIdx * 3 + vertIdx;
          const x = position.getX(idx);
          const y = position.getY(idx);
          const z = position.getZ(idx);
          
          // Create vertex key with higher precision for real part boundaries
          const vertexKey = `${Math.round(x / tolerance)}_${Math.round(y / tolerance)}_${Math.round(z / tolerance)}`;
          
          if (!vertexMap.has(vertexKey)) {
            vertexMap.set(vertexKey, []);
          }
          vertexMap.get(vertexKey)!.push(faceIdx);
        }
      }
      
      // Build face connectivity graph - only connect faces that share an edge
      const faceConnections = new Map<number, Set<number>>();
      
      for (let faceIdx = 0; faceIdx < faceCount; faceIdx++) {
        faceConnections.set(faceIdx, new Set());
      }
      
      // Only connect faces that share an edge (2 vertices), not just any vertex
      for (const [vertexKey, faces] of vertexMap.entries()) {
        if (faces.length > 1 && faces.length < 8) { // Avoid high-degree vertices
          for (let i = 0; i < faces.length; i++) {
            for (let j = i + 1; j < faces.length; j++) {
              const faceA = faces[i];
              const faceB = faces[j];
              
              // Check if faces share an edge (need to share 2 vertices)
              const sharedVertices = getSharedVertices(faceA, faceB, position, tolerance);
              if (sharedVertices >= 2) {
                faceConnections.get(faceA)!.add(faceB);
                faceConnections.get(faceB)!.add(faceA);
              }
            }
          }
        }
      }
      
      // Find connected components (real mechanical parts)
      const visited = new Set<number>();
      const components: number[][] = [];
      
      for (let faceIdx = 0; faceIdx < faceCount; faceIdx++) {
        if (visited.has(faceIdx)) continue;
        
        const component: number[] = [];
        const stack: number[] = [faceIdx];
        
        while (stack.length > 0) {
          const currentFace = stack.pop()!;
          if (visited.has(currentFace)) continue;
          
          visited.add(currentFace);
          component.push(currentFace);
          
          // Add connected faces to stack
          const connections = faceConnections.get(currentFace) || new Set();
          for (const connectedFace of connections) {
            if (!visited.has(connectedFace)) {
              stack.push(connectedFace);
            }
          }
        }
        
        if (component.length > 0) {
          components.push(component);
        }
      }
      
      // Filter components by size - remove tiny artifacts but keep small mechanical parts
      const minFacesPerPart = Math.max(100, Math.floor(faceCount * 0.01)); // 1% minimum - substantial parts only
      const maxFacesPerPart = Math.floor(faceCount * 0.8); // No single part should be >80% of assembly
      
      // Enhanced filtering for real assembly parts
      let significantComponents = components.filter(comp => {
        if (comp.length < minFacesPerPart || comp.length > maxFacesPerPart) {
          return false;
        }
        
        // Calculate part volume and surface characteristics
        const partFaces = comp;
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity; 
        let minZ = Infinity, maxZ = -Infinity;
        
        // Calculate bounding box for this component
        for (const faceIdx of partFaces) {
          for (let vertIdx = 0; vertIdx < 3; vertIdx++) {
            const idx = faceIdx * 3 + vertIdx;
            const x = position.getX(idx);
            const y = position.getY(idx);
            const z = position.getZ(idx);
            
            minX = Math.min(minX, x); maxX = Math.max(maxX, x);
            minY = Math.min(minY, y); maxY = Math.max(maxY, y);
            minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
          }
        }
        
        // Calculate dimensions
        const width = maxX - minX;
        const height = maxY - minY;
        const depth = maxZ - minZ;
        const volume = width * height * depth;
        
        // Filter out small surface details - only keep substantial mechanical parts  
        const totalAssemblyVolume = size.x * size.y * size.z;
        const minRealPartVolume = Math.max(1.0, totalAssemblyVolume * 0.001); // 0.1% of assembly volume
        return volume >= minRealPartVolume;
      });
      
      // If we still have too few parts, use backup geometric separation
      if (significantComponents.length < 10) {
        console.log('Too few parts detected, adding geometric separation...');
        const geometricParts = detectGeometricParts(position, faceCount, bbox);
        significantComponents.push(...geometricParts);
      }
      
      // Sort by size and limit to realistic assembly part count
      significantComponents.sort((a, b) => b.length - a.length);
      const maxComponents = Math.min(significantComponents.length, 30); // Realistic limit for typical assemblies  
      significantComponents = significantComponents.slice(0, maxComponents);
      
      console.log(`🔧 Enhanced Part Detection Results:`);
      console.log(`  - Total faces: ${faceCount}`);
      console.log(`  - Connected components: ${components.length}`);
      console.log(`  - Significant parts: ${significantComponents.length}`);
      console.log(`  - Part size range: ${Math.min(...significantComponents.map(c => c.length))} - ${Math.max(...significantComponents.map(c => c.length))} faces`);
      console.log(`  - Using surface normal analysis for accurate boundaries`);
      
      // Consolidate small adjacent components that likely belong to the same part
      const consolidatedComponents = consolidateAdjacentParts(significantComponents, position, faceConnections);
      console.log(`  - After consolidation: ${consolidatedComponents.length} parts`);
      
      // Create geometries for each part
      const parts: ExplodedPart[] = consolidatedComponents.map((faceIndices, partIndex) => {
        return createPartGeometry(faceIndices, partIndex, consolidatedComponents.length, position, geometry);
      });
      
      // Clean up
      vertexMap.clear();
      faceConnections.clear();
      
      return parts;
      
    } catch (error) {
      console.error('Mechanical part separation failed:', error);
      return createOptimizedPartSeparation(geometry);
    }
  };
  
  // Helper function to check shared vertices between faces
  const getSharedVertices = (
    faceA: number, 
    faceB: number, 
    position: THREE.BufferAttribute, 
    tolerance: number
  ): number => {
    const verticesA = [];
    const verticesB = [];
    
    for (let i = 0; i < 3; i++) {
      const idxA = faceA * 3 + i;
      const idxB = faceB * 3 + i;
      verticesA.push([position.getX(idxA), position.getY(idxA), position.getZ(idxA)]);
      verticesB.push([position.getX(idxB), position.getY(idxB), position.getZ(idxB)]);
    }
    
    let sharedCount = 0;
    for (const vA of verticesA) {
      for (const vB of verticesB) {
        const distance = Math.sqrt((vA[0] - vB[0])**2 + (vA[1] - vB[1])**2 + (vA[2] - vB[2])**2);
        if (distance < tolerance) {
          sharedCount++;
          break;
        }
      }
    }
    
    return sharedCount;
  };
  
  // Enhanced detection for geometric parts using spatial analysis
  const detectGeometricParts = (
    position: THREE.BufferAttribute, 
    faceCount: number, 
    bbox: THREE.Box3
  ): number[][] => {
    console.log('Using geometric part detection for better separation...');
    
    const size = new THREE.Vector3();
    bbox.getSize(size);
    
    // Use spatial subdivision to create logical parts
    const gridSize = 6; // Coarser grid for geometric separation
    const cellSize = {
      x: size.x / gridSize,
      y: size.y / gridSize,
      z: size.z / gridSize
    };
    
    const spatialCells = new Map<string, number[]>();
    
    // Assign faces to spatial cells
    for (let faceIdx = 0; faceIdx < faceCount; faceIdx++) {
      // Calculate face centroid
      const centroid = new THREE.Vector3();
      for (let vertIdx = 0; vertIdx < 3; vertIdx++) {
        const idx = faceIdx * 3 + vertIdx;
        centroid.add(new THREE.Vector3(
          position.getX(idx),
          position.getY(idx),
          position.getZ(idx)
        ));
      }
      centroid.divideScalar(3);
      
      // Calculate grid cell
      const cellX = Math.floor((centroid.x - bbox.min.x) / cellSize.x);
      const cellY = Math.floor((centroid.y - bbox.min.y) / cellSize.y);
      const cellZ = Math.floor((centroid.z - bbox.min.z) / cellSize.z);
      
      const clampedX = Math.max(0, Math.min(gridSize - 1, cellX));
      const clampedY = Math.max(0, Math.min(gridSize - 1, cellY));
      const clampedZ = Math.max(0, Math.min(gridSize - 1, cellZ));
      
      const cellKey = `${clampedX}-${clampedY}-${clampedZ}`;
      
      if (!spatialCells.has(cellKey)) {
        spatialCells.set(cellKey, []);
      }
      spatialCells.get(cellKey)!.push(faceIdx);
    }
    
    // Create parts from non-empty cells
    const geometricParts: number[][] = [];
    for (const [cellKey, faces] of spatialCells.entries()) {
      if (faces.length > 10) { // Minimum faces per geometric part
        geometricParts.push(faces);
      }
    }
    
    return geometricParts;
  };

  // Optimized part separation for medium-large meshes - Enhanced for monolithic assemblies
  const createOptimizedPartSeparation = (geometry: THREE.BufferGeometry): ExplodedPart[] => {
    console.log('Creating optimized part separation for large mesh');
    
    try {
      const position = geometry.attributes.position;
      const faceCount = position.count / 3;
      
      // Use density-based clustering for monolithic meshes
      geometry.computeBoundingBox();
      const bbox = geometry.boundingBox!;
      const size = new THREE.Vector3();
      bbox.getSize(size);
      const center = new THREE.Vector3();
      bbox.getCenter(center);
      
      console.log(`Assembly dimensions: ${size.x.toFixed(1)} × ${size.y.toFixed(1)} × ${size.z.toFixed(1)} mm`);
      
      // Enhanced spatial grid with density analysis
      const gridSize = 30; // Even higher resolution for better small part detection
      const cellSize = {
        x: size.x / gridSize,
        y: size.y / gridSize,
        z: size.z / gridSize
      };
      
      const cellMap = new Map<string, number[]>();
      const cellDensity = new Map<string, number>(); // Track face density per cell
      const cellNormals = new Map<string, THREE.Vector3[]>(); // Track normals per cell for boundary detection
      const neighborMap = new Map<string, Set<string>>(); // Track neighboring cells for clustering
      
      // Assign faces to spatial cells with density tracking
      for (let faceIdx = 0; faceIdx < faceCount; faceIdx++) {
        // Calculate face centroid
        const v1 = new THREE.Vector3(
          position.getX(faceIdx * 3),
          position.getY(faceIdx * 3),
          position.getZ(faceIdx * 3)
        );
        const v2 = new THREE.Vector3(
          position.getX(faceIdx * 3 + 1),
          position.getY(faceIdx * 3 + 1),
          position.getZ(faceIdx * 3 + 1)
        );
        const v3 = new THREE.Vector3(
          position.getX(faceIdx * 3 + 2),
          position.getY(faceIdx * 3 + 2),
          position.getZ(faceIdx * 3 + 2)
        );
        
        const faceCentroid = new THREE.Vector3()
          .addVectors(v1, v2)
          .add(v3)
          .divideScalar(3);
        
        // Calculate face area and normal for density weighting and boundary detection
        const edge1 = new THREE.Vector3().subVectors(v2, v1);
        const edge2 = new THREE.Vector3().subVectors(v3, v1);
        const faceNormal = new THREE.Vector3().crossVectors(edge1, edge2).normalize();
        const faceArea = new THREE.Vector3().crossVectors(edge1, edge2).length() / 2;
        
        // Calculate grid cell
        const cellX = Math.floor((faceCentroid.x - bbox.min.x) / cellSize.x);
        const cellY = Math.floor((faceCentroid.y - bbox.min.y) / cellSize.y);
        const cellZ = Math.floor((faceCentroid.z - bbox.min.z) / cellSize.z);
        
        // Clamp to valid range
        const clampedX = Math.max(0, Math.min(gridSize - 1, cellX));
        const clampedY = Math.max(0, Math.min(gridSize - 1, cellY));
        const clampedZ = Math.max(0, Math.min(gridSize - 1, cellZ));
        
        const cellKey = `${clampedX}-${clampedY}-${clampedZ}`;
        
        if (!cellMap.has(cellKey)) {
          cellMap.set(cellKey, []);
          cellDensity.set(cellKey, 0);
          cellNormals.set(cellKey, []);
        }
        cellMap.get(cellKey)!.push(faceIdx);
        cellDensity.set(cellKey, cellDensity.get(cellKey)! + faceArea);
        cellNormals.get(cellKey)!.push(faceNormal.clone());
      }
      
      console.log(`Spatial grid populated: ${cellMap.size} cells with geometry`);
      
      // Find density peaks (likely part centers) using local maxima detection
      const densityPeaks: Array<{key: string, density: number, x: number, y: number, z: number}> = [];
      const avgDensity = Array.from(cellDensity.values()).reduce((a, b) => a + b, 0) / cellDensity.size;
      const densityThreshold = avgDensity * 2; // Only consider high-density cells
      
      for (const [cellKey, density] of cellDensity.entries()) {
        if (density < densityThreshold) continue;
        
        const [x, y, z] = cellKey.split('-').map(Number);
        
        // Check if this is a local maximum (higher density than all neighbors)
        let isLocalMax = true;
        for (let dx = -2; dx <= 2; dx++) {
          for (let dy = -2; dy <= 2; dy++) {
            for (let dz = -2; dz <= 2; dz++) {
              if (dx === 0 && dy === 0 && dz === 0) continue;
              
              const neighborKey = `${x + dx}-${y + dy}-${z + dz}`;
              const neighborDensity = cellDensity.get(neighborKey) || 0;
              
              if (neighborDensity > density) {
                isLocalMax = false;
                break;
              }
            }
            if (!isLocalMax) break;
          }
          if (!isLocalMax) break;
        }
        
        if (isLocalMax) {
          densityPeaks.push({key: cellKey, density, x, y, z});
        }
      }
      
      // Sort peaks by density and select top candidates
      densityPeaks.sort((a, b) => b.density - a.density);
      // Take more seed points to ensure we capture all potential parts
      const selectedPeaks = densityPeaks.slice(0, Math.min(50, densityPeaks.length));
      
      console.log(`Found ${selectedPeaks.length} density peaks from ${densityPeaks.length} candidates`);
      
      // Build neighborhood relationships for clustering
      for (const [cellKey, faces] of cellMap.entries()) {
        if (faces.length === 0) continue;
        
        const neighbors = new Set<string>();
        const [x, y, z] = cellKey.split('-').map(Number);
        
        // Check 26 neighboring cells (3x3x3 - 1)
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dz = -1; dz <= 1; dz++) {
              if (dx === 0 && dy === 0 && dz === 0) continue;
              
              const neighborKey = `${x + dx}-${y + dy}-${z + dz}`;
              if (cellMap.has(neighborKey) && cellMap.get(neighborKey)!.length > 0) {
                neighbors.add(neighborKey);
              }
            }
          }
        }
        
        neighborMap.set(cellKey, neighbors);
      }
      
      // Use much more aggressive part separation approach
      // First create individual clusters from each density peak
      const clusters: string[][] = [];
      const visited = new Set<string>();
      
      // Find seed points from density peaks for part centers
      const seedPoints = selectedPeaks.map(peak => peak.key);
      
      // Create separate clusters for each density peak with very restricted growth
      for (const seedKey of seedPoints) {
        if (visited.has(seedKey)) continue;
        
        const cluster: string[] = [seedKey];
        visited.add(seedKey);
        
        // Only grow very conservatively - immediate neighbors with similar density
        const seedDensity = cellDensity.get(seedKey) || 0;
        const neighbors = neighborMap.get(seedKey) || new Set();
        
        for (const neighbor of neighbors) {
          if (visited.has(neighbor)) continue;
          
          const neighborDensity = cellDensity.get(neighbor) || 0;
          const densityRatio = Math.min(seedDensity, neighborDensity) / Math.max(seedDensity, neighborDensity, 1);
          
          // Check both density similarity and normal consistency for part boundaries
          const seedNormals = cellNormals.get(seedKey) || [];
          const neighborNormals = cellNormals.get(neighbor) || [];
          
          let normalSimilarity = 0;
          if (seedNormals.length > 0 && neighborNormals.length > 0) {
            // Calculate average normal for each cell
            const avgSeedNormal = seedNormals.reduce((sum, n) => sum.add(n), new THREE.Vector3()).normalize();
            const avgNeighborNormal = neighborNormals.reduce((sum, n) => sum.add(n), new THREE.Vector3()).normalize();
            normalSimilarity = avgSeedNormal.dot(avgNeighborNormal);
          }
          
          // Very restrictive - require both density and normal similarity
          const isDensitySimilar = densityRatio > 0.85 && Math.abs(seedDensity - neighborDensity) < 5;
          const isNormalSimilar = normalSimilarity > 0.7; // Surface normals must be fairly aligned
          
          if (isDensitySimilar && (seedNormals.length === 0 || isNormalSimilar)) {
            cluster.push(neighbor);
            visited.add(neighbor);
          }
        }
        
        if (cluster.length > 0) {
          clusters.push(cluster);
        }
      }
      
      // Now use geometric analysis to identify additional parts
      // Look for isolated high-density regions that weren't captured by peaks
      const remainingHighDensityCells = Array.from(cellMap.keys()).filter(key => {
        const density = cellDensity.get(key) || 0;
        return !visited.has(key) && density > 3; // Lower threshold for isolated parts
      });
      
      // Group remaining cells using spatial proximity and normal analysis
      for (const cellKey of remainingHighDensityCells) {
        if (visited.has(cellKey)) continue;
        
        const cluster: string[] = [cellKey];
        visited.add(cellKey);
        
        const [x, y, z] = cellKey.split('-').map(Number);
        
        // Very conservative spatial clustering for small parts
        for (const otherKey of remainingHighDensityCells) {
          if (visited.has(otherKey)) continue;
          
          const [ox, oy, oz] = otherKey.split('-').map(Number);
          const distance = Math.sqrt((x-ox)**2 + (y-oy)**2 + (z-oz)**2);
          
          // Only cluster very close cells (within 2 grid cells)
          if (distance <= 2) {
            cluster.push(otherKey);
            visited.add(otherKey);
          }
        }
        
        if (cluster.length > 0) {
          clusters.push(cluster);
        }
      }
      
      // Finally, create individual parts from remaining isolated cells
      for (const [cellKey, faces] of cellMap.entries()) {
        if (!visited.has(cellKey) && faces.length > 0) {
          clusters.push([cellKey]);
          visited.add(cellKey);
        }
      }
      
      // Convert clusters to parts with very permissive filtering to capture all parts
      const avgFacesPerPart = faceCount / 22; // Expecting ~22 parts
      const minFacesForLargePart = Math.max(10, Math.floor(avgFacesPerPart * 0.02)); // Very permissive - 2% of average
      const minFacesForSmallPart = 1; // Allow even single-face parts (bolts, small components)
      
      const allClusters = clusters
        .map(cluster => {
          // Combine all faces from cells in this cluster
          const allFaces: number[] = [];
          for (const cellKey of cluster) {
            const cellFaces = cellMap.get(cellKey) || [];
            allFaces.push(...cellFaces);
          }
          return { cluster, faces: allFaces, isSmall: allFaces.length < minFacesForLargePart };
        })
        .filter(({ faces, isSmall }) => {
          // Include all parts above minimum, with different thresholds for small vs large parts
          return isSmall ? faces.length >= minFacesForSmallPart : faces.length >= minFacesForLargePart;
        })
        .sort((a, b) => b.faces.length - a.faces.length);
      
      // Take all detected parts, no artificial limit
      const targetParts = 22;
      const maxParts = Math.min(allClusters.length, 50); // Allow up to 50 parts
      const significantClusters = allClusters.slice(0, maxParts);
      
      console.log(`Enhanced clustering: Found ${significantClusters.length} parts from ${clusters.length} clusters (${cellMap.size} cells)`);
      
      // Create parts from clustered cells
      const parts: ExplodedPart[] = significantClusters.map(({ faces }, partIndex) => {
        return createPartGeometry(faces, partIndex, significantClusters.length, position, geometry);
      });
      
      return parts;
      
    } catch (error) {
      console.error('Optimized separation failed:', error);
      return createSimplifiedExplodedView(geometry);
    }
  };

  // Helper function for simplified exploded view (fallback for extremely large meshes)
  const createSimplifiedExplodedView = (geometry: THREE.BufferGeometry): ExplodedPart[] => {
    console.log('Creating simplified exploded view');
    
    // Calculate geometry center for proper positioning
    geometry.computeBoundingBox();
    const bbox = geometry.boundingBox!;
    const geometryCenter = new THREE.Vector3();
    bbox.getCenter(geometryCenter);
    
    // For extremely large meshes, create logical directional sections
    const sections = 6; // 6 directional sections for better distribution
    const parts: ExplodedPart[] = [];
    
    for (let i = 0; i < sections; i++) {
      const angle = (i / sections) * Math.PI * 2;
      const height = Math.sin(i * 0.8) * 0.4; // Vary height for 3D distribution
      
      const direction = new THREE.Vector3(
        Math.cos(angle) * 0.8,
        height + 0.3, // Upward bias with variation
        Math.sin(angle) * 0.8
      ).normalize();

      parts.push({
        geometry: geometry.clone(),
        centroid: geometryCenter.clone(),
        boundingBox: geometry.boundingBox?.clone() || new THREE.Box3(),
        explosionDirection: direction,
        targetPosition: new THREE.Vector3(0, 0, 0),
        currentPosition: new THREE.Vector3(0, 0, 0), // Start at origin for proper animation
        id: `simplified-section-${i}`,
      });
    }
    
    return parts;
  };

  // Helper function to create part geometry
  const createPartGeometry = (
    faceIndices: number[], 
    partIndex: number, 
    totalParts: number, 
    position: THREE.BufferAttribute, 
    originalGeometry: THREE.BufferGeometry
  ): ExplodedPart => {
    const partVertices: number[] = [];
    const partGeometry = new THREE.BufferGeometry();

    // Extract vertices for this part
    for (const faceIdx of faceIndices) {
      for (let vertIdx = 0; vertIdx < 3; vertIdx++) {
        const idx = faceIdx * 3 + vertIdx;
        partVertices.push(
          position.getX(idx),
          position.getY(idx),
          position.getZ(idx)
        );
      }
    }

    partGeometry.setAttribute('position', new THREE.Float32BufferAttribute(partVertices, 3));
    partGeometry.computeVertexNormals();
    partGeometry.computeBoundingBox();

    // Calculate centroid
    const bbox = partGeometry.boundingBox!;
    const centroid = new THREE.Vector3();
    bbox.getCenter(centroid);

    // Calculate intelligent explosion direction
    const assemblyBBox = originalGeometry.boundingBox!;
    const assemblyCenter = new THREE.Vector3();
    assemblyBBox.getCenter(assemblyCenter);
    const assemblySize = new THREE.Vector3();
    assemblyBBox.getSize(assemblySize);

    let explosionDirection = new THREE.Vector3().subVectors(centroid, assemblyCenter);
    
    // Normalize by assembly dimensions for better directional separation
    explosionDirection.divide(assemblySize).normalize();
    
    // Enhanced directional logic for better part separation
    if (explosionDirection.length() < 0.1) {
      // Create systematic radial distribution
      const ringCount = Math.ceil(Math.sqrt(totalParts));
      const ring = Math.floor(partIndex / ringCount);
      const posInRing = partIndex % ringCount;
      const angleStep = (2 * Math.PI) / Math.max(1, ringCount);
      const angle = posInRing * angleStep + (ring * 0.3); // Offset rings slightly
      
      const radius = 0.7 + ring * 0.3; // Increase radius for outer rings
      const height = Math.sin(angle * 2) * 0.4 + ring * 0.2; // Vary height
      
      explosionDirection.set(
        Math.cos(angle) * radius,
        height,
        Math.sin(angle) * radius
      ).normalize();
    } else {
      // Amplify existing direction with bias toward major axes
      const absX = Math.abs(explosionDirection.x);
      const absY = Math.abs(explosionDirection.y);
      const absZ = Math.abs(explosionDirection.z);
      
      // Enhance dominant axis for cleaner separation
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
      currentPosition: centroid.clone(), // CRITICAL FIX: Initialize at centroid position, not origin
      id: `part-${partIndex + 1}`,
    };
  };

  // Helper function to consolidate small adjacent parts 
  const consolidateAdjacentParts = (components: number[][], position: THREE.BufferAttribute, faceConnections: Map<number, Set<number>>): number[][] => {
    if (components.length <= 22) return components; // Already at reasonable count
    
    // Sort components by size (smallest first for consolidation)
    const sortedComponents = [...components].sort((a, b) => a.length - b.length);
    const consolidated: number[][] = [];
    const used = new Set<number>();
    
    for (const component of sortedComponents) {
      if (used.has(component[0])) continue; // Skip if already consolidated
      
      let mergedComponent = [...component];
      
      // If this is a small component, try to merge with adjacent larger components
      if (component.length < components.reduce((sum, c) => sum + c.length, 0) / components.length) {
        // Find adjacent components
        for (const face of component) {
          const adjacentFaces = faceConnections.get(face) || new Set();
          
          for (const adjFace of adjacentFaces) {
            // Find which component contains this adjacent face
            const targetComponent = sortedComponents.find(comp => 
              comp.includes(adjFace) && !used.has(comp[0]) && comp !== component
            );
            
            if (targetComponent && targetComponent.length > component.length * 2) {
              // Merge small component into larger adjacent component
              mergedComponent.push(...targetComponent);
              used.add(targetComponent[0]);
              break;
            }
          }
        }
      }
      
      used.add(component[0]);
      consolidated.push(mergedComponent);
    }
    
    return consolidated.slice(0, 25); // Limit to reasonable number
  };

  // Stable callback references to prevent infinite re-renders
  const stableOnPartsDetected = useRef(onPartsDetected);
  const stableOnLoad = useRef(onLoad);
  
  // Update refs when props change, but don't trigger re-renders
  useEffect(() => {
    stableOnPartsDetected.current = onPartsDetected;
    stableOnLoad.current = onLoad;
  });

  // Extract common geometry processing logic
  const processGeometryAfterLoad = useCallback((loadedGeometry: THREE.BufferGeometry) => {
    // Check geometry size and memory usage before processing
    const positionArray = loadedGeometry.attributes.position;
    const faceCount = positionArray ? positionArray.count / 3 : 0;
    const vertexCount = positionArray ? positionArray.count : 0;
    const estimatedMemoryMB = (vertexCount * 3 * 4) / (1024 * 1024); // 4 bytes per float
    
    console.log('📊 Geometry analysis:', {
      hasPosition: !!positionArray,
      faceCount,
      vertexCount,
      estimatedMemoryMB: estimatedMemoryMB.toFixed(2),
      hasNormals: !!loadedGeometry.attributes.normal
    });
    
    // Memory safety check - reject files that are too large
    if (estimatedMemoryMB > 500) { // 500MB limit
      console.error('❌ File too large for browser rendering:', estimatedMemoryMB.toFixed(2), 'MB');
      setLoadingError(`File too large (${estimatedMemoryMB.toFixed(1)}MB). Please use a smaller file or convert to a lower resolution.`);
      setIsLoading(false);
      return;
    }
    
    if (faceCount > 1000000) { // 1M triangles limit
      console.error('❌ Too many triangles for browser rendering:', faceCount);
      setLoadingError(`File too complex (${faceCount.toLocaleString()} triangles). Please simplify the model.`);
      setIsLoading(false);
      return;
    }
    
    setIsLoading(false);
    setLoadingProgress(100);
    console.log('✅ Geometry loaded successfully');
    console.log('📊 Geometry info:', {
      hasPosition: !!loadedGeometry.attributes.position,
      faceCount: loadedGeometry.attributes.position ? loadedGeometry.attributes.position.count / 3 : 0,
      hasNormals: !!loadedGeometry.attributes.normal
    });
    
    console.log('🎯 Setting geometry and starting part analysis...');
    
    // Declare detectedParts outside the try block so it's accessible later
    let detectedParts: ExplodedPart[] = [];
    
    try {
      // Wrap geometry setting in memory error handling
      try {
        setGeometry(loadedGeometry);
      } catch (memoryError) {
        if (memoryError instanceof RangeError && memoryError.message.includes('Array buffer allocation failed')) {
          console.error('💥 Memory allocation failed during geometry processing');
          setLoadingError('File too large for browser memory. Please use a smaller or simplified model.');
          setIsLoading(false);
          return;
        }
        throw memoryError; // Re-throw if it's not a memory error
      }
      
      // Separate into individual parts for exploded view
      console.log('🔧 Starting part separation analysis...');
      
      const parts = separateAssemblyParts(loadedGeometry);
      console.log('📈 Part separation results:', {
        partsDetected: parts.length,
        parts: parts.map(p => ({ id: p.id, faces: p.geometry.attributes.position.count / 3 }))
      });
      
      if (parts.length > 0) {
        console.log('✅ Part separation successful:', {
          partCount: parts.length,
          parts: parts.map(p => ({ id: p.id, faceCount: p.geometry.attributes.position.count / 3 }))
        });
        detectedParts = parts;
        setExplodedParts(parts);
      } else {
        console.warn('⚠️ Part separation failed - no parts detected');
        console.log('💡 Falling back to simplified directional explosion');
        // Use the proven simplified exploded view for fallback
        const fallbackParts = createSimplifiedExplodedView(loadedGeometry);
        console.log('🔄 Created fallback explosion with', fallbackParts.length, 'virtual parts');
        setExplodedParts(fallbackParts);
      }
    } catch (error) {
      console.error('❌ Part separation failed:', error);
      
      // Check if it's a memory allocation error
      if (error instanceof RangeError && error.message.includes('Array buffer allocation failed')) {
        console.error('💥 Memory allocation failed - file too large for browser');
        setLoadingError('File too large for browser memory. Please use a smaller or simplified model.');
        setIsLoading(false);
        return;
      }
      
      console.log('🔄 Falling back to simplified directional explosion');
      // Even on error, provide exploded view functionality
      try {
        const fallbackParts = createSimplifiedExplodedView(loadedGeometry);
        console.log('🔧 Emergency fallback created', fallbackParts.length, 'virtual parts');
        setExplodedParts(fallbackParts);
      } catch (fallbackError) {
        console.error('❌ Even fallback failed:', fallbackError);
        // If all else fails, just display the geometry without explosion
        setExplodedParts([]);
      }
    }
    
    // Notify parent component about detected parts for BOM integration  
    if (stableOnPartsDetected.current && detectedParts.length > 0) {
      const partData = detectedParts.map((part, index) => ({
        id: part.id, // Use the existing part ID instead of regenerating
        name: `Component ${index + 1}`,
        geometry: part.geometry,
        partNumber: part.id.toUpperCase(), // Use part ID as part number
        material: 'Unknown',
        quantity: 1,
        faceCount: part.geometry.attributes.position.count / 3,
        volume: calculateVolume(part.geometry),
        ...calculateBoundingBoxDimensions(part.geometry)
      }));
      stableOnPartsDetected.current(partData);
      console.log('💎 Notified parent component with detected parts:', partData.map(p => p.id));
    } else {
      console.warn('⚠️ No parts detected or onPartsDetected callback missing');
      console.log('Parts count:', detectedParts?.length || 0, 'Callback available:', !!stableOnPartsDetected.current);
    }
    
    stableOnLoad.current?.();
  }, [separateAssemblyParts, createSimplifiedExplodedView, stableOnPartsDetected, stableOnLoad]);

  useEffect(() => {
    if (!url) {
      console.warn('❌ No URL provided for STL loading');
      return;
    }
    
    // Prevent duplicate loading of the same URL
    if (isLoading) {
      console.log('⚠️ Already loading, skipping duplicate request');
      return;
    }
    
    // Validate URL format before loading
    try {
      new URL(url);
    } catch (error) {
      console.error('❌ Invalid URL format:', url);
      setLoadingError('Invalid file URL format');
      return;
    }
    
    // Check if this is a STEP file for direct CAD engine processing
    const isStepFile = url.toLowerCase().includes('.step') || url.toLowerCase().includes('.stp');
    
    if (isStepFile) {
      console.log('🔄 Loading STEP file directly via CAD engine:', url);
      setLoadingStage('Processing STEP file...');
      setLoadingProgress(10);
      
      // Direct STEP file processing using your CAD engine
      const loadStepFile = async () => {
        setIsLoading(true);
        setLoadingProgress(0);
        setLoadingError(null);
        
        const loadingTimeout = setTimeout(() => {
          console.error('⏱️ STEP processing timeout after 60 seconds');
          setLoadingError('Processing timeout - STEP file may be too complex');
          setIsLoading(false);
        }, 60000);
        
        try {
          setLoadingStage('Analyzing STEP file...');
          setLoadingProgress(20);
          
          // Send STEP file to your CAD engine using existing endpoint
          const response = await fetch(url);
          if (!response.ok) {
            throw new Error(`Failed to fetch STEP file: ${response.statusText}`);
          }
          
          const stepBlob = await response.blob();
          const formData = new FormData();
          formData.append('file', stepBlob, 'model.step');
          
          setLoadingStage('Converting with CAD engine...');
          setLoadingProgress(40);
          
          // Use the correct endpoint that your CAD engine supports
          const cadResponse = await fetch(`${apiConfig.endpoints.cad}/convert/step-to-stl-base64`, {
            method: 'POST',
            body: formData,
          });
          
          if (!cadResponse.ok) {
            throw new Error(`CAD engine failed: ${cadResponse.statusText}`);
          }
          
          setLoadingStage('Processing converted model...');
          setLoadingProgress(60);
          
          const result = await cadResponse.json();
          
          if (!result.success) {
            throw new Error(result.error || 'STEP processing failed');
          }
          
          setLoadingStage('Loading 3D model...');
          setLoadingProgress(80);
          
          // Handle STL data from your CAD engine
          if (result.stl_base64) {
            // Convert base64 STL directly to ArrayBuffer (bypass blob URLs for CSP)
            const stlData = atob(result.stl_base64);
            const stlArray = new Uint8Array(stlData.length);
            for (let i = 0; i < stlData.length; i++) {
              stlArray[i] = stlData.charCodeAt(i);
            }
            
            setLoadingProgress(90);
            
            // Parse STL directly from ArrayBuffer (no blob URLs needed)
            const loader = new STLLoader();
            try {
              const geometry = loader.parse(stlArray.buffer);
              clearTimeout(loadingTimeout);
              processGeometryAfterLoad(geometry);
            } catch (parseError) {
              clearTimeout(loadingTimeout);
              console.error('❌ Error parsing converted STL:', parseError);
              setLoadingError('Failed to parse converted 3D model');
              setIsLoading(false);
            }
            
          } else {
            throw new Error('No STL data received from CAD engine');
          }
          
        } catch (error) {
          clearTimeout(loadingTimeout);
          console.error('❌ Error processing STEP file:', error);
          setLoadingError(`Failed to process STEP file: ${error.message}`);
          setIsLoading(false);
        }
      };
      
      loadStepFile();
      return;
    } else {
      console.log('🔄 Loading STL file:', url);
      setIsLoading(true);
      setLoadingProgress(0);
      setLoadingError(null);
    }
    
    const loader = new STLLoader();
    
    // Add timeout handling for large files
    const loadingTimeout = setTimeout(() => {
      console.error('⏱️ STL loading timeout after 60 seconds');
      setLoadingError('Loading timeout - file may be too large or server unresponsive');
      setIsLoading(false);
    }, 60000); // 60 second timeout
    
    loader.load(
      url, 
      (loadedGeometry) => {
        clearTimeout(loadingTimeout);
        
        // Use the extracted common processing logic
        processGeometryAfterLoad(loadedGeometry);
    }, 
    (progress) => {
      if (progress.lengthComputable && progress.total > 0) {
        const progressPercent = (progress.loaded / progress.total * 100);
        setLoadingProgress(progressPercent);
        setLoadingStage(`Loading model... ${progressPercent.toFixed(0)}%`);
        
        // Industry standard: Show file size info for large models
        const sizeMB = progress.total / (1024 * 1024);
        if (sizeMB > 10) {
          console.log(`📥 Loading large model (${sizeMB.toFixed(1)}MB): ${progressPercent.toFixed(1)}%`);
        }
      } else {
        setLoadingStage('Processing model data...');
        setLoadingProgress(Math.min(90, loadingProgress + 5)); // Indeterminate progress
      }
    },
    (error) => {
      clearTimeout(loadingTimeout);
      setIsLoading(false);
      // Provide specific error messages based on error type
      let errorMessage = 'Failed to load 3D model';
      if (error.message) {
        if (error.message.includes('404')) {
          errorMessage = 'File not found - please check if the 3D model exists';
        } else if (error.message.includes('403')) {
          errorMessage = 'Access denied - insufficient permissions';
        } else if (error.message.includes('NetworkError') || error.message.includes('network')) {
          errorMessage = 'Network error - please check your connection';
        } else if (error.message.includes('CORS')) {
          errorMessage = 'Cross-origin request blocked - file source not accessible';
        } else if (error instanceof RangeError && error.message.includes('Array buffer allocation failed')) {
          errorMessage = 'File too large for browser memory. Please use a smaller or simplified model.';
        } else {
          errorMessage = `Loading failed: ${error.message}`;
        }
      }
      setLoadingError(errorMessage);
      console.error('❌ Error loading STL file:', error);
      console.log('Failed URL:', url);
      console.log('Error type:', error.type);
      console.log('Error message:', error.message);
      
      // Try to provide helpful error information
      if (error.message?.includes('404')) {
        console.error('💥 File not found (404) - Check if the STL file exists at:', url);
      } else if (error.message?.includes('network')) {
        console.error('🌐 Network error - Check your internet connection');
      } else if (error.message?.includes('CORS')) {
        console.error('🔒 CORS error - Server needs to allow cross-origin requests');
      }
    });
    
    // Cleanup function to clear timeout if component unmounts
    return () => {
      clearTimeout(loadingTimeout);
    };
  }, [url]); // CRITICAL FIX: Only depend on URL to prevent infinite loading

  useEffect(() => {
    if (geometry) {
      geometry.center();
      geometry.computeVertexNormals();

      // Calculate measurements
      const volume = calculateVolume(geometry);

      // Calculate bounding box dimensions
      geometry.computeBoundingBox();
      const bbox = geometry.boundingBox;
      const dimensions = {
        x: bbox ? bbox.max.x - bbox.min.x : 0,
        y: bbox ? bbox.max.y - bbox.min.y : 0,
        z: bbox ? bbox.max.z - bbox.min.z : 0,
      };

      // Calculate surface area
      const position = geometry.attributes.position;
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
        const edge1 = new THREE.Vector3().subVectors(v2, v1);
        const edge2 = new THREE.Vector3().subVectors(v3, v1);
        surfaceArea += new THREE.Vector3().crossVectors(edge1, edge2).length() / 2;
      }

      onMeasurements?.({ volume, dimensions, surfaceArea });
      onLoad?.();
    }
  }, [geometry, onLoad, onMeasurements]);

  useEffect(() => {
    if (meshRef.current) {
      const material = meshRef.current.material as THREE.Material;
      if (sectionPlane > 0) {
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), sectionPlane - 0.5);
        (meshRef.current.material as any).clippingPlanes = [plane];
        (meshRef.current.material as any).clipShadows = true;
      } else {
        (meshRef.current.material as any).clippingPlanes = [];
      }
      material.needsUpdate = true;
    }
  }, [sectionPlane]);

  useEffect(() => {
    return () => {
      if (meshRef.current) {
        const material = meshRef.current.material as THREE.Material;
        if (material) material.dispose();
      }
    };
  }, []);

  // Optimized explosion calculations - memoized to prevent recalculation on selection changes
  const explosionTargets = useMemo(() => {
    console.log('🧨 Explosion calculation:', {
      explodedPartsLength: explodedParts.length,
      isExploded,
      explodeDistance,
      partsAvailable: explodedParts.length > 0
    });
    
    if (!explodedParts.length) {
      console.warn('❌ No exploded parts available for explosion');
      return new Map();
    }
    
    const targets = new Map();
    const explosionDistance = (explodeDistance / 100) * 120;
    
    console.log('💥 Explosion distance multiplier:', explosionDistance);
    
    explodedParts.forEach((part, index) => {
      if (isExploded && explodeDistance > 0) {
        const explosionOffset = part.explosionDirection.clone().multiplyScalar(explosionDistance);
        targets.set(part.id, explosionOffset);
        console.log(`🎯 Part ${index + 1} (${part.id}) explosion target:`, {
          direction: part.explosionDirection,
          distance: explosionDistance,
          offset: explosionOffset,
          offsetMagnitude: explosionOffset.length()
        });
      } else {
        targets.set(part.id, new THREE.Vector3(0, 0, 0));
        console.log(`🏠 Part ${index + 1} (${part.id}) returning to origin`);
      }
    });
    return targets;
  }, [isExploded, explodeDistance, explodedParts.length]); // Only recalculate when these actually change

  // Update exploded parts target positions (optimized)
  useEffect(() => {
    if (!explodedParts.length) return;
    
    explodedParts.forEach(part => {
      const targetPos = explosionTargets.get(part.id);
      if (targetPos) {
        part.targetPosition.copy(targetPos);
        // Initialize current position if not set (critical fix for initial render)
        if (part.currentPosition.length() === 0) {
          part.currentPosition.copy(targetPos);
          console.log(`🎯 Initialized current position for part ${part.id}:`, part.currentPosition);
        }
      }
    });
  }, [explosionTargets, explodedParts]);

  // Optimized animation - only run when there are parts and they need animation
  useFrame(() => {
    if (!explodedParts.length) return;
    
    // Animate each part independently with minimal computation
    explodedParts.forEach((part, index) => {
      const distance = part.currentPosition.distanceTo(part.targetPosition);
      if (distance > 0.01) { // Only animate if parts are not at target position
        part.currentPosition.lerp(part.targetPosition, 0.08);
        if (index === 0 && Math.random() < 0.01) { // Log occasionally for first part only
          console.log(`🎬 Animating part ${part.id}: distance=${distance.toFixed(3)}, current=${part.currentPosition.toArray().map(n => n.toFixed(2))}, target=${part.targetPosition.toArray().map(n => n.toFixed(2))}`);
        }
      }
    });
  });

  // Detect active DFM types for the legend
  const activeTypes = (manufacturingFeatures || [])
    .map(f => f.type)
    .filter((t, i, arr) => arr.indexOf(t) === i)
    .filter(t => t in DFM_COLORS) as DFMType[];

  // Show loading state
  if (isLoading) {
    return (
      <group>
        <Html position={[0, 0, 0]} center>
          <div className="bg-background/80 backdrop-blur p-4 rounded-lg border">
            <div className="flex flex-col items-center gap-3">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent animate-spin rounded-full"></div>
              <div className="text-sm font-medium">Loading 3D Model</div>
              <div className="text-xs text-muted-foreground">
                {loadingStage || (loadingProgress > 0 ? `${loadingProgress.toFixed(1)}%` : 'Preparing...')}
              </div>
              {/* Industry standard progress bar */}
              <div className="w-48 h-1.5 bg-muted rounded-full overflow-hidden">
                <div 
                  className="h-full bg-primary transition-all duration-500 ease-out"
                  style={{ width: `${Math.max(2, Math.min(100, loadingProgress))}%` }}
                />
              </div>
              {previewReady && !detailsReady && (
                <div className="text-xs text-yellow-400">
                  Preview ready • Loading details...
                </div>
              )}
            </div>
          </div>
        </Html>
      </group>
    );
  }

  // Show error state
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

  if (!geometry) {
    console.log('❌ No geometry available for rendering');
    return null;
  }

  console.log('🎨 Rendering 3D component:', {
    hasGeometry: !!geometry,
    isExploded,
    explodedPartsCount: explodedParts.length,
    renderingMode: explodedParts.length > 0 && isExploded ? 'exploded' : 'normal',
    geometryFaces: geometry.attributes.position ? geometry.attributes.position.count / 3 : 0
  });

  return (
    <group ref={groupRef}>
      {/* Always show the original geometry as primary model, then optionally add exploded parts */}
      {geometry && (
        <mesh
          ref={meshRef}
          geometry={geometry}
          castShadow
          receiveShadow
          visible={!isExploded || explodedParts.length === 0} // Hide when exploded view is active and we have parts
          onClick={(event) => {
            console.log('Base mesh clicked:', event);
            // Don't stop propagation here to allow DFM mesh to handle it
          }}
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
      
      {/* DFM face-color highlight overlay (only in normal view) */}
      {showFeatures && manufacturingFeatures && manufacturingFeatures.length > 0 && !isExploded && (
        <DFMColorMesh
          geometry={geometry}
          features={manufacturingFeatures}
          selectedFeatureType={selectedFeature?.type ?? null}
          onFaceClick={(type, worldPosition) => {
            const f = manufacturingFeatures.find(mf => mf.type === type);
            const isNewSelection = !selectedFeature || f?.id !== selectedFeature.id;
            
            console.log('Face clicked:', type, f, worldPosition);
            
            if (isNewSelection && f) {
              onFeatureSelect?.(f);
            } else {
              // Clicking on the same feature again deselects it
              onFeatureSelect?.(null);
            }
          }}
        />
      )}
      
      {/* Render exploded parts if available and exploded mode is active */}
      {explodedParts.length > 0 && isExploded ? (
        // Exploded Parts View - Show individual parts when exploded  
        explodedParts.map((part, index) => {
          console.log(`🎯 Rendering exploded part ${part.id}:`, {
            hasGeometry: !!part.geometry,
            hasPosition: !!part.geometry?.attributes?.position,
            faceCount: part.geometry?.attributes?.position?.count ? part.geometry.attributes.position.count / 3 : 0
          });
          // Use the part's actual ID to avoid index mismatches
          const partId = part.id;
          const isSelected = selectedBOMItems && selectedBOMItems.some(item => item.id === partId);
          const isHovered = hoveredBOMItem && hoveredBOMItem.id === partId;
          
          // Calculate highlighting colors and visibility
          const shouldHighlight = isSelected || isHovered;
          const highlightColor = isSelected ? '#00ff88' : isHovered ? '#ffaa00' : color;
          const highlightOpacity = isSelected ? 0.9 : isHovered ? 0.8 : 0.9;
          const isVisible = showOnlySelected ? isSelected : true;
          
          // Debug logging for part visibility
          if (showOnlySelected) {
            console.log(`Part ${partId}: isSelected=${isSelected}, isVisible=${isVisible}, selectedCount=${selectedBOMItems?.length || 0}`);
          }
          
          if (!isVisible) return null;
          
          // Skip parts with invalid geometry
          if (!part.geometry || !part.geometry.attributes.position || part.geometry.attributes.position.count === 0) {
            console.warn(`⚠️ Skipping part ${part.id} - invalid geometry`);
            return null;
          }
          
          return (
            <group key={part.id} position={part.currentPosition}>
            <mesh
              geometry={part.geometry}
              castShadow
              receiveShadow
              onClick={(event) => {
                event.stopPropagation();
                console.log('🎯 Part selected:', part.id, {
                  faceCount: part.geometry.attributes.position.count / 3,
                  volume: calculateVolume(part.geometry),
                  material: showFeatures ? '#8899aa' : shouldHighlight ? highlightColor : color
                });
                
                // Trigger parent callback for BOM integration
                if (stableOnPartsDetected.current) {
                  const selectedPartData = [{
                    id: part.id,
                    name: `Selected Component`,
                    geometry: part.geometry,
                    partNumber: part.id.toUpperCase(),
                    material: 'Selected',
                    quantity: 1,
                    faceCount: part.geometry.attributes.position.count / 3,
                    volume: calculateVolume(part.geometry),
                    selected: true,
                    timestamp: Date.now()
                  }];
                  // Note: Only notify about selection events, not all parts
                  console.log('🎯 Notifying parent of part selection:', selectedPartData[0].name);
                }
              }}
              onPointerOver={(event) => {
                event.stopPropagation();
                document.body.style.cursor = 'pointer';
                console.log('🔍 Part hovered:', part.id);
              }}
              onPointerOut={(event) => {
                event.stopPropagation();
                document.body.style.cursor = 'default';
              }}
            >
              <meshStandardMaterial
                color={showFeatures ? '#8899aa' : shouldHighlight ? highlightColor : color}
                metalness={shouldHighlight ? 0.4 : 0.2}
                roughness={shouldHighlight ? 0.3 : 0.45}
                side={THREE.DoubleSide}
                transparent={isTransparent || !!showFeatures || shouldHighlight}
                opacity={isTransparent ? 0.4 : showFeatures ? 0.25 : highlightOpacity}
                wireframe={isWireframe}
                emissive={shouldHighlight ? new THREE.Color(highlightColor).multiplyScalar(0.1) : new THREE.Color(0x000000)}
              />
            </mesh>
            
            {/* Add outline for selected parts */}
            {shouldHighlight && (
              <mesh
                geometry={part.geometry}
                scale={1.005}
              >
                <meshBasicMaterial
                  color={highlightColor}
                  side={THREE.BackSide}
                  transparent={true}
                  opacity={0.3}
                />
              </mesh>
            )}
            
          </group>
          );
        })
      ) : null}

      {/* DFM Legend — anchored as HTML overlay */}
      {showFeatures && activeTypes.length > 0 && !isExploded && (
        <DFMLegend activeTypes={activeTypes} />
      )}
      
    </group>
  );
}


// Camera Controller
function CameraController({
  viewPosition,
  autoFit
}: {
  viewPosition: [number, number, number];
  autoFit: boolean;
}) {
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

// 3D Scene
function Scene({
  fileUrl,
  modelColor,
  showGrid,
  viewPosition,
  autoFit,
  onFit,
  onModelLoad,
  isAnimating,
  sectionPlane,
  isTransparent,
  isWireframe,
  isExploded,
  explodeDistance,
  onMeasurements,
  onOrientationChange,
  manufacturingFeatures,
  selectedFeature,
  onFeatureSelect,
  showFeatures,
  selectedBOMItems,
  showOnlySelected,
  hoveredBOMItem,
  onPartsDetected
}: {
  fileUrl: string;
  modelColor: string;
  showGrid: boolean;
  viewPosition: [number, number, number];
  autoFit: boolean;
  onFit: (distance: number) => void;
  onModelLoad: () => void;
  isAnimating: boolean;
  sectionPlane: number;
  isTransparent: boolean;
  isWireframe: boolean;
  isExploded?: boolean;
  explodeDistance?: number;
  onMeasurements?: (data: {
    volume: number;
    dimensions: { x: number; y: number; z: number };
    surfaceArea: number;
  }) => void;
  onOrientationChange: (matrix: THREE.Matrix4) => void;
  manufacturingFeatures?: ManufacturingFeature[];
  selectedFeature?: ManufacturingFeature | null;
  onFeatureSelect?: (feature: ManufacturingFeature | null) => void;
  showFeatures?: boolean;
  selectedBOMItems?: any[];
  showOnlySelected?: boolean;
  hoveredBOMItem?: any;
  onPartsDetected?: (parts: any[]) => void;
}) {
  return (
    <>
      <PerspectiveCamera makeDefault position={viewPosition} fov={50} />
      <CameraController viewPosition={viewPosition} autoFit={autoFit} />
      {autoFit && <CameraFitter onFit={onFit} resetKey={fileUrl} />}
      <AutoRotate isAnimating={isAnimating} />
      <AxesOrientation onOrientationChange={onOrientationChange} />

      {/* Lighting */}
      <ambientLight intensity={0.6} />
      <directionalLight
        position={[10, 10, 5]}
        intensity={1.2}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-50}
        shadow-camera-right={50}
        shadow-camera-top={50}
        shadow-camera-bottom={-50}
        shadow-camera-near={0.1}
        shadow-camera-far={200}
        shadow-bias={-0.0001}
        shadow-normalBias={0.02}
      />
      <directionalLight position={[-10, -10, -5]} intensity={0.4} />
      <hemisphereLight args={['#ffffff', '#444444', 0.6]} />

      {/* Environment preset removed to prevent loading errors - using manual lights instead */}
      {/* <Environment preset="studio" /> */}

      {/* Grid */}
      {showGrid && (
        <Grid
          args={[20, 20]}
          cellSize={0.5}
          cellThickness={0.5}
          cellColor="#888888"
          sectionSize={2}
          sectionThickness={1}
          sectionColor="#3b82f6"
          fadeDistance={30}
          infiniteGrid
        />
      )}

      {/* Model */}
      <Suspense fallback={null}>
        <Center>
          <STLModel
            url={fileUrl}
            color={modelColor}
            sectionPlane={sectionPlane}
            isTransparent={isTransparent}
            isWireframe={isWireframe}
            isExploded={isExploded}
            explodeDistance={explodeDistance}
            onLoad={onModelLoad}
            onMeasurements={onMeasurements}
            manufacturingFeatures={manufacturingFeatures}
            selectedFeature={selectedFeature}
            onFeatureSelect={onFeatureSelect}
            showFeatures={showFeatures}
            selectedBOMItems={selectedBOMItems}
            showOnlySelected={showOnlySelected}
            hoveredBOMItem={hoveredBOMItem}
            onPartsDetected={onPartsDetected}
          />
        </Center>
      </Suspense>

      {/* Controls */}
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.05}
        minDistance={0.1}
        maxDistance={1000}
        enabled={!isAnimating}
        enablePan={true}
        enableRotate={true}
        enableZoom={true}
        screenSpacePanning={false}
        panSpeed={2}
        rotateSpeed={0.8}
        zoomSpeed={1.2}
        mouseButtons={{
          LEFT: THREE.MOUSE.ROTATE,   // Rotate
          MIDDLE: THREE.MOUSE.DOLLY,  // Zoom  
          RIGHT: THREE.MOUSE.PAN      // Pan
        }}
        touches={{
          ONE: THREE.TOUCH.ROTATE,    // Rotate
          TWO: THREE.TOUCH.DOLLY_PAN  // Zoom/Pan
        }}
      />
    </>
  );
}

export const EDrawingsViewer = React.memo(function EDrawingsViewer({ 
  fileUrl, 
  fileName, 
  isExploded = false,
  explodeDistance = 50,
  onMeasurements,
  manufacturingFeatures,
  selectedFeature,
  onFeatureSelect,
  showFeatures,
  selectedBOMItems,
  showOnlySelected = false,
  hoveredBOMItem,
  onPartsDetected,
  dfmAnalysisData
}: EDrawingsViewerProps) {
  const [loading, setLoading] = useState(true);
  const [modelColor, setModelColor] = useState('#3b82f6');
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
  
  // Internal exploded view state management
  const [internalIsExploded, setInternalIsExploded] = useState(isExploded);
  const [internalExplodeDistance, setInternalExplodeDistance] = useState(explodeDistance);

  // Sync with props when they change
  useEffect(() => {
    setInternalIsExploded(isExploded);
  }, [isExploded]);

  useEffect(() => {
    setInternalExplodeDistance(explodeDistance);
  }, [explodeDistance]);
  const [measurements, setMeasurements] = useState<{
    volume: number;
    dimensions: { x: number; y: number; z: number };
    surfaceArea: number;
  } | null>(null);

  // Internal feature state with defaults
  const [internalShowFeatures, setInternalShowFeatures] = useState(showFeatures ?? false);
  const features = manufacturingFeatures ?? [];
  const currentSelectedFeature = selectedFeature ?? null;
  
  // BOM highlighting state
  const [highlightedParts, setHighlightedParts] = useState<Set<string>>(new Set());
  const [selectedParts, setSelectedParts] = useState<Set<string>>(new Set());

  // Sync internal state with props
  useEffect(() => {
    if (showFeatures !== undefined) {
      setInternalShowFeatures(showFeatures);
    }
  }, [showFeatures]);

  // Handle BOM item selection
  useEffect(() => {
    if (selectedBOMItems && selectedBOMItems.length > 0) {
      setSelectedParts(new Set(selectedBOMItems.map(item => item.id)));
      console.log('Selected BOM items for 3D highlighting:', selectedBOMItems.map(item => item.name).join(', '));
    } else {
      setSelectedParts(new Set());
    }
  }, [selectedBOMItems]);

  // Handle BOM item hover highlighting
  useEffect(() => {
    if (hoveredBOMItem) {
      setHighlightedParts(new Set([hoveredBOMItem.id]));
      console.log('Hovering BOM item for 3D highlighting:', hoveredBOMItem.name);
    } else {
      setHighlightedParts(new Set());
    }
  }, [hoveredBOMItem]);

  // Reusable Vector3 instances to avoid GC pressure from frame callbacks
  const tempVectors = useRef({
    x: new THREE.Vector3(),
    y: new THREE.Vector3(),
    z: new THREE.Vector3(),
  });

  // Store WebGL cleanup function
  const webglCleanupRef = useRef<(() => void) | null>(null);

  // Cleanup WebGL context on unmount
  useEffect(() => {
    return () => {
      if (webglCleanupRef.current) {
        webglCleanupRef.current();
      }
    };
  }, []);

  const CAD_VIEWS = getCADViews(cameraDistance);

  const handleMeasurements = useCallback((data: {
    volume: number;
    dimensions: { x: number; y: number; z: number };
    surfaceArea: number;
  }) => {
    setMeasurements(data);
    onMeasurements?.(data);
  }, [onMeasurements]);

  const handleModelLoad = useCallback(() => {
    setLoading(false);
  }, []);

  const handleOrientationChange = useCallback((matrix: THREE.Matrix4) => {
    // Extract axis directions from camera view matrix using reusable vectors
    const { x: xAxis, y: yAxis, z: zAxis } = tempVectors.current;
    xAxis.set(1, 0, 0).applyMatrix4(matrix).normalize();
    yAxis.set(0, 1, 0).applyMatrix4(matrix).normalize();
    zAxis.set(0, 0, 1).applyMatrix4(matrix).normalize();

    // Project to 2D screen space (simplified orthographic projection)
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
    if (viewConfig) {
      setViewPosition(viewConfig.position);
      setAutoFit(false);
    }
  };

  const handleResetView = () => {
    setAutoFit(true);
    setCurrentView('home');
    setSectionPlane(0);
    setShowCrossSection(false);
  };

  const handleFitToScreen = () => {
    setAutoFit(true);
    setCurrentView('home');
  };

  const toggleAnimation = () => {
    setIsAnimating(!isAnimating);
  };

  const toggleTransparent = () => {
    setIsTransparent(!isTransparent);
  };

  const toggleWireframe = () => {
    setIsWireframe(!isWireframe);
  };
  
  const toggleCrossSection = () => {
    const newValue = !showCrossSection;
    setShowCrossSection(newValue);
    if (newValue) {
      setSectionPlane(0.5); // Default to middle position
    } else {
      setSectionPlane(0); // Turn off section plane
    }
  };

  return (
    <div className="h-full w-full flex flex-col bg-[#2d2d2d]">
      {/* Top Toolbar - eDrawings Style - Single Row */}
      <div className="bg-[#3f3f3f] border-b border-[#555555] px-3 py-1.5">
        <div className="flex items-center justify-between">
          {/* Left Section - View Controls */}
          <div className="flex items-center gap-2">
            {/* View Mode Toggles */}
            <Button
              variant="outline"
              size="sm"
              onClick={toggleTransparent}
              className={`gap-1.5 font-medium text-xs ${isTransparent
                ? 'bg-green-600 hover:bg-green-700 text-white border-green-700'
                : 'bg-[#505050] hover:bg-[#606060] text-white border-[#666666]'
                }`}
            >
              <Eye className="h-3.5 w-3.5" />
              Transparent
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={toggleWireframe}
              className={`gap-1.5 font-medium text-xs ${isWireframe
                ? 'bg-green-600 hover:bg-green-700 text-white border-green-700'
                : 'bg-[#505050] hover:bg-[#606060] text-white border-[#666666]'
                }`}
            >
              <Square className="h-3.5 w-3.5" />
              Wireframe
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={toggleCrossSection}
              className={`gap-1.5 font-medium text-xs ${showCrossSection
                ? 'bg-green-600 hover:bg-green-700 text-white border-green-700'
                : 'bg-[#505050] hover:bg-[#606060] text-white border-[#666666]'
                }`}
            >
              <Slice className="h-3.5 w-3.5" />
              Cross Section
            </Button>

            {/* DFM Features Toggle */}
            {features.length > 0 && (
              <>
                <Separator orientation="vertical" className="h-6 bg-[#555555]" />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setInternalShowFeatures(!internalShowFeatures)}
                  className={`gap-1.5 font-medium text-xs ${internalShowFeatures
                    ? 'bg-blue-600 hover:bg-blue-700 text-white border-blue-700'
                    : 'bg-[#505050] hover:bg-[#606060] text-white border-[#666666]'
                    }`}
                >
                  <Target className="h-3.5 w-3.5" />
                  DFM Features ({features.length})
                </Button>
              </>
            )}

            <Separator orientation="vertical" className="h-6 bg-[#555555]" />

            <Button
              variant="ghost"
              size="sm"
              onClick={handleResetView}
              className="text-white hover:bg-[#505050] gap-2"
              title="Reset View"
            >
              <Home className="h-4 w-4" />
              <span className="hidden md:inline">Home</span>
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={handleFitToScreen}
              className="text-white hover:bg-[#505050] gap-2"
              title="Fit to Screen"
            >
              <Maximize className="h-4 w-4" />
              <span className="hidden md:inline">Fit</span>
            </Button>

            <Separator orientation="vertical" className="h-6 bg-[#555555]" />

            {/* Standard Views */}
            <Select value={currentView} onValueChange={handleViewChange}>
              <SelectTrigger className="w-[140px] bg-[#505050] border-[#666666] text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#3f3f3f] border-[#666666]">
                <SelectItem value="home" className="text-white">Home</SelectItem>
                <SelectItem value="front" className="text-white">Front</SelectItem>
                <SelectItem value="back" className="text-white">Back</SelectItem>
                <SelectItem value="top" className="text-white">Top</SelectItem>
                <SelectItem value="bottom" className="text-white">Bottom</SelectItem>
                <SelectItem value="right" className="text-white">Right</SelectItem>
                <SelectItem value="left" className="text-white">Left</SelectItem>
                <SelectItem value="isometric" className="text-white">Isometric</SelectItem>
              </SelectContent>
            </Select>

            <Separator orientation="vertical" className="h-6 bg-[#555555]" />

            {/* Display Options */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowGrid(!showGrid)}
              className={`text-white hover:bg-[#505050] ${showGrid ? 'bg-[#505050]' : ''}`}
              title="Toggle Grid"
            >
              <Grid3x3 className="h-4 w-4" />
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={toggleAnimation}
              className={`text-white hover:bg-[#505050] ${isAnimating ? 'bg-[#505050]' : ''}`}
              title="Animate Rotation"
            >
              {isAnimating ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
          </div>

          {/* Right Section */}
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowSidebar(!showSidebar)}
              className={`text-white hover:bg-[#505050] ${showSidebar ? 'bg-[#505050]' : ''}`}
              title={showSidebar ? 'Hide Properties Panel' : 'Show Properties Panel'}
            >
              {showSidebar ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
            </Button>

            <Separator orientation="vertical" className="h-6 bg-[#555555]" />

            <Button
              variant="ghost"
              size="sm"
              className="text-white hover:bg-[#505050]"
              asChild
            >
              <a href={fileUrl} download>
                <Download className="h-4 w-4" />
              </a>
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
              antialias: true,
              alpha: true,
              powerPreference: 'high-performance',
              localClippingEnabled: true,
              preserveDrawingBuffer: false,
              failIfMajorPerformanceCaveat: false,
            }}
            onCreated={(state) => {
              // Handle context loss
              const canvas = state.gl.domElement;
              
              const handleContextLost = (event: Event) => {
                
                event.preventDefault();
                setLoading(true);
              };
              
              const handleContextRestored = () => {
                
                setLoading(false);
              };
              
              canvas.addEventListener('webglcontextlost', handleContextLost);
              canvas.addEventListener('webglcontextrestored', handleContextRestored);
              
              // Store cleanup function
              const cleanup = () => {
                canvas.removeEventListener('webglcontextlost', handleContextLost);
                canvas.removeEventListener('webglcontextrestored', handleContextRestored);
              };
              
              // Store cleanup function in ref for component unmount
              webglCleanupRef.current = cleanup;
              
              setLoading(false);
            }}
          >
            <Scene
              fileUrl={fileUrl}
              modelColor={modelColor}
              showGrid={showGrid}
              viewPosition={viewPosition}
              autoFit={autoFit}
              onFit={handleFit}
              onModelLoad={handleModelLoad}
              isAnimating={isAnimating}
              sectionPlane={sectionPlane}
              isTransparent={isTransparent}
              isWireframe={isWireframe}
              isExploded={isExploded}
              explodeDistance={explodeDistance}
              onMeasurements={handleMeasurements}
              onOrientationChange={handleOrientationChange}
              manufacturingFeatures={features}
              selectedFeature={currentSelectedFeature}
              onFeatureSelect={onFeatureSelect}
              showFeatures={internalShowFeatures}
              selectedBOMItems={selectedBOMItems}
              showOnlySelected={showOnlySelected}
              hoveredBOMItem={hoveredBOMItem}
              onPartsDetected={onPartsDetected}
            />
          </Canvas>

          {/* Loading */}
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#2d2d2d]">
              <div className="text-center text-white">
                <Loader2 className="h-12 w-12 mx-auto mb-3 animate-spin" />
                <p className="text-sm font-medium">Loading 3D model...</p>
                <p className="text-xs text-gray-400 mt-1">Calculating optimal view...</p>
              </div>
            </div>
          )}

          {/* XYZ Axes Indicator - Dynamic */}
          <div className="absolute bottom-20 left-4 bg-[#3f3f3f]/90 backdrop-blur-sm border border-[#555555] rounded-lg p-3">
            <svg width="80" height="80" viewBox="0 0 80 80">
              {/* X Axis - Red */}
              <g>
                <line
                  x1="40"
                  y1="40"
                  x2={40 + Math.cos(axesRotation.x) * 30}
                  y2={40 - Math.sin(axesRotation.x) * 30}
                  stroke="#ef4444"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
                <polygon
                  points={`${40 + Math.cos(axesRotation.x) * 30},${40 - Math.sin(axesRotation.x) * 30} ${40 + Math.cos(axesRotation.x) * 25 - Math.sin(axesRotation.x) * 3},${40 - Math.sin(axesRotation.x) * 25 - Math.cos(axesRotation.x) * 3} ${40 + Math.cos(axesRotation.x) * 25 + Math.sin(axesRotation.x) * 3},${40 - Math.sin(axesRotation.x) * 25 + Math.cos(axesRotation.x) * 3}`}
                  fill="#ef4444"
                />
                <text
                  x={40 + Math.cos(axesRotation.x) * 35}
                  y={40 - Math.sin(axesRotation.x) * 35 + 4}
                  fill="#ef4444"
                  fontSize="12"
                  fontWeight="bold"
                  textAnchor="middle"
                >
                  X
                </text>
              </g>
              {/* Y Axis - Green */}
              <g>
                <line
                  x1="40"
                  y1="40"
                  x2={40 + Math.cos(axesRotation.y) * 30}
                  y2={40 - Math.sin(axesRotation.y) * 30}
                  stroke="#22c55e"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
                <polygon
                  points={`${40 + Math.cos(axesRotation.y) * 30},${40 - Math.sin(axesRotation.y) * 30} ${40 + Math.cos(axesRotation.y) * 25 - Math.sin(axesRotation.y) * 3},${40 - Math.sin(axesRotation.y) * 25 - Math.cos(axesRotation.y) * 3} ${40 + Math.cos(axesRotation.y) * 25 + Math.sin(axesRotation.y) * 3},${40 - Math.sin(axesRotation.y) * 25 + Math.cos(axesRotation.y) * 3}`}
                  fill="#22c55e"
                />
                <text
                  x={40 + Math.cos(axesRotation.y) * 35}
                  y={40 - Math.sin(axesRotation.y) * 35 + 4}
                  fill="#22c55e"
                  fontSize="12"
                  fontWeight="bold"
                  textAnchor="middle"
                >
                  Y
                </text>
              </g>
              {/* Z Axis - Blue */}
              <g>
                <line
                  x1="40"
                  y1="40"
                  x2={40 + Math.cos(axesRotation.z) * 30}
                  y2={40 - Math.sin(axesRotation.z) * 30}
                  stroke="#3b82f6"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
                <polygon
                  points={`${40 + Math.cos(axesRotation.z) * 30},${40 - Math.sin(axesRotation.z) * 30} ${40 + Math.cos(axesRotation.z) * 25 - Math.sin(axesRotation.z) * 3},${40 - Math.sin(axesRotation.z) * 25 - Math.cos(axesRotation.z) * 3} ${40 + Math.cos(axesRotation.z) * 25 + Math.sin(axesRotation.z) * 3},${40 - Math.sin(axesRotation.z) * 25 + Math.cos(axesRotation.z) * 3}`}
                  fill="#3b82f6"
                />
                <text
                  x={40 + Math.cos(axesRotation.z) * 35}
                  y={40 - Math.sin(axesRotation.z) * 35 + 4}
                  fill="#3b82f6"
                  fontSize="12"
                  fontWeight="bold"
                  textAnchor="middle"
                >
                  Z
                </text>
              </g>
              {/* Center origin */}
              <circle cx="40" cy="40" r="3" fill="#ffffff" stroke="#555555" strokeWidth="1.5" />
            </svg>
          </div>

          {/* File Info */}
          <div className="absolute top-4 left-4 bg-[#3f3f3f]/90 backdrop-blur-sm border border-[#555555] rounded-lg px-2 py-1">
            <p className="text-[10px] text-white font-medium">{fileName}</p>
          </div>
        </div>

        {/* Right Panel - Properties & Controls - Toggleable */}
        <div
          className={`flex-shrink-0 w-64 bg-[#3f3f3f] border-l border-[#555555] flex flex-col max-h-screen transition-transform duration-300 ease-in-out ${showSidebar ? 'translate-x-0' : 'translate-x-full'
            }`}
        >
          <div className="px-1.5 py-1 border-b border-[#555555]">
            <h3 className="text-[9px] font-semibold text-white">Properties</h3>
            <p className="text-[7px] text-gray-400">Model controls and information</p>
          </div>

          <div className="flex-1 overflow-y-auto overflow-x-hidden p-0.5 space-y-0.5 scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-gray-800 scroll-smooth">
            {/* Part Details - Dimensions & Volume */}
            {measurements && (
              <Card className="bg-[#505050] border-[#666666]">
                <div className="p-1 space-y-0.5">
                  <h4 className="text-[9px] font-semibold text-white flex items-center gap-0.5">
                    <Box className="h-2.5 w-2.5" />
                    Part Details
                  </h4>
                  <div className="space-y-0.5 text-[8px]">
                    {/* Dimensions */}
                    <div>
                      <span className="text-gray-400 font-medium">Dimensions</span>
                      <div className="bg-[#3f3f3f] rounded px-1 py-0.5 font-mono text-white text-[9px] mt-0.5">
                        {measurements.dimensions.x.toFixed(1)} × {measurements.dimensions.y.toFixed(1)} × {measurements.dimensions.z.toFixed(1)} mm
                      </div>
                    </div>

                    {/* Volume */}
                    <div className="flex items-center justify-between">
                      <span className="text-gray-400">Volume</span>
                      <span className="text-white font-mono text-[10px]">{measurements.volume.toFixed(2)} mm³</span>
                    </div>

                    {/* Surface Area */}
                    <div className="flex items-center justify-between">
                      <span className="text-gray-400">Surface</span>
                      <span className="text-white font-mono text-[10px]">{measurements.surfaceArea.toFixed(2)} mm²</span>
                    </div>
                  </div>
                </div>
              </Card>
            )}

            {/* DFM Insights Panel - Shows detailed analysis for selected feature */}
            {currentSelectedFeature && (
              <Card className="bg-[#505050] border-[#666666]">
                <div className="p-1">
                  <h4 className="text-[9px] font-semibold text-white flex items-center gap-0.5 mb-0.5">
                    <Box className="h-2.5 w-2.5" />
                    DFM Analysis
                    <span className="ml-auto text-[8px] text-gray-400 font-normal">
                      {currentSelectedFeature.type.replace('_', ' ')}
                    </span>
                  </h4>

                  <div className="space-y-1 text-[8px]">
                    {/* Feature type and process */}
                    <div>
                      <span className="text-gray-400 font-medium">Process:</span>
                      <div className="text-white mt-0.5">
                        {currentSelectedFeature.manufacturingProcess}
                      </div>
                    </div>

                    {/* Dimensions if available */}
                    {Object.keys(currentSelectedFeature.dimensions).length > 0 && (
                      <div>
                        <span className="text-gray-400 font-medium">Dimensions:</span>
                        <div className="text-white mt-0.5 space-y-0.5">
                          {Object.entries(currentSelectedFeature.dimensions)
                            .filter(([_, value]) => value)
                            .map(([key, value]) => (
                              <div key={key} className="flex justify-between">
                                <span className="text-gray-400 capitalize">{key}:</span>
                                <span>{value}mm</span>
                              </div>
                            ))}
                        </div>
                      </div>
                    )}

                    {/* Cycle time */}
                    <div className="flex justify-between">
                      <span className="text-gray-400">Cycle Time:</span>
                      <span className="text-white">{currentSelectedFeature.cycleTime}min</span>
                    </div>

                    {/* Warnings */}
                    {currentSelectedFeature.warnings.length > 0 && (
                      <div>
                        <span className="text-amber-400 font-medium flex items-center gap-1">
                          <AlertTriangle className="h-2 w-2" />
                          Warnings:
                        </span>
                        <div className="mt-1 space-y-1">
                          {currentSelectedFeature.warnings.map((warning, index) => (
                            <div key={index} className="text-amber-400 text-[8px] leading-tight">
                              • {warning}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* AI Recommendations */}
                    {currentSelectedFeature.aiRecommendations.length > 0 && (
                      <div>
                        <span className="text-green-400 font-medium">Recommendations:</span>
                        <div className="mt-1 space-y-1">
                          {currentSelectedFeature.aiRecommendations.map((rec, index) => (
                            <div key={index} className="text-green-400 text-[8px] leading-tight">
                              • {rec}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Required tooling */}
                    {currentSelectedFeature.tooling.length > 0 && (
                      <div>
                        <span className="text-purple-400 font-medium">Required Tools:</span>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {currentSelectedFeature.tooling.map((tool, index) => (
                            <span key={index} className="bg-purple-900/30 text-purple-300 px-1 py-0.5 rounded text-[7px]">
                              {tool}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            )}


            {/* DFM Feature List in sidebar */}
            {features.length > 0 && (
              <Card className="bg-[#505050] border-[#666666]">
                <div className="p-1">
                  <h4 className="text-[9px] font-semibold text-white flex items-center gap-0.5 mb-0.5">
                    <Target className="h-2.5 w-2.5" />
                    DFM Features
                    <span className="ml-auto text-[8px] text-gray-400 font-normal">click to highlight</span>
                  </h4>

                  {/* Color legend */}
                  <div className="flex flex-wrap gap-0.5 mb-1">
                    {(['hole','pocket','thin_wall','undercut'] as const).map(t => (
                      <span key={t} className="flex items-center gap-0.5 text-[7px] text-gray-300">
                        <span className="inline-block w-1.5 h-1.5 rounded-full" style={{
                          background: t === 'hole' ? '#FF6B6B' : t === 'pocket' ? '#4ECDC4' : t === 'thin_wall' ? '#FFA07A' : '#D63031'
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
                      const isSelected = currentSelectedFeature?.id === feature.id;
                      return (
                        <button
                          key={feature.id}
                          onClick={() => onFeatureSelect?.(
                            isSelected ? null : feature
                          )}
                          className={`w-full text-left p-0.5 rounded border transition-all ${
                            isSelected
                              ? 'border-blue-400 bg-blue-900/30'
                              : 'border-[#666666] bg-[#3f3f3f] hover:bg-[#484848]'
                          }`}
                        >
                          <div className="flex items-center gap-1 mb-0.5">
                            <Crosshair
                              className="h-2.5 w-2.5 flex-shrink-0"
                              style={{ color: featureColor }}
                            />
                            <span
                              className="text-[9px] font-semibold truncate"
                              style={{ color: featureColor }}
                            >
                              {feature.type.replace('_', ' ').toUpperCase()}
                            </span>
                          </div>
                          <div className="text-[8px] text-gray-300 truncate mb-0.5">
                            {feature.manufacturingProcess}
                          </div>
                          <div className="flex items-center gap-2 text-[7px] text-gray-400">
                            <span className="flex items-center gap-0.5">
                              <Clock className="h-1.5 w-1.5" />
                              {feature.cycleTime}min
                            </span>
                          </div>
                          {feature.warnings.length > 0 && (
                            <div className="flex items-start gap-0.5 mt-0.5">
                              <AlertTriangle className="h-2 w-2 text-amber-400 flex-shrink-0 mt-px" />
                              <span className="text-[7px] text-amber-400 leading-tight">
                                {feature.warnings[0]}
                              </span>
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </Card>
            )}

            {/* Assembly DFM Analysis Results */}
            {dfmAnalysisData && (
              <>
                <Card className="bg-[#505050] border-[#666666]">
                  <div className="p-1 space-y-0.5">
                    <h4 className="text-[9px] font-semibold text-white flex items-center gap-0.5">
                      <Target className="h-2.5 w-2.5" />
                      Assembly DFM Analysis
                    </h4>
                    
                    {/* Manufacturability Score */}
                    {dfmAnalysisData.dfmAnalysis?.manufacturabilityScore && (
                      <div className="bg-[#3f3f3f] rounded px-1 py-0.5">
                        <div className="text-[7px] text-gray-400">Manufacturability Score</div>
                        <div className="text-[9px] font-bold text-green-400">
                          {Math.round(dfmAnalysisData.dfmAnalysis.manufacturabilityScore * 100)}%
                        </div>
                      </div>
                    )}
                    
                    {/* Recommended Processes */}
                    {dfmAnalysisData.dfmAnalysis?.recommendedProcesses?.length > 0 && (
                      <div className="bg-[#3f3f3f] rounded px-1 py-0.5">
                        <div className="text-[7px] text-gray-400 mb-0.5">Recommended Processes</div>
                        <div className="space-y-0.5">
                          {dfmAnalysisData.dfmAnalysis.recommendedProcesses.slice(0, 3).map((process: string, index: number) => (
                            <div key={index} className="text-[8px] text-blue-300 flex items-center gap-1">
                              <span className="w-1 h-1 bg-blue-400 rounded-full flex-shrink-0"></span>
                              {process}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {/* Warnings */}
                    {dfmAnalysisData.dfmAnalysis?.warnings?.length > 0 && (
                      <div className="bg-amber-900/20 border border-amber-600/30 rounded px-1 py-0.5">
                        <div className="text-[7px] text-amber-400 mb-0.5 flex items-center gap-0.5">
                          <AlertTriangle className="h-2 w-2" />
                          Warnings
                        </div>
                        <div className="space-y-0.5">
                          {dfmAnalysisData.dfmAnalysis.warnings.slice(0, 2).map((warning: any, index: number) => (
                            <div key={index} className="text-[7px] text-amber-300 leading-tight">
                              {typeof warning === 'string' ? warning : warning.message || 'Manufacturing consideration'}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {/* Geometry Info */}
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
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

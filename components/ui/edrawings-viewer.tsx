'use client';

import { Suspense, useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Grid, Center, Html } from '@react-three/drei';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import * as THREE from 'three';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Card } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
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
  onMeasurements?: (data: {
    volume: number;
    dimensions: { x: number; y: number; z: number };
    surfaceArea: number;
  }) => void;
  manufacturingFeatures?: ManufacturingFeature[];
  selectedFeature?: ManufacturingFeature | null;
  onFeatureSelect?: (feature: ManufacturingFeature | null) => void;
  showFeatures?: boolean;
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

// STL Model with section plane and measurements
function STLModel({
  url,
  color,
  sectionPlane,
  isTransparent,
  isWireframe,
  onLoad,
  onMeasurements,
  manufacturingFeatures,
  selectedFeature,
  onFeatureSelect,
  showFeatures
}: {
  url: string;
  color: string;
  sectionPlane: number;
  isTransparent: boolean;
  isWireframe: boolean;
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
}) {
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  const meshRef = useRef<THREE.Mesh>(null);


  useEffect(() => {
    const loader = new STLLoader();
    loader.load(url, (loadedGeometry) => {
      setGeometry(loadedGeometry);
    });
  }, [url]);

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

  if (!geometry) return null;

  // Detect active DFM types for the legend
  const activeTypes = (manufacturingFeatures || [])
    .map(f => f.type)
    .filter((t, i, arr) => arr.indexOf(t) === i)
    .filter(t => t in DFM_COLORS) as DFMType[];

  return (
    <group>
      {/* Base model — semi-transparent when DFM overlay is active */}
      <mesh 
        ref={meshRef} 
        geometry={geometry} 
        castShadow 
        receiveShadow
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

      {/* DFM face-color highlight overlay */}
      {showFeatures && manufacturingFeatures && manufacturingFeatures.length > 0 && (
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
              // Deselect if clicking same feature
              console.log('Deselecting feature');
              onFeatureSelect?.(null);
            }
          }}
        />
      )}



      {/* DFM Legend — anchored as HTML overlay */}
      {showFeatures && activeTypes.length > 0 && (
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
  onMeasurements,
  onOrientationChange,
  manufacturingFeatures,
  selectedFeature,
  onFeatureSelect,
  showFeatures
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
            onLoad={onModelLoad}
            onMeasurements={onMeasurements}
            manufacturingFeatures={manufacturingFeatures}
            selectedFeature={selectedFeature}
            onFeatureSelect={onFeatureSelect}
            showFeatures={showFeatures}
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
      />
    </>
  );
}

export function EDrawingsViewer({ 
  fileUrl, 
  fileName, 
  onMeasurements,
  manufacturingFeatures,
  selectedFeature,
  onFeatureSelect,
  showFeatures
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
  const [measurements, setMeasurements] = useState<{
    volume: number;
    dimensions: { x: number; y: number; z: number };
    surfaceArea: number;
  } | null>(null);

  // Internal feature state with defaults
  const [internalShowFeatures, setInternalShowFeatures] = useState(showFeatures ?? false);
  const features = manufacturingFeatures ?? [];
  const currentSelectedFeature = selectedFeature ?? null;

  // Sync internal state with props
  useEffect(() => {
    if (showFeatures !== undefined) {
      setInternalShowFeatures(showFeatures);
    }
  }, [showFeatures]);

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
              onMeasurements={handleMeasurements}
              onOrientationChange={handleOrientationChange}
              manufacturingFeatures={features}
              selectedFeature={currentSelectedFeature}
              onFeatureSelect={onFeatureSelect}
              showFeatures={internalShowFeatures}
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
          <div className="absolute top-4 left-4 bg-[#3f3f3f]/90 backdrop-blur-sm border border-[#555555] rounded-lg px-3 py-1.5">
            <p className="text-xs text-white font-medium">{fileName}</p>
          </div>
        </div>

        {/* Right Panel - Properties & Controls - Toggleable */}
        <div
          className={`flex-shrink-0 w-64 bg-[#3f3f3f] border-l border-[#555555] flex flex-col max-h-screen transition-transform duration-300 ease-in-out ${showSidebar ? 'translate-x-0' : 'translate-x-full'
            }`}
        >
          <div className="px-2 py-1.5 border-b border-[#555555]">
            <h3 className="text-[11px] font-semibold text-white">Properties</h3>
            <p className="text-[9px] text-gray-400">Model controls and information</p>
          </div>

          <div className="flex-1 overflow-y-auto overflow-x-hidden p-1.5 space-y-1.5 scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-gray-800 scroll-smooth">
            {/* Part Details - Dimensions & Volume */}
            {measurements && (
              <Card className="bg-[#505050] border-[#666666]">
                <div className="p-1.5 space-y-1">
                  <h4 className="text-[10px] font-semibold text-white flex items-center gap-1">
                    <Box className="h-2.5 w-2.5" />
                    Part Details
                  </h4>
                  <div className="space-y-1 text-[9px]">
                    {/* Dimensions */}
                    <div>
                      <span className="text-gray-400 font-medium">Dimensions</span>
                      <div className="bg-[#3f3f3f] rounded px-1 py-0.5 font-mono text-white text-[10px] mt-0.5">
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


            {/* Display Settings */}
            <Card className="bg-[#505050] border-[#666666]">
              <div className="p-1.5">
                <h4 className="text-[10px] font-semibold text-white flex items-center gap-1 mb-1">
                  <Eye className="h-2.5 w-2.5" />
                  Display
                </h4>
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-[9px] text-gray-300">Color</label>
                    <input
                      type="color"
                      value={modelColor}
                      onChange={(e) => setModelColor(e.target.value)}
                      className="h-4 w-8 rounded border border-[#666666] cursor-pointer"
                      disabled={isWireframe}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <label className="text-[9px] text-gray-300">Grid</label>
                    <input
                      type="checkbox"
                      checked={showGrid}
                      onChange={(e) => setShowGrid(e.target.checked)}
                      className="h-3 w-3 rounded"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <label className="text-[9px] text-gray-300">Transparent</label>
                    <input
                      type="checkbox"
                      checked={isTransparent}
                      onChange={(e) => setIsTransparent(e.target.checked)}
                      className="h-3 w-3 rounded"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <label className="text-[9px] text-gray-300">Wireframe</label>
                    <input
                      type="checkbox"
                      checked={isWireframe}
                      onChange={(e) => setIsWireframe(e.target.checked)}
                      className="h-3 w-3 rounded"
                    />
                  </div>
                </div>
              </div>
            </Card>

            {/* DFM Feature List in sidebar */}
            {features.length > 0 && (
              <Card className="bg-[#505050] border-[#666666]">
                <div className="p-1.5">
                  <h4 className="text-[10px] font-semibold text-white flex items-center gap-1 mb-1">
                    <Target className="h-2.5 w-2.5" />
                    DFM Features
                    <span className="ml-auto text-[8px] text-gray-400 font-normal">click to highlight</span>
                  </h4>

                  {/* Color legend */}
                  <div className="flex flex-wrap gap-1 mb-1.5">
                    {(['hole','pocket','thin_wall','undercut'] as const).map(t => (
                      <span key={t} className="flex items-center gap-0.5 text-[7px] text-gray-300">
                        <span className="inline-block w-2 h-2 rounded-full" style={{
                          background: t === 'hole' ? '#FF6B6B' : t === 'pocket' ? '#4ECDC4' : t === 'thin_wall' ? '#FFA07A' : '#D63031'
                        }} />
                        {t.replace('_',' ')}
                      </span>
                    ))}
                  </div>

                  <div className="space-y-1 max-h-60 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-500 scrollbar-track-gray-700 pr-1">
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
                          className={`w-full text-left p-1.5 rounded border transition-all ${
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

            {/* DFM Insights Panel - Shows detailed analysis for selected feature */}
            {currentSelectedFeature && (
              <Card className="bg-[#505050] border-[#666666]">
                <div className="p-1.5">
                  <h4 className="text-[10px] font-semibold text-white flex items-center gap-1 mb-1">
                    <Box className="h-2.5 w-2.5" />
                    DFM Analysis
                    <span className="ml-auto text-[8px] text-gray-400 font-normal">
                      {currentSelectedFeature.type.replace('_', ' ')}
                    </span>
                  </h4>

                  <div className="space-y-2 text-[9px]">
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
          </div>
        </div>
      </div>
    </div>
  );
}

'use client';

import { Suspense, useState, useRef, useEffect, useCallback } from 'react';
import { Canvas, useLoader, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Grid, Center } from '@react-three/drei';
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
} from 'lucide-react';

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

// STL Model with section plane and measurements
function STLModel({
  url,
  color,
  sectionPlane,
  isTransparent,
  isWireframe,
  onLoad,
  onMeasurements
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

        const edge1 = new THREE.Vector3().subVectors(v2, v1);
        const edge2 = new THREE.Vector3().subVectors(v3, v1);
        const cross = new THREE.Vector3().crossVectors(edge1, edge2);
        surfaceArea += cross.length() / 2;
      }

      onMeasurements?.({ volume, dimensions, surfaceArea });
      onLoad?.();
    }
  }, [geometry, onLoad, onMeasurements]);

  useEffect(() => {
    if (meshRef.current) {
      const material = meshRef.current.material as THREE.Material;

      if (sectionPlane > 0) {
        // Create clipping plane
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), sectionPlane - 0.5);
        (meshRef.current.material as any).clippingPlanes = [plane];
        (meshRef.current.material as any).clipShadows = true;
      } else {
        (meshRef.current.material as any).clippingPlanes = [];
      }

      material.needsUpdate = true;
    }
  }, [sectionPlane]);

  // Cleanup geometry and materials on unmount
  useEffect(() => {
    return () => {
      if (meshRef.current) {
        const material = meshRef.current.material as THREE.Material;
        if (material) {
          material.dispose();
        }
      }
      // Note: geometry is handled by useLoader and will be disposed automatically
    };
  }, []);

  if (!geometry) {
    return null; // Loading state handled by Suspense wrapper
  }

  return (
    <mesh ref={meshRef} geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial
        color={color}
        metalness={0.2}
        roughness={0.4}
        side={THREE.DoubleSide}
        transparent={isTransparent}
        opacity={isTransparent ? 0.5 : 1}
        wireframe={isWireframe}
      />
    </mesh>
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
  onOrientationChange
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

export function EDrawingsViewer({ fileUrl, fileName, onMeasurements }: EDrawingsViewerProps) {
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
              const gl = state.gl.getContext();
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

          <div className="flex-1 overflow-y-auto p-1.5 space-y-1.5">
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

            {/* Section View Control */}
            <Card className="bg-[#505050] border-[#666666]">
              <div className="p-1.5">
                <h4 className="text-[10px] font-semibold text-white flex items-center gap-1 mb-1">
                  <Slice className="h-2.5 w-2.5" />
                  Section View
                </h4>
                <div className="space-y-0.5">
                  <div className="flex items-center justify-between text-[9px]">
                    <span className="text-gray-300">Position</span>
                    <span className="text-white font-medium">{Math.round(sectionPlane * 100)}%</span>
                  </div>
                  <Slider
                    value={[sectionPlane]}
                    onValueChange={(v) => {
                      const newValue = v[0] ?? 0;
                      setSectionPlane(newValue);
                      setShowCrossSection(newValue > 0);
                    }}
                    max={1}
                    step={0.01}
                    className="w-full"
                    disabled={!showCrossSection}
                  />
                  <p className="text-[8px] text-gray-400 leading-tight">
                    {!showCrossSection ? 'Enable to use' : sectionPlane === 0 ? 'Slide to cut' : 'Active'}
                  </p>
                </div>
              </div>
            </Card>

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

          </div>
        </div>
      </div>
    </div>
  );
}

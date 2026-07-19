'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import * as THREE from 'three';

// Screen-space bounding box (pixel coordinates relative to the Canvas top-left)
interface ScreenBBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

// ── Inner scene (runs inside <Canvas>) ────────────────────────────────────────

function ModelScene({
  geometry,
  onBBox,
}: {
  geometry: THREE.BufferGeometry;
  onBBox: (b: ScreenBBox) => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null!);
  const { camera, size } = useThree();
  // phase: 'fit' → set zoom; 'project' → compute screen bbox; 'done' → stop
  const phase = useRef<'fit' | 'project' | 'done'>('fit');

  useFrame(() => {
    if (!meshRef.current) return;

    if (phase.current === 'fit') {
      geometry.computeBoundingBox();
      const bbox = geometry.boundingBox!;
      const s3 = new THREE.Vector3();
      bbox.getSize(s3);

      if (camera instanceof THREE.OrthographicCamera) {
        // Correct aspect-aware zoom: scale so the larger axis fills 80% of its canvas dimension
        const zoomX = s3.x > 0 ? (size.width  * 0.80) / s3.x : Infinity;
        const zoomY = s3.y > 0 ? (size.height * 0.80) / s3.y : Infinity;
        camera.zoom = Math.min(zoomX, zoomY);
        camera.updateProjectionMatrix();
      }
      phase.current = 'project';
      return;
    }

    if (phase.current === 'project') {
      geometry.computeBoundingBox();
      const bbox = geometry.boundingBox!;

      // 8 corners of the bounding box
      const corners = [
        [bbox.min.x, bbox.min.y, bbox.min.z],
        [bbox.max.x, bbox.min.y, bbox.min.z],
        [bbox.min.x, bbox.max.y, bbox.min.z],
        [bbox.max.x, bbox.max.y, bbox.min.z],
        [bbox.min.x, bbox.min.y, bbox.max.z],
        [bbox.max.x, bbox.min.y, bbox.max.z],
        [bbox.min.x, bbox.max.y, bbox.max.z],
        [bbox.max.x, bbox.max.y, bbox.max.z],
      ].map(([x, y, z]) => new THREE.Vector3(x, y, z));

      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;

      for (const c of corners) {
        const world = c.clone().applyMatrix4(meshRef.current.matrixWorld);
        const ndc = world.project(camera);
        const sx = ((ndc.x + 1) / 2) * size.width;
        const sy = ((-ndc.y + 1) / 2) * size.height;
        if (sx < minX) minX = sx;
        if (sx > maxX) maxX = sx;
        if (sy < minY) minY = sy;
        if (sy > maxY) maxY = sy;
      }

      phase.current = 'done';
      onBBox({ minX, maxX, minY, maxY });
    }
  });

  return (
    <group>
      {/* Main solid — steel blue with metallic shading */}
      <mesh ref={meshRef} geometry={geometry}>
        <meshStandardMaterial color="#2e6db4" roughness={0.3} metalness={0.55} />
      </mesh>
      {/* Wire-frame overlay for crisp engineering outline */}
      <mesh geometry={geometry}>
        <meshBasicMaterial color="#7ab8f5" wireframe transparent opacity={0.08} />
      </mesh>
    </group>
  );
}

// ── SVG dimension overlay ──────────────────────────────────────────────────────

function DimOverlay({
  bbox,
  canvasW,
  canvasH,
  maxLength,
  maxWidth,
  maxHeight,
}: {
  bbox: ScreenBBox;
  canvasW: number;
  canvasH: number;
  maxLength?: number | null;
  maxWidth?: number | null;
  maxHeight?: number | null;
}) {
  const L = maxLength ?? 0;
  const W = maxWidth ?? 0;
  const D = maxHeight ?? 0;

  const extGap = 4;
  const arrOff = 14;

  const arrowY = bbox.maxY + extGap + arrOff;
  const arrowX = bbox.maxX + extGap + arrOff;

  const svgW = canvasW + 80;
  const svgH = canvasH + 42;

  return (
    <svg
      width={svgW}
      height={svgH}
      style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', overflow: 'visible' }}
    >
      <defs>
        <marker id="pdv-e" markerWidth="6" markerHeight="5" refX="5" refY="2.5" orient="auto">
          <polygon points="0,0 6,2.5 0,5" fill="#6b7280" />
        </marker>
        <marker id="pdv-s" markerWidth="6" markerHeight="5" refX="1" refY="2.5" orient="auto-start-reverse">
          <polygon points="0,0 6,2.5 0,5" fill="#6b7280" />
        </marker>
      </defs>

      {/* Extension lines — left & right edges of bbox to horizontal arrow */}
      <line x1={bbox.minX} y1={bbox.maxY + extGap} x2={bbox.minX} y2={arrowY + 5} stroke="#374151" strokeWidth="0.6" />
      <line x1={bbox.maxX} y1={bbox.maxY + extGap} x2={bbox.maxX} y2={arrowY + 5} stroke="#374151" strokeWidth="0.6" />

      {/* Width arrow (horizontal below model) */}
      {L > 0 && (
        <>
          <line
            x1={bbox.minX} y1={arrowY}
            x2={bbox.maxX} y2={arrowY}
            stroke="#6b7280" strokeWidth="0.9"
            markerStart="url(#pdv-s)" markerEnd="url(#pdv-e)"
          />
          <text
            x={(bbox.minX + bbox.maxX) / 2} y={arrowY + 13}
            textAnchor="middle" fontSize="9.5" fill="#e5e7eb"
            fontFamily="ui-monospace, monospace"
          >
            {L.toFixed(2)} mm
          </text>
        </>
      )}

      {/* Extension lines — top & bottom edges of bbox to vertical arrow */}
      <line x1={bbox.maxX + extGap} y1={bbox.minY} x2={arrowX + 5} y2={bbox.minY} stroke="#374151" strokeWidth="0.6" />
      <line x1={bbox.maxX + extGap} y1={bbox.maxY} x2={arrowX + 5} y2={bbox.maxY} stroke="#374151" strokeWidth="0.6" />

      {/* Height arrow (vertical right of model) */}
      {W > 0 && (
        <>
          <line
            x1={arrowX} y1={bbox.minY}
            x2={arrowX} y2={bbox.maxY}
            stroke="#6b7280" strokeWidth="0.9"
            markerStart="url(#pdv-s)" markerEnd="url(#pdv-e)"
          />
          <text
            x={arrowX + 7} y={(bbox.minY + bbox.maxY) / 2}
            textAnchor="start" dominantBaseline="middle"
            fontSize="9.5" fill="#e5e7eb"
            fontFamily="ui-monospace, monospace"
          >
            {W.toFixed(2)} mm
          </text>
        </>
      )}

      {/* Depth label — above top-right corner of bbox */}
      {D > 0 && (
        <text
          x={bbox.maxX} y={bbox.minY - 5}
          textAnchor="end" fontSize="8" fill="#6b7280"
          fontFamily="ui-monospace, monospace"
        >
          D: {D.toFixed(2)} mm
        </text>
      )}
    </svg>
  );
}

// ── Public component ───────────────────────────────────────────────────────────

interface PartDimensionViewerProps {
  fileUrl: string;
  maxLength?: number | null;
  maxWidth?: number | null;
  maxHeight?: number | null;
  canvasWidth?: number;
  canvasHeight?: number;
}

const DEFAULT_W = 210;
const DEFAULT_H = 158;

export function PartDimensionViewer({
  fileUrl, maxLength, maxWidth, maxHeight,
  canvasWidth = DEFAULT_W, canvasHeight = DEFAULT_H,
}: PartDimensionViewerProps) {
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  const [screenBBox, setScreenBBox] = useState<ScreenBBox | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    setGeometry(null);
    setScreenBBox(null);
    setLoadError(false);

    const loader = new STLLoader();
    loader.loadAsync(fileUrl)
      .then((geo) => {
        // Centre the geometry at origin
        geo.computeBoundingBox();
        const center = new THREE.Vector3();
        geo.boundingBox!.getCenter(center);
        geo.translate(-center.x, -center.y, -center.z);

        // Find the thin dimension (thickness/depth direction) and orient so it faces
        // along Z — the camera at [0,0,5000] will then see the largest face naturally.
        geo.computeBoundingBox();
        const s3 = new THREE.Vector3();
        geo.boundingBox!.getSize(s3);

        if (s3.y < s3.x && s3.y < s3.z) {
          geo.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
        } else if (s3.x < s3.y && s3.x < s3.z) {
          geo.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.PI / 2));
        }

        setGeometry(geo);
      })
      .catch(() => setLoadError(true));

    return () => { /* STLLoader has no abort; stale responses ignored via state check */ };
  }, [fileUrl]);

  const handleBBox = useCallback((b: ScreenBBox) => setScreenBBox(b), []);

  if (loadError) {
    return (
      <div
        style={{ width: canvasWidth, height: canvasHeight }}
        className="flex items-center justify-center text-[10px] text-muted-foreground"
      >
        Unable to load 3D model
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', width: canvasWidth, height: canvasHeight }}>
      {geometry && (
        <Canvas
          orthographic
          camera={{ position: [0, 0, 5000], near: 0.1, far: 100000, zoom: 1 }}
          style={{ width: canvasWidth, height: canvasHeight, background: '#0d1520' }}
          gl={{ antialias: true, alpha: false }}
        >
          <ambientLight intensity={0.6} />
          <directionalLight position={[5, 8, 10]} intensity={1.1} />
          <directionalLight position={[-4, -3, -6]} intensity={0.35} />
          <directionalLight position={[0, -6, 4]} intensity={0.2} />
          <ModelScene geometry={geometry} onBBox={handleBBox} />
        </Canvas>
      )}

      {!geometry && (
        <div
          style={{ width: canvasWidth, height: canvasHeight, background: '#0d1520' }}
          className="animate-pulse flex items-center justify-center"
        >
          <span className="text-[10px] text-muted-foreground">Loading model…</span>
        </div>
      )}

      {screenBBox && (
        <DimOverlay
          bbox={screenBBox}
          canvasW={canvasWidth}
          canvasH={canvasHeight}
          {...(maxLength != null ? { maxLength } : {})}
          {...(maxWidth  != null ? { maxWidth  } : {})}
          {...(maxHeight != null ? { maxHeight } : {})}
        />
      )}
    </div>
  );
}

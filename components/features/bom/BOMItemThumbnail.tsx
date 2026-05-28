'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { Box } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { apiClient } from '@/lib/api/client';
import { BOMItem } from '@/lib/api/hooks/useBOMItems';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';

// ---------------------------------------------------------------------------
// Module-level thumbnail cache — persists across remounts for the page session
// ---------------------------------------------------------------------------

const thumbnailCache = new Map<string, string>(); // item.id → dataUrl

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Phase = 'idle' | 'fetching' | 'rendering' | 'done' | 'error';
type FileCategory = 'stl' | 'obj' | 'step' | 'image' | 'pdf' | 'unknown';

export interface BOMItemThumbnailProps {
  item: BOMItem;
  onClick: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function classifyFile(path: string | undefined): FileCategory {
  if (!path) return 'unknown';
  const base = path.split('?')[0] ?? '';
  const ext = (base.split('.').pop() ?? '').toLowerCase();
  if (ext === 'stl') return 'stl';
  if (ext === 'obj') return 'obj';
  if (ext === 'step' || ext === 'stp' || ext === 'iges' || ext === 'igs') return 'step';
  if (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'webp') return 'image';
  if (ext === 'pdf') return 'pdf';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Off-screen STL capture — private inner component
// ---------------------------------------------------------------------------

interface STLCaptureProps {
  url: string;
  onCapture: (dataUrl: string) => void;
  onError: () => void;
}

function STLScene({ url, onCapture, onError }: STLCaptureProps) {
  const { camera, scene, invalidate } = useThree();
  const capturedRef = useRef(false);
  const readyRef = useRef(false);
  const meshRef = useRef<THREE.Mesh | null>(null);
  const onCaptureRef = useRef(onCapture);
  const onErrorRef = useRef(onError);
  onCaptureRef.current = onCapture;
  onErrorRef.current = onError;

  useEffect(() => {
    let cancelled = false;
    const loader = new STLLoader();
    loader.load(
      url,
      (geometry) => {
        if (cancelled) { geometry.dispose(); return; }

        geometry.computeBoundingBox();
        geometry.computeVertexNormals();
        geometry.computeBoundingSphere();

        const box = geometry.boundingBox!;
        const center = new THREE.Vector3();
        const size = new THREE.Vector3();
        box.getCenter(center);
        box.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z);

        // Guard against empty or corrupt geometry (NaN positions)
        if (!isFinite(maxDim) || maxDim <= 0 || !isFinite(geometry.boundingSphere?.radius ?? NaN)) {
          geometry.dispose();
          onErrorRef.current();
          return;
        }

        const mesh = new THREE.Mesh(
          geometry,
          new THREE.MeshStandardMaterial({
            color: 0x8899aa,
            metalness: 0.2,
            roughness: 0.4,
            side: THREE.DoubleSide,
          })
        );
        mesh.position.sub(center);
        scene.add(mesh);
        meshRef.current = mesh;

        const cam = camera as THREE.PerspectiveCamera;
        const fovRad = cam.fov * (Math.PI / 180);
        const dist = (maxDim / 2) / Math.tan(fovRad / 2) * 1.3;
        cam.position.set(dist * 0.7, dist * 0.45, dist);
        cam.near = maxDim * 0.001;
        cam.far = maxDim * 100;
        cam.lookAt(0, 0, 0);
        cam.updateProjectionMatrix();

        scene.background = new THREE.Color(0x1c1c1c);
        readyRef.current = true;
        invalidate();
      },
      undefined,
      () => { if (!cancelled) onErrorRef.current(); }
    );
    return () => {
      cancelled = true;
      if (meshRef.current) {
        scene.remove(meshRef.current);
        meshRef.current.geometry.dispose();
        (meshRef.current.material as THREE.Material).dispose();
        meshRef.current = null;
      }
      scene.background = null;
      readyRef.current = false;
      capturedRef.current = false;
    };
  }, [url, scene, camera, invalidate]);

  useFrame(({ gl, scene, camera }) => {
    if (capturedRef.current || !readyRef.current) return;
    capturedRef.current = true;
    try {
      // useFrame runs before R3F's implicit render — call explicitly so the
      // canvas has the model on it when we screenshot it.
      gl.render(scene, camera);
      const dataUrl = gl.domElement.toDataURL('image/jpeg', 0.92);
      onCaptureRef.current(dataUrl);
    } catch {
      onErrorRef.current();
    }
  });

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[10, 10, 5]} intensity={1.2} />
      <directionalLight position={[-10, -10, -5]} intensity={0.4} />
      <hemisphereLight args={['#ffffff', '#444444', 0.6]} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function BOMItemThumbnail({ item, onClick }: BOMItemThumbnailProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cached = thumbnailCache.get(item.id) ?? null;
  const [phase, setPhase] = useState<Phase>(cached ? 'done' : 'idle');
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [dataUrl, setDataUrl] = useState<string | null>(cached);

  const fileCategory = item.file3dPath
    ? classifyFile(item.file3dPath)
    : classifyFile(item.file2dPath ?? undefined);

  const is3d = !!item.file3dPath;
  const resolvedCategory = useRef<FileCategory>(fileCategory);

  // Lazy trigger via IntersectionObserver — skip if already cached
  useEffect(() => {
    if (phase !== 'idle') return;
    if (!containerRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && phase === 'idle') {
          setPhase('fetching');
        }
      },
      { rootMargin: '100px', threshold: 0.1 }
    );
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [phase]);

  // Fetch signed URL when entering 'fetching'
  useEffect(() => {
    if (phase !== 'fetching') return;
    const controller = new AbortController();

    const endpoint = is3d
      ? `/bom-items/${item.id}/file-url/3d`
      : `/bom-items/${item.id}/file-url/2d`;

    apiClient
      .get<{ url: string }>(endpoint, { signal: controller.signal, silent: true })
      .then((result) => {
        if (!result) {
          setPhase('error');
          return;
        }
        const url = result.url;
        // Re-check actual extension — backend may convert STEP→STL
        const actualCategory = classifyFile(url.split('?')[0]);
        resolvedCategory.current = actualCategory === 'unknown' ? fileCategory : actualCategory;

        setFileUrl(url);
        if (is3d && (resolvedCategory.current === 'stl' || resolvedCategory.current === 'obj')) {
          setPhase('rendering');
        } else {
          setPhase('done');
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setPhase('error');
      });

    return () => controller.abort();
  }, [phase, item.id, is3d, fileCategory]);

  const handleCapture = useCallback((url: string) => {
    thumbnailCache.set(item.id, url);
    setDataUrl(url);
    setPhase('done');
  }, [item.id]);

  const handleCaptureError = useCallback(() => {
    setPhase('error');
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative flex-shrink-0 w-[120px] h-[90px] rounded-md overflow-hidden cursor-pointer group"
      onClick={onClick}
    >
      {/* Skeleton during load */}
      {(phase === 'idle' || phase === 'fetching' || phase === 'rendering') && (
        <Skeleton className="w-full h-full rounded-md" />
      )}

      {/* Off-screen WebGL capture */}
      {phase === 'rendering' && fileUrl && (
        <div className="absolute inset-0 opacity-0 pointer-events-none overflow-hidden">
          <Canvas
            gl={{ preserveDrawingBuffer: true, antialias: true, alpha: false, powerPreference: 'low-power' }}
            dpr={2}
            frameloop="demand"
            style={{ width: 120, height: 90 }}
          >
            <STLScene url={fileUrl} onCapture={handleCapture} onError={handleCaptureError} />
          </Canvas>
        </div>
      )}

      {/* Captured 3D image */}
      {phase === 'done' && dataUrl && (
        <img
          src={dataUrl}
          alt={item.name}
          className="w-full h-full object-cover rounded-md border border-border/40 group-hover:ring-2 group-hover:ring-primary/50 transition-all"
        />
      )}

      {/* 2D image */}
      {phase === 'done' && !dataUrl && fileUrl && resolvedCategory.current === 'image' && (
        <img
          src={fileUrl}
          alt={item.name}
          className="w-full h-full object-cover rounded-md border border-border/40 group-hover:ring-2 group-hover:ring-primary/50 transition-all"
        />
      )}

      {/* Fallback for non-previewable files (STEP, IGES, PDF, etc.) */}
      {phase === 'done' && !dataUrl && resolvedCategory.current !== 'image' && (
        <div className="w-full h-full flex flex-col items-center justify-center gap-1 bg-muted/60 rounded-md border border-border/40 group-hover:ring-2 group-hover:ring-primary/50 transition-all">
          <Box className="h-7 w-7 text-primary/50" />
          <span className="text-[9px] font-mono uppercase text-muted-foreground">
            {resolvedCategory.current === 'step' ? 'STEP'
              : resolvedCategory.current === 'obj' ? 'OBJ'
              : resolvedCategory.current === 'pdf' ? 'PDF'
              : '3D'}
          </span>
        </div>
      )}

      {/* Error state */}
      {phase === 'error' && (
        <div className="w-full h-full flex items-center justify-center bg-muted rounded-md border border-border/40">
          <Box className="h-8 w-8 text-muted-foreground" />
        </div>
      )}

      {/* 3D badge */}
      {phase === 'done' && is3d && (
        <Badge className="absolute bottom-1 right-1 h-4 px-1 text-[9px] bg-primary/80 text-primary-foreground pointer-events-none">
          3D
        </Badge>
      )}
    </div>
  );
}

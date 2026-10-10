'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Crosshair, Home, Loader2, Square, SquareDashed } from 'lucide-react';
import * as THREE from 'three';

import { BodyEdges, SetupAxisArrows } from '@/components/viewer/body-overlays';
import { fitCameraToBox, type Box3Like } from '@/lib/geometry/camera-fit';
import type { FaceMapEntry } from '@/lib/types/manufacturing';
import {
  boundaryEdges, boundsOf, buildFaceIndex, subsetPositions, trianglesOfFaces, type Bounds,
} from '@/lib/viewer/highlight-geometry';
import { storageKey, type LoadedMesh } from '@/lib/viewer/geometry-store';
import { viewerGeometryStore } from '@/lib/viewer/viewer-store';

const BODY_COLOR = '#9b9bb4';
const FEATURE_COLOR = '#e11ddd';
const BOX_COLOR = '#d4b000';

interface CadFeatureViewerProps {
  fileUrl: string;
  faceMap: FaceMapEntry[] | null;
  /** Faces the measured value was taken from (OCC ordinals, indices into faceMap). */
  faceIds: number[];
  /** Real setup-axis directions to draw, when the engine proved any. */
  axes?: Array<[number, number, number]>;
}

type Mode = 'face' | 'edge';
type Focus = { on: 'part' | 'feature'; nonce: number };

/** The part, loaded once through the shared store, with only the measured faces highlighted. */
export function CadFeatureViewer({ fileUrl, faceMap, faceIds, axes = [] }: CadFeatureViewerProps) {
  const { mesh, error } = useMesh(fileUrl);
  const [mode, setMode] = useState<Mode>('face');
  const [focus, setFocus] = useState<Focus>({ on: 'part', nonce: 0 });

  const selection = useMemo(() => {
    if (!mesh || !faceMap) return null;
    const triangles = trianglesOfFaces(buildFaceIndex(faceMap, mesh.triTotal), faceIds);
    if (triangles.length === 0) return null;
    return {
      positions: subsetPositions(mesh.positions, triangles),
      edges: boundaryEdges(mesh.positions, triangles),
      bounds: boundsOf(mesh.positions, triangles),
    };
  }, [mesh, faceMap, faceIds]);

  const partBounds = useMemo(() => {
    if (!mesh) return null;
    const all = new Int32Array(mesh.triTotal).map((_, i) => i);
    return boundsOf(mesh.positions, all);
  }, [mesh]);

  const focusBounds = focus.on === 'feature' && selection?.bounds ? selection.bounds : partBounds;

  return (
    <div className="relative h-full w-full bg-gradient-to-b from-[#e6f0e7] to-[#b4d2b7]">
      <div className="absolute left-2 top-2 z-10 flex items-center gap-1 rounded border border-[#c4cfc6] bg-[#f3f6f3]/95 p-1 shadow-sm">
        <ToolButton title="Home — fit the whole part" onClick={() => { setFocus((f) => ({ on: 'part', nonce: f.nonce + 1 })); }}>
          <Home className="h-4 w-4" />
        </ToolButton>
        <ToolButton title="Zoom to the highlighted feature" disabled={!selection} onClick={() => { setFocus((f) => ({ on: 'feature', nonce: f.nonce + 1 })); }}>
          <Crosshair className="h-4 w-4" />
        </ToolButton>
        <span className="mx-0.5 h-5 w-px bg-[#c4cfc6]" />
        <ToolButton title="Face — fill the measured faces" active={mode === 'face'} onClick={() => { setMode('face'); }}>
          <Square className="h-4 w-4" />
        </ToolButton>
        <ToolButton title="Edge — outline the measured faces" active={mode === 'edge'} onClick={() => { setMode('edge'); }}>
          <SquareDashed className="h-4 w-4" />
        </ToolButton>
      </div>

      {!mesh && !error && <Status text="Loading 3D model…" spinner />}
      {error && <Status text={error} />}
      {mesh && !selection && <Status text="No CAD faces recorded for this value — re-analyse the part" corner />}

      {mesh && (
        <Canvas dpr={[1, 2]} camera={{ fov: 45 }} gl={{ antialias: true, alpha: true }}>
          <ambientLight intensity={0.7} />
          <directionalLight position={[10, 10, 5]} intensity={1.1} />
          <directionalLight position={[-10, -10, -5]} intensity={0.4} />
          <Scene mesh={mesh} selection={selection} mode={mode} axes={axes} />
          <CameraRig bounds={focusBounds} nonce={focus.nonce} />
          <OrbitControls makeDefault enableDamping />
        </Canvas>
      )}
    </div>
  );
}

function ToolButton({ children, title, onClick, active, disabled }: {
  children: React.ReactNode; title: string; onClick: () => void; active?: boolean; disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={`rounded p-1.5 text-[#1f2d3a] disabled:opacity-40 ${active ? 'bg-[#cfe0d1]' : 'hover:bg-[#dfe8e0]'}`}
    >
      {children}
    </button>
  );
}

function Status({ text, corner, spinner }: { text: string; corner?: boolean; spinner?: boolean }) {
  return (
    <div className={`absolute z-10 text-xs text-[#1f2d3a] ${corner ? 'bottom-2 left-2 rounded bg-white/80 px-2 py-1' : 'inset-0 flex items-center justify-center gap-2'}`} role={spinner ? 'status' : undefined}>
      {spinner && <Loader2 className="h-4 w-4 animate-spin" />}
      {text}
    </div>
  );
}

/** Holds one reference to the part's mesh for as long as the viewer is mounted. */
function useMesh(fileUrl: string): { mesh: LoadedMesh | null; error: string | null } {
  const [state, setState] = useState<{ mesh: LoadedMesh | null; error: string | null }>({ mesh: null, error: null });
  const urlRef = useRef(fileUrl);
  urlRef.current = fileUrl;
  const key = storageKey(fileUrl); // a refreshed signed URL is the same part: do not reload

  useEffect(() => {
    let cancelled = false;
    let release: (() => void) | undefined;
    setState({ mesh: null, error: null });
    viewerGeometryStore.acquire(urlRef.current).then(
      (handle) => {
        if (cancelled) { handle.release(); return; }
        release = handle.release;
        setState({ mesh: handle.mesh, error: null });
      },
      (e: unknown) => { if (!cancelled) setState({ mesh: null, error: e instanceof Error ? e.message : 'Could not load the model' }); },
    );
    return () => { cancelled = true; release?.(); };
  }, [key]);

  return state;
}

function Scene({ mesh, selection, mode, axes }: {
  mesh: LoadedMesh;
  selection: { positions: Float32Array; edges: Float32Array; bounds: Bounds | null } | null;
  mode: Mode;
  axes: Array<[number, number, number]>;
}) {
  const body = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
    g.computeVertexNormals();
    return g;
  }, [mesh]);
  useEffect(() => () => { body.dispose(); }, [body]);

  const fill = useMemo(() => {
    if (!selection) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(selection.positions, 3));
    return g;
  }, [selection]);
  const outline = useMemo(() => {
    if (!selection || selection.edges.length === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(selection.edges, 3));
    return g;
  }, [selection]);
  const box = useMemo(() => {
    if (!selection?.bounds) return null;
    const { min, max } = selection.bounds;
    const size = new THREE.Vector3(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
    const g = new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x || 0.01, size.y || 0.01, size.z || 0.01));
    const center = new THREE.Vector3((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
    return { g, center };
  }, [selection]);
  useEffect(() => () => { fill?.dispose(); outline?.dispose(); box?.g.dispose(); }, [fill, outline, box]);

  return (
    <group>
      <mesh geometry={body}>
        <meshStandardMaterial color={BODY_COLOR} metalness={0.05} roughness={0.6} side={THREE.DoubleSide} polygonOffset polygonOffsetFactor={1} polygonOffsetUnits={1} />
      </mesh>
      <BodyEdges geometry={body} />
      {fill && mode === 'face' && (
        <mesh geometry={fill} renderOrder={3}>
          <meshBasicMaterial color={FEATURE_COLOR} side={THREE.DoubleSide} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} />
        </mesh>
      )}
      {outline && (
        <lineSegments geometry={outline} renderOrder={4}>
          <lineBasicMaterial color={FEATURE_COLOR} depthTest={mode === 'face'} />
        </lineSegments>
      )}
      {box && (
        <lineSegments geometry={box.g} position={box.center} renderOrder={5}>
          <lineBasicMaterial color={BOX_COLOR} depthTest={false} />
        </lineSegments>
      )}
      {axes.length > 0 && <SetupAxisArrows geometry={body} axes={axes} />}
    </group>
  );
}

/** Frames `bounds` (part or feature) whenever the bounds or the nonce change. */
function CameraRig({ bounds, nonce }: { bounds: Bounds | null; nonce: number }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as { target: THREE.Vector3; update: () => void } | null;
  useEffect(() => {
    if (!bounds || !(camera instanceof THREE.PerspectiveCamera)) return;
    const box: Box3Like = bounds;
    const fit = fitCameraToBox(box, camera.fov);
    if (!fit) return;
    camera.position.set(...fit.position);
    camera.near = fit.near;
    camera.far = fit.far;
    camera.updateProjectionMatrix();
    controls?.target.set(...fit.center);
    controls?.update();
  }, [bounds, nonce, camera, controls]);
  return null;
}

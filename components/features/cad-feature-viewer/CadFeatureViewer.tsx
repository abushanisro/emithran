'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Crosshair, Home, Loader2, Square, SquareDashed } from 'lucide-react';
import * as THREE from 'three';

import { SetupAxisArrows } from '@/components/viewer/body-overlays';
import { fitCameraToBox, type Box3Like } from '@/lib/geometry/camera-fit';
import type { FaceMapEntry } from '@/lib/types/manufacturing';
import {
  boundaryEdges, boundsOf, boundsOfPositions, buildFaceIndex, subsetPositions, trianglesOfFaces, type Bounds,
} from '@/lib/viewer/highlight-geometry';
import { storageKey, type LoadedMesh } from '@/lib/viewer/geometry-store';
import { viewerGeometryStore } from '@/lib/viewer/viewer-store';

const BODY_COLOR = '#9b9bb4';
/** Faces the value counted, and same-kind faces it left out. Nothing else on the part is colored. */
const COUNTED_COLOR = '#22c55e';
const EXCLUDED_COLOR = '#ef4444';

interface CadFeatureViewerProps {
  fileUrl: string;
  faceMap: FaceMapEntry[] | null;
  /** Faces the measured value was taken from (OCC ordinals, indices into faceMap). */
  faceIds: number[];
  /** Same-kind faces the value left out, drawn in their own color. */
  excludedFaceIds?: number[];
  /** Real setup-axis directions to draw, when the engine proved any. */
  axes?: Array<[number, number, number]>;
  /** How the measured faces are first drawn; the toolbar switches it. */
  initialMode?: Mode;
}

type Mode = 'face' | 'edge';
type Focus = { on: 'part' | 'feature'; nonce: number };

/** The part, loaded once through the shared store, with only the measured faces highlighted. */
export function CadFeatureViewer({ fileUrl, faceMap, faceIds, excludedFaceIds, axes = [], initialMode = 'face' }: CadFeatureViewerProps) {
  const { mesh, error } = useMesh(fileUrl);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [focus, setFocus] = useState<Focus>({ on: 'part', nonce: 0 });

  // One face index per part, shared by both groups.
  const faceIndex = useMemo(() => (mesh && faceMap ? buildFaceIndex(faceMap, mesh.triTotal) : null), [mesh, faceMap]);
  const selection = useMemo(() => (mesh && faceIndex ? selectFaces(mesh, faceIndex, faceIds) : null), [mesh, faceIndex, faceIds]);
  const excluded = useMemo(
    () => (mesh && faceIndex && excludedFaceIds?.length ? selectFaces(mesh, faceIndex, excludedFaceIds) : null),
    [mesh, faceIndex, excludedFaceIds],
  );

  const partBounds = useMemo(() => (mesh ? boundsOfPositions(mesh.positions) : null), [mesh]);

  const focusBounds = focus.on === 'feature' && selection?.bounds ? selection.bounds : partBounds;

  return (
    <div className="relative h-full w-full bg-linear-to-b from-[#e6f0e7] to-[#b4d2b7]">
      <div className="absolute left-2 top-2 z-10 flex items-center gap-1 rounded border border-[#c4cfc6] bg-[#f3f6f3]/95 p-1 shadow-xs">
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
          <Scene mesh={mesh} selection={selection} excluded={excluded} mode={mode} axes={axes} />
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

type FaceSelection = { triangles: Int32Array; positions: Float32Array; bounds: Bounds | null };

function selectFaces(mesh: LoadedMesh, faceIndex: ReturnType<typeof buildFaceIndex>, faceIds: number[]): FaceSelection | null {
  const triangles = trianglesOfFaces(faceIndex, faceIds);
  if (triangles.length === 0) return null;
  return {
    triangles,
    positions: subsetPositions(mesh.positions, triangles),
    bounds: boundsOf(mesh.positions, triangles),
  };
}

/** The filled faces and the outline of one group, built once per selection and disposed with it. */
function SelectionLayer({ mesh, selection, color, mode }: { mesh: LoadedMesh; selection: FaceSelection; color: string; mode: Mode }) {
  const fill = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(selection.positions, 3));
    return g;
  }, [selection]);
  // The outline is only needed (and only computed) in edge mode.
  const outline = useMemo(() => {
    if (mode !== 'edge') return null;
    const edges = boundaryEdges(mesh.positions, selection.triangles);
    if (edges.length === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(edges, 3));
    return g;
  }, [mesh, selection, mode]);
  useEffect(() => () => { fill.dispose(); outline?.dispose(); }, [fill, outline]);
  return (
    <>
      {mode === 'face' && (
        <mesh geometry={fill} renderOrder={3}>
          <meshBasicMaterial color={color} side={THREE.DoubleSide} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} />
        </mesh>
      )}
      {mode === 'edge' && outline && (
        <lineSegments geometry={outline} renderOrder={4}>
          <lineBasicMaterial color={color} depthTest={false} />
        </lineSegments>
      )}
    </>
  );
}

function Scene({ mesh, selection, excluded, mode, axes }: {
  mesh: LoadedMesh;
  selection: FaceSelection | null;
  excluded: FaceSelection | null;
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

  return (
    <group>
      <mesh geometry={body}>
        <meshStandardMaterial color={BODY_COLOR} metalness={0.05} roughness={0.6} side={THREE.DoubleSide} polygonOffset polygonOffsetFactor={1} polygonOffsetUnits={1} />
      </mesh>
      {selection && <SelectionLayer mesh={mesh} selection={selection} color={COUNTED_COLOR} mode={mode} />}
      {excluded && <SelectionLayer mesh={mesh} selection={excluded} color={EXCLUDED_COLOR} mode={mode} />}
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

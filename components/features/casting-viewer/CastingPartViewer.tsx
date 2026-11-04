"use client";

import { useEffect, useMemo, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Home, Loader2 } from "lucide-react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

import { fitCameraToBox, type Box3Like } from "@/lib/geometry/camera-fit";
import {
  glbMatchesFaces,
  lineSegments,
  primitivesOfFaces,
  type Xyz,
} from "@/lib/casting/viewer-model";

const BODY_COLOR = "#9b9bb4";
const FEATURE_COLOR = "#22c55e";
const EDGE_COLOR = "#ef4444";
const PARTING_COLOR = "#2563eb";
const CORE_COLOR = "#f59e0b";
/** A part's GLB is a few hundred KB; a file far beyond that is not one the worker made. */
const MAX_GLB_BYTES = 40 * 1024 * 1024;

export interface CastingViewerFeature {
  id: string;
  /** Face indices of the worker's own numbering (the result's `glb_faces`). */
  faces: number[];
  /** Edge polylines in the part's Z-up millimetres. */
  edges: Xyz[][];
}

interface CastingPartViewerProps {
  /** Signed URL of the part's GLB (the analysis's `parts[].glb`). */
  partUrl: string;
  /** Signed URL of the cores' GLB, when the part has cores. */
  coresUrl?: string | null;
  /** The result's `glb_faces` of this part. */
  glbFaces: number[];
  /** The feature to highlight, if one is selected. */
  feature?: CastingViewerFeature | null;
  /** The parting line's closed loop (the result's `casting.parting.points`), if found. */
  partingPoints?: Xyz[] | null;
  showCores?: boolean;
  showParting?: boolean;
}

/**
 * The worker's own mesh of a sand casting part, with a feature's faces and edges, the cores and the parting line. It shows the worker's
 * mesh, never the CAD engine's, because the features are numbered against the worker's faces.
 */
export function CastingPartViewer({
  partUrl,
  coresUrl = null,
  glbFaces,
  feature = null,
  partingPoints = null,
  showCores = true,
  showParting = true,
}: CastingPartViewerProps) {
  const part = useGlb(partUrl);
  const cores = useGlb(coresUrl);
  const [nonce, setNonce] = useState(0);

  const meshes = useMemo(() => (part.scene ? meshesOf(part.scene) : []), [part.scene]);
  const addressable = glbMatchesFaces(meshes.length, glbFaces);
  const selected = useMemo(
    () => (feature && addressable ? primitivesOfFaces(glbFaces, feature.faces) : []),
    [feature, addressable, glbFaces],
  );
  const edges = useMemo(
    () => (feature ? lineSegments(feature.edges) : new Float32Array(0)),
    [feature],
  );
  const parting = useMemo(
    () => (partingPoints ? lineSegments([partingPoints], true) : new Float32Array(0)),
    [partingPoints],
  );
  const bounds = useMemo(
    () => (part.scene ? boundsOfObject(part.scene) : null),
    [part.scene],
  );

  return (
    <div className="relative h-full w-full bg-linear-to-b from-[#e6f0e7] to-[#b4d2b7]">
      <button
        type="button"
        title="Home — fit the whole part"
        aria-label="Home — fit the whole part"
        onClick={() => {
          setNonce((n) => n + 1);
        }}
        className="absolute left-2 top-2 z-10 rounded border border-[#c4cfc6] bg-[#f3f6f3]/95 p-1.5 text-[#1f2d3a] shadow-xs hover:bg-[#dfe8e0]"
      >
        <Home className="h-4 w-4" />
      </button>
      {part.loading && <Status text="Loading 3D model…" spinner />}
      {part.error && <Status text={part.error} />}
      {part.scene && feature && !addressable && (
        <Status
          text="This model does not match the analysis (re-run the analysis): nothing is highlighted"
          corner
        />
      )}
      {part.scene && (
        <Canvas dpr={[1, 2]} camera={{ fov: 45 }} gl={{ antialias: true, alpha: true }}>
          <ambientLight intensity={0.7} />
          <directionalLight position={[1, 1, 0.5]} intensity={1.1} />
          <directionalLight position={[-1, -1, -0.5]} intensity={0.4} />
          <Body scene={part.scene} meshes={meshes} selected={selected} />
          {showCores && cores.scene && <Cores scene={cores.scene} />}
          <Lines positions={edges} color={EDGE_COLOR} />
          {showParting && <Lines positions={parting} color={PARTING_COLOR} />}
          <CameraRig bounds={bounds} nonce={nonce} />
          <OrbitControls makeDefault enableDamping />
        </Canvas>
      )}
    </div>
  );
}

function Status({
  text,
  corner,
  spinner,
}: {
  text: string;
  corner?: boolean;
  spinner?: boolean;
}) {
  return (
    <div
      className={`absolute z-10 text-xs text-[#1f2d3a] ${corner ? "bottom-2 left-2 rounded bg-white/80 px-2 py-1" : "inset-0 flex items-center justify-center gap-2"}`}
      role={spinner ? "status" : undefined}
    >
      {spinner && <Loader2 className="h-4 w-4 animate-spin" />}
      {text}
    </div>
  );
}

/** The GLB at `url`, parsed once per storage path (a refreshed signed URL for the same file does not reload it). */
function useGlb(url: string | null | undefined): {
  scene: THREE.Group | null;
  loading: boolean;
  error: string | null;
} {
  const [state, setState] = useState<{
    scene: THREE.Group | null;
    loading: boolean;
    error: string | null;
  }>({ scene: null, loading: !!url, error: null });
  const key = url ? new URL(url, "http://local").pathname : null;
  useEffect(() => {
    if (!url) {
      setState({ scene: null, loading: false, error: null });
      return;
    }
    let cancelled = false;
    let loaded: THREE.Group | null = null;
    setState({ scene: null, loading: true, error: null });
    void (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`The model could not be fetched (${res.status})`);
        const buffer = await res.arrayBuffer();
        if (buffer.byteLength > MAX_GLB_BYTES)
          throw new Error("The model file is larger than expected");
        const gltf = await new GLTFLoader().parseAsync(buffer, "");
        if (cancelled) {
          disposeObject(gltf.scene);
          return;
        }
        loaded = gltf.scene;
        setState({ scene: gltf.scene, loading: false, error: null });
      } catch (e) {
        if (!cancelled)
          setState({
            scene: null,
            loading: false,
            error: e instanceof Error ? e.message : "Could not load the model",
          });
      }
    })();
    return () => {
      cancelled = true;
      if (loaded) disposeObject(loaded);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the storage path, not the signed query
  }, [key]);
  return state;
}

function meshesOf(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) out.push(o);
  });
  return out;
}

function disposeObject(root: THREE.Object3D) {
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const m = o;
    m.geometry.dispose();
    for (const mat of Array.isArray(m.material) ? m.material : [m.material])
      mat.dispose();
  });
}

function boundsOfObject(root: THREE.Object3D): Box3Like | null {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) return null;
  return {
    min: box.min.toArray() as [number, number, number],
    max: box.max.toArray() as [number, number, number],
  };
}

/** The part's meshes in the body color, and the selected ones drawn again on top in the feature color. */
function Body({
  scene,
  meshes,
  selected,
}: {
  scene: THREE.Group;
  meshes: THREE.Mesh[];
  selected: number[];
}) {
  const body = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: BODY_COLOR,
        metalness: 0.05,
        roughness: 0.6,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      }),
    [],
  );
  const highlight = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: FEATURE_COLOR,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    [],
  );
  useEffect(() => {
    const original = meshes.map((m) => m.material);
    meshes.forEach((m) => {
      m.material = body;
    });
    return () => {
      meshes.forEach((m, i) => {
        m.material = original[i]!;
      });
      body.dispose();
    };
  }, [meshes, body]);
  useEffect(
    () => () => {
      highlight.dispose();
    },
    [highlight],
  );

  const overlays = useMemo(() => {
    scene.updateMatrixWorld(true);
    return selected.map((i) => {
      const src = meshes[i]!;
      const m = new THREE.Mesh(src.geometry, highlight);
      m.applyMatrix4(src.matrixWorld);
      m.renderOrder = 3;
      return m;
    });
  }, [scene, meshes, selected, highlight]);

  return (
    <>
      <primitive object={scene} />
      {overlays.map((o) => (
        <primitive key={o.uuid} object={o} />
      ))}
    </>
  );
}

function Cores({ scene }: { scene: THREE.Group }) {
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: CORE_COLOR,
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide,
      }),
    [],
  );
  useEffect(() => {
    const meshes = meshesOf(scene);
    const original = meshes.map((m) => m.material);
    meshes.forEach((m) => {
      m.material = material;
    });
    return () => {
      meshes.forEach((m, i) => {
        m.material = original[i]!;
      });
      material.dispose();
    };
  }, [scene, material]);
  return <primitive object={scene} />;
}

function Lines({ positions, color }: { positions: Float32Array; color: string }) {
  const geometry = useMemo(() => {
    if (positions.length === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return g;
  }, [positions]);
  useEffect(
    () => () => {
      geometry?.dispose();
    },
    [geometry],
  );
  if (!geometry) return null;
  return (
    <lineSegments geometry={geometry} renderOrder={4}>
      <lineBasicMaterial color={color} depthTest={false} />
    </lineSegments>
  );
}

/** Frames the part whenever it loads or Home is pressed. */
function CameraRig({ bounds, nonce }: { bounds: Box3Like | null; nonce: number }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as {
    target: THREE.Vector3;
    update: () => void;
  } | null;
  useEffect(() => {
    if (!bounds || !(camera instanceof THREE.PerspectiveCamera)) return;
    const fit = fitCameraToBox(bounds, camera.fov);
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

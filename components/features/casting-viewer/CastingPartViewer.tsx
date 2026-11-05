"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Home, Loader2 } from "lucide-react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

import { fitCameraToBox, type Box3Like } from "@/lib/geometry/camera-fit";
import type { GlbShape } from "@/lib/casting/gating-layout";
import { vertexColors, vertexThickness, type ThicknessField } from "@/lib/casting/thickness-field";
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
const GATING_COLOR = "#8b5cf6";
const RISER_COLOR = "#ec4899";
const COPE_COLOR = "#d6b98c";
const DRAG_COLOR = "#b99868";
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
  /** The designed gating system and risers, already in the GLB frame (toGlbShape): a schematic placement, not part of the part. */
  gating?: readonly GlbShape[];
  showGating?: boolean;
  /** The mould (cope, drag, parting plane) in the GLB frame: the sand the casting is made in, translucent, around the part. */
  mould?: readonly GlbShape[];
  showMould?: boolean;
  /** Cut the mould in half across its length so the part inside shows. */
  section?: boolean;
  /** The axis of the GLB frame the section cuts across (0 x, 1 y, 2 z): never the draw axis, or the cut would lie in the parting plane. */
  sectionAxis?: 0 | 1 | 2;
  /** Face number (the result's numbering) to colour: the draft overlay. Applied only when the loaded model matches `glbFaces`. */
  faceColors?: ReadonlyMap<number, string> | null;
  /** The wall thickness over the surface (worker 0.17.0 rays): each vertex coloured from the nearest rays of its face. Wins over `faceColors`. */
  thicknessField?: ThicknessField | null;
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
  gating = [],
  showGating = true,
  mould = [],
  showMould = false,
  section = false,
  sectionAxis = 0,
  faceColors = null,
  thicknessField = null,
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

  // The camera fits the part, and the mould too once it is shown (the flask is much larger than a small part, and would fill the view with the part lost
  // in it). It refits when the mould is shown or hidden, not as the slider moves it.
  const mouldRef = useRef(mould);
  mouldRef.current = mould;
  const fitBounds = useMemo(
    () => (showMould ? unionBounds(bounds, mouldBoundsOf(mouldRef.current)) : bounds),
    [bounds, showMould],
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
        <Canvas dpr={[1, 2]} camera={{ fov: 45 }} gl={{ antialias: true, alpha: true }}
          onCreated={({ gl }) => {
            gl.localClippingEnabled = true;
          }}
        >
          <ambientLight intensity={0.7} />
          <directionalLight position={[1, 1, 0.5]} intensity={1.1} />
          <directionalLight position={[-1, -1, -0.5]} intensity={0.4} />
          <Body
            scene={part.scene}
            meshes={meshes}
            selected={selected}
            colors={addressable && faceColors && !thicknessField ? meshColors(glbFaces, faceColors) : null}
            field={addressable ? thicknessField : null}
            glbFaces={glbFaces}
          />
          {showCores && cores.scene && <Cores scene={cores.scene} />}
          <Lines positions={edges} color={EDGE_COLOR} />
          {showParting && <Lines positions={parting} color={PARTING_COLOR} />}
          {showGating && <GatingSolids shapes={gating} />}
          {showMould && <SandMould shapes={mould} section={section} axis={sectionAxis} />}
          <CameraRig bounds={fitBounds} nonce={nonce} />
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

/** The corners that hold every box of the mould (centre and size, in the GLB frame); null without one. */
function mouldBoundsOf(shapes: readonly GlbShape[]): Box3Like | null {
  const boxes = shapes.filter((s) => s.kind === "box");
  if (boxes.length === 0) return null;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const b of boxes) {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i] ?? Infinity, (b.center[i] ?? 0) - (b.size[i] ?? 0) / 2);
      max[i] = Math.max(max[i] ?? -Infinity, (b.center[i] ?? 0) + (b.size[i] ?? 0) / 2);
    }
  }
  return { min, max };
}

function unionBounds(a: Box3Like | null, b: Box3Like | null): Box3Like | null {
  if (!a || !b) return a ?? b;
  return {
    min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])],
    max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])],
  };
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
/** The colour of each mesh by the face it shows (null: the body colour). Index i is primitive i of the part GLB. */
function meshColors(
  glbFaces: readonly number[],
  faceColors: ReadonlyMap<number, string>,
): (string | null)[] {
  return glbFaces.map((face) => faceColors.get(face) ?? null);
}

function Body({
  scene,
  meshes,
  selected,
  colors,
  field,
  glbFaces,
}: {
  scene: THREE.Group;
  meshes: THREE.Mesh[];
  selected: number[];
  /** A colour per mesh (the overlay), or null for the plain body. */
  colors: (string | null)[] | null;
  /** The thickness over the surface, drawn as vertex colours on the meshes whose face has rays. */
  field: ThicknessField | null;
  glbFaces: readonly number[];
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
    // One material per colour of the overlay; a mesh with none keeps the body's.
    const byColor = new Map<string, THREE.MeshStandardMaterial>();
    const materialFor = (color: string | null | undefined) => {
      if (!color) return body;
      let m = byColor.get(color);
      if (!m) {
        m = body.clone();
        m.color = new THREE.Color(color);
        byColor.set(color, m);
      }
      return m;
    };
    meshes.forEach((m, i) => {
      m.material = materialFor(colors?.[i]);
    });
    return () => {
      meshes.forEach((m, i) => {
        m.material = original[i]!;
      });
      body.dispose();
      byColor.forEach((m) => m.dispose());
    };
  }, [meshes, body, colors]);
  // The thickness over the surface: vertex colours from the nearest rays of each mesh's own face; a face with no ray keeps what the effect above gave it.
  useEffect(() => {
    if (!field) return undefined;
    scene.updateMatrixWorld(true);
    const applied: Array<{ mesh: THREE.Mesh; material: THREE.Material | THREE.Material[]; colour: THREE.BufferAttribute | null }> = [];
    const painted = new THREE.MeshStandardMaterial({
      color: "#ffffff",
      vertexColors: true,
      metalness: 0.05,
      roughness: 0.6,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    meshes.forEach((mesh, i) => {
      const samples = field.byFace.get(glbFaces[i] ?? -1);
      const position = mesh.geometry.getAttribute("position");
      if (!samples || !position) return;
      const world = new Float32Array(position.count * 3);
      const v = new THREE.Vector3();
      for (let j = 0; j < position.count; j++) {
        v.fromBufferAttribute(position, j).applyMatrix4(mesh.matrixWorld);
        world.set([v.x, v.y, v.z], 3 * j);
      }
      const colours = vertexColors(vertexThickness(world, samples), field.range);
      applied.push({ mesh, material: mesh.material, colour: mesh.geometry.getAttribute("color") as THREE.BufferAttribute | null });
      mesh.geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
      mesh.material = painted;
    });
    return () => {
      for (const a of applied) {
        if (a.colour) a.mesh.geometry.setAttribute("color", a.colour);
        else a.mesh.geometry.deleteAttribute("color");
        a.mesh.material = a.material;
      }
      painted.dispose();
    };
  }, [field, meshes, glbFaces, scene, colors]);
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

/** The parting plate a little smaller across than the sand it lies in, so its edges do not share a plane with the sand's sides (they would flicker where the two overlap). */
function insetPlate(size: Xyz): [number, number, number] {
  const thin = Math.min(...size);
  return [size[0], size[1], size[2]].map((v) => (v === thin ? v : v * 0.98)) as [number, number, number];
}

/** The mould: cope and drag as translucent sand boxes, the parting plane as a thin plate; cut in half across `axis` when `section` is on. */
function SandMould({ shapes, section, axis }: { shapes: readonly GlbShape[]; section: boolean; axis: 0 | 1 | 2 }) {
  const boxes = useMemo(() => shapes.filter((s) => s.kind === "box"), [shapes]);
  const plane = useMemo(() => {
    if (boxes.length === 0) return null;
    const middle = boxes.reduce((sum, b) => sum + b.center[axis], 0) / boxes.length;
    // Keeps the points at or below the middle of the mould along the cut axis.
    const normal = new THREE.Vector3(0, 0, 0).setComponent(axis, -1);
    return new THREE.Plane(normal, middle);
  }, [boxes, axis]);
  return (
    <>
      {boxes.map((shape) => (
        <mesh key={shape.name} position={shape.center} name={shape.name} renderOrder={-1}>
          <boxGeometry args={shape.name === "Parting plane" ? insetPlate(shape.size) : shape.size} />
          <meshStandardMaterial
            color={shape.name === "Parting plane" ? PARTING_COLOR : shape.name === "Drag" ? DRAG_COLOR : COPE_COLOR}
            transparent
            opacity={shape.name === "Parting plane" ? 0.5 : 0.28}
            depthWrite={false}
            side={THREE.FrontSide}
            polygonOffset={shape.name === "Parting plane"}
            polygonOffsetFactor={-2}
            polygonOffsetUnits={-2}
            clippingPlanes={section && plane ? [plane] : []}
          />
        </mesh>
      ))}
    </>
  );
}

/** The designed gating system and risers as translucent solids (box or cylinder per shape); risers in their own colour. */
function GatingSolids({ shapes }: { shapes: readonly GlbShape[] }) {
  return (
    <>
      {shapes.map((shape) => {
        const color = shape.name.startsWith("Riser") ? RISER_COLOR : GATING_COLOR;
        if (shape.kind === "box") {
          return (
            <mesh key={shape.name} position={shape.center} name={shape.name}>
              <boxGeometry args={shape.size} />
              <meshStandardMaterial color={color} transparent opacity={0.55} />
            </mesh>
          );
        }
        // A cylinder is built along +Y; turn +Y onto the shape's direction.
        const quaternion = new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          new THREE.Vector3(...shape.direction),
        );
        return (
          <mesh
            key={shape.name}
            position={shape.center}
            quaternion={quaternion}
            name={shape.name}
          >
            <cylinderGeometry args={[shape.radius, shape.radius, shape.length, 32]} />
            <meshStandardMaterial color={color} transparent opacity={0.55} />
          </mesh>
        );
      })}
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

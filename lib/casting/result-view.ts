/**
 * What the sand casting panel reads from a worker result (casting-worker/result.schema.json): the one part's mesh names, its `glb_faces`, its
 * features and its parting line. Pure and defensive: a result that is not one part, or lacks a piece, says so and shows nothing of that piece,
 * because the result is stored data and the panel must not break on a shape it did not expect.
 */
import type { CastingWorkerFeature } from "@/lib/casting/features";
import type { WallRay } from "@/lib/casting/thickness-field";
import type { FaceThickness } from "@/lib/casting/thickness-map";
import type { Xyz } from "@/lib/casting/viewer-model";

export interface CastingPartView {
  /** The part GLB's name in the analysis (`parts/<name>.glb`), as `meshes?name=` takes it. */
  glb: string | null;
  coresGlb: string | null;
  glbFaces: number[];
  features: CastingWorkerFeature[];
  partingPoints: Xyz[] | null;
  drawAxis: "x" | "y" | "z" | null;
  /** Whether the worker chose the axis ("auto") or measured along the one it was given ("requested"). */
  drawAxisSource: "auto" | "requested" | null;
  /** The part's bounding box and the parting plane's height along the draw axis (part coordinates, mm), where the gating is laid out. */
  box: { min: Xyz; max: Xyz } | null;
  partingHeight: number | null;
  /** The faces whose draft angle the worker measured (casting.draft.faces), numbered as glb_faces and the features number them. */
  draftFaces: number[];
  /** The faces a wall thickness was measured from (casting.wall_mm.faces), numbered the same way. */
  wallFaces: number[];
  /** The thinnest wall measured from each of those faces, mm (casting.wall_mm.faces), for the thickness colour map. */
  wallThickness: FaceThickness[];
  /** The wall-thickness rays (casting.wall_mm.points, worker 0.17.0 and later; empty before), and the worker's own thin and thick ends (its 5th and 95th percentiles). */
  wallRays: WallRay[];
  wallRange: { min: number; max: number } | null;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isXyz = (p: unknown): p is Xyz =>
  Array.isArray(p) && p.length === 3 && p.every(isNum);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

export function castingPartView(result: unknown): CastingPartView | { reason: string } {
  const parts = (result as { parts?: unknown } | null)?.parts;
  if (!Array.isArray(parts) || parts.length === 0)
    return { reason: "The analysis holds no part." };
  if (parts.length > 1)
    return {
      reason: `The analysis holds ${parts.length} distinct parts: the casting views are for one part.`,
    };
  const p = parts[0] as {
    glb?: unknown;
    box_mm?: { min?: unknown; max?: unknown } | null;
    glb_faces?: unknown;
    features?: unknown;
    casting?: {
      cores_glb?: unknown;
      draw_axis?: unknown;
      draw_axis_source?: unknown;
      parting?: { points?: unknown; height_mm?: unknown } | null;
      draft?: { faces?: unknown } | null;
      wall_mm?: { faces?: unknown; points?: unknown; min?: unknown; max?: unknown } | null;
    } | null;
  };
  const features = (Array.isArray(p.features) ? p.features : []).flatMap(
    (f): CastingWorkerFeature[] => {
      const x = (f ?? {}) as Partial<CastingWorkerFeature>;
      if (typeof x.id !== "string" || typeof x.type !== "string") return [];
      return [
        {
          id: x.id,
          type: x.type,
          parent: typeof x.parent === "string" ? x.parent : null,
          faces: Array.isArray(x.faces) ? x.faces.filter(isNum) : [],
          edges: Array.isArray(x.edges)
            ? x.edges.map((line) => (Array.isArray(line) ? line.filter(isXyz) : []))
            : [],
          parameters: Object.fromEntries(
            Object.entries(x.parameters ?? {}).filter(([, v]) => isNum(v)),
          ),
        },
      ];
    },
  );
  const points = p.casting?.parting?.points;
  const axis = p.casting?.draw_axis;
  const source = p.casting?.draw_axis_source;
  return {
    glb: str(p.glb),
    coresGlb: str(p.casting?.cores_glb),
    glbFaces: Array.isArray(p.glb_faces) ? p.glb_faces.filter(isNum) : [],
    features,
    partingPoints:
      Array.isArray(points) && points.length > 2 ? points.filter(isXyz) : null,
    drawAxis: axis === "x" || axis === "y" || axis === "z" ? axis : null,
    drawAxisSource: source === "auto" || source === "requested" ? source : null,
    box: isXyz(p.box_mm?.min) && isXyz(p.box_mm?.max) ? { min: p.box_mm.min, max: p.box_mm.max } : null,
    partingHeight: isNum(p.casting?.parting?.height_mm) ? p.casting.parting.height_mm : null,
    draftFaces: Array.isArray(p.casting?.draft?.faces)
      ? p.casting.draft.faces.flatMap((d: unknown) => {
          const face = (d as { face?: unknown } | null)?.face;
          return typeof face === "number" && Number.isInteger(face) ? [face] : [];
        })
      : [],
    wallFaces: Array.isArray(p.casting?.wall_mm?.faces)
      ? p.casting.wall_mm.faces.flatMap((d: unknown) => {
          const face = (d as { face?: unknown } | null)?.face;
          return typeof face === "number" && Number.isInteger(face) ? [face] : [];
        })
      : [],
    wallThickness: Array.isArray(p.casting?.wall_mm?.faces)
      ? p.casting.wall_mm.faces.flatMap((d: unknown) => {
          const r = d as { face?: unknown; min?: unknown } | null;
          return typeof r?.face === "number" && Number.isInteger(r.face) && isNum(r.min)
            ? [{ face: r.face, min: r.min }]
            : [];
        })
      : [],
    wallRays: rays(p.casting?.wall_mm?.points),
    wallRange: wallRange(p.casting?.wall_mm),
  };
}

/** The rays of casting.wall_mm.points: [face, x, y, z, mm] each; an entry that is not that is left out. */
function rays(points: unknown): WallRay[] {
  if (!Array.isArray(points)) return [];
  return points.flatMap((d: unknown): WallRay[] => {
    if (!Array.isArray(d) || d.length !== 5) return [];
    const [face, x, y, z, mm] = d as unknown[];
    return typeof face === "number" && Number.isInteger(face) && isNum(x) && isNum(y) && isNum(z) && isNum(mm)
      ? [{ face, at: [x, y, z], mm }]
      : [];
  });
}

/** The worker's own thin and thick ends of the wall thickness (its 5th and 95th percentiles), or null. */
function wallRange(wall: { min?: unknown; max?: unknown } | null | undefined): { min: number; max: number } | null {
  return wall && isNum(wall.min) && isNum(wall.max) ? { min: wall.min, max: wall.max } : null;
}

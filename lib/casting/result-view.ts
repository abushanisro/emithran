/**
 * What the sand casting panel reads from a worker result (casting-worker/result.schema.json): the one part's mesh names, its `glb_faces`, its
 * features and its parting line. Pure and defensive: a result that is not one part, or lacks a piece, says so and shows nothing of that piece,
 * because the result is stored data and the panel must not break on a shape it did not expect.
 */
import type { CastingWorkerFeature } from "@/lib/casting/features";
import type { Xyz } from "@/lib/casting/viewer-model";

export interface CastingPartView {
  /** The part GLB's name in the analysis (`parts/<name>.glb`), as `meshes?name=` takes it. */
  glb: string | null;
  coresGlb: string | null;
  glbFaces: number[];
  features: CastingWorkerFeature[];
  partingPoints: Xyz[] | null;
  drawAxis: "x" | "y" | "z" | null;
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
    glb_faces?: unknown;
    features?: unknown;
    casting?: {
      cores_glb?: unknown;
      draw_axis?: unknown;
      parting?: { points?: unknown } | null;
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
  return {
    glb: str(p.glb),
    coresGlb: str(p.casting?.cores_glb),
    glbFaces: Array.isArray(p.glb_faces) ? p.glb_faces.filter(isNum) : [],
    features,
    partingPoints:
      Array.isArray(points) && points.length > 2 ? points.filter(isXyz) : null,
    drawAxis: axis === "x" || axis === "y" || axis === "z" ? axis : null,
  };
}

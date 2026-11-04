/**
 * The features of a sand casting analysis (casting-worker/result.schema.json, `feature`) grouped for the Features tab, the way the
 * die-casting tree groups a part: the same categories, since the worker names its feature types after the same reference catalog.
 *
 * These stay in the worker's own terms: `faces` are indices into the worker's own mesh (its `glb_faces` order) and `edges` are
 * polylines in its part coordinates. They are not the CAD engine's face map, so a row must only ever be highlighted on the
 * worker's mesh (P2-3), never on the CAD engine's.
 */
import { DIE_CAST_CATEGORIES } from "@/lib/features/die-casting-feature-tree";

export interface CastingWorkerFeature {
  id: string;
  type: string;
  parent: string | null;
  faces: number[];
  edges: Array<Array<[number, number, number]>>;
  parameters: Record<string, number>;
}

export interface CastingFeatureRow {
  feature: CastingWorkerFeature;
  /** The worker's own id, e.g. SimpleHole:3: stable within one analysis. */
  label: string;
  /** Id of the feature this one belongs to (a hole's ring, a void's combo), when the worker linked them. */
  parent: string | null;
}

export interface CastingTypeGroup {
  type: string;
  rows: CastingFeatureRow[];
}

export interface CastingCategoryGroup {
  key: string;
  label: string;
  types: CastingTypeGroup[];
  count: number;
}

/** Groups by category then type, in the order the die-casting tree uses. A type no category lists is never dropped: it goes under Not Supported's sibling "Other". */
export function groupCastingFeatures(
  features: readonly CastingWorkerFeature[],
): CastingCategoryGroup[] {
  const byType = new Map<string, CastingFeatureRow[]>();
  for (const feature of features) {
    const rows = byType.get(feature.type) ?? [];
    rows.push({ feature, label: feature.id, parent: feature.parent });
    byType.set(feature.type, rows);
  }
  const known = new Set<string>(DIE_CAST_CATEGORIES.flatMap((c) => c.types));
  const groups: CastingCategoryGroup[] = DIE_CAST_CATEGORIES.map((c) => {
    const types = c.types
      .map((type) => ({ type: type as string, rows: byType.get(type) ?? [] }))
      .filter((t) => t.rows.length > 0);
    return {
      key: c.key,
      label: c.label,
      types,
      count: types.reduce((n, t) => n + t.rows.length, 0),
    };
  });
  const other = [...byType.keys()]
    .filter((t) => !known.has(t))
    .map((type) => ({ type, rows: byType.get(type)! }));
  if (other.length > 0)
    groups.push({
      key: "other",
      label: "Other",
      types: other,
      count: other.reduce((n, t) => n + t.rows.length, 0),
    });
  return groups.filter((g) => g.count > 0);
}

/** Property/value pairs for one row: the worker's parameters as it measured them, nothing derived. */
export function castingFeatureProperties(
  row: CastingFeatureRow,
): { name: string; value: string }[] {
  const out = [{ name: "Name", value: row.label }];
  if (row.parent) out.push({ name: "Part of", value: row.parent });
  for (const [name, v] of Object.entries(row.feature.parameters)) {
    out.push({ name, value: Number.isInteger(v) ? String(v) : v.toFixed(2) });
  }
  out.push({ name: "Faces", value: String(row.feature.faces.length) });
  return out;
}

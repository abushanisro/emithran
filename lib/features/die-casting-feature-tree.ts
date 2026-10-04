/**
 * Die-casting feature tree, built only from feature_graph_v2 — grouped the
 * way a casting cost review reads a part: Volume (cored/undercut cavities),
 * Holes, Surfaces, and the faces no detector explains (Not Supported).
 *
 * Feature type names are the reference catalog's own (memory/Die Casting/
 * Processes/operations.csv via cad-engine/shared/reference_features.json), so
 * no display-name table is kept here. The category a type belongs to is a
 * presentation choice, not costing data.
 */
import type { FeatureNodeV2, FeatureOccurrence } from '@/lib/types/manufacturing';

export const DIE_CAST_CATEGORIES = [
  { key: 'volume', label: 'Volume', types: ['ComboVoid', 'Void', 'SlideBundle'] },
  { key: 'holes', label: 'Holes', types: ['SimpleHole', 'MultiStepHole', 'Ring', 'RingedHole'] },
  { key: 'surfaces', label: 'Surfaces', types: ['PlanarFace', 'CurvedWall', 'CurvedSurface', 'SharpEdge', 'Edge'] },
  { key: 'not_supported', label: 'Not Supported', types: ['NotSupported'] },
] as const;

export interface DieCastOccurrenceRow {
  feature: FeatureNodeV2;
  occurrence: FeatureOccurrence;
  index: number;
  /** Per-type running number, e.g. MultiStepHole:5 — stable within one analysis. */
  label: string;
}

export interface DieCastTypeGroup {
  type: string;
  rows: DieCastOccurrenceRow[];
}

export interface DieCastCategoryGroup {
  key: string;
  label: string;
  types: DieCastTypeGroup[];
  count: number;
}

export function groupDieCastFeatures(features: readonly FeatureNodeV2[]): DieCastCategoryGroup[] {
  const rowsByType = new Map<string, DieCastOccurrenceRow[]>();
  for (const f of features) {
    const type = String(f.feature_type);
    const rows = rowsByType.get(type) ?? [];
    f.occurrences.forEach((occurrence, index) => {
      rows.push({ feature: f, occurrence, index, label: `${type}:${rows.length + 1}` });
    });
    rowsByType.set(type, rows);
  }
  return DIE_CAST_CATEGORIES.map((c) => {
    const types = c.types
      .map((type) => ({ type: type as string, rows: rowsByType.get(type) ?? [] }))
      .filter((t) => t.rows.length > 0);
    return { key: c.key, label: c.label, types, count: types.reduce((s, t) => s + t.rows.length, 0) };
  });
}

/**
 * Plain property/value pairs for one occurrence — every scalar the CAD engine
 * reported for it, nothing derived here. Geometry ids and nested provenance
 * are left out; they are not properties a reviewer reads.
 */
export function occurrenceProperties(row: DieCastOccurrenceRow): { name: string; value: string }[] {
  const skip = new Set(['face_ids', 'source_face_stable_ids']);
  const fmt = (v: unknown): string | null => {
    if (v == null) return null;
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (typeof v === 'string') return v;
    if (Array.isArray(v) && v.every((x) => typeof x === 'number')) return `(${v.map((x) => (x as number).toFixed(2)).join(', ')})`;
    return null;
  };
  const out: { name: string; value: string }[] = [{ name: 'Name', value: row.label }];
  if (row.feature.variant && row.feature.variant !== 'default') out.push({ name: 'Variant', value: row.feature.variant });
  for (const [k, v] of Object.entries(row.occurrence)) {
    if (skip.has(k)) continue;
    const value = fmt(v);
    if (value != null) out.push({ name: k, value });
  }
  return out;
}

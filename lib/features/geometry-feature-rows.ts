/**
 * The Geometry tab's feature list for a part whose features come from feature_graph_v2 (machined and cast parts): every feature type the analysis found,
 * with its count, and under it one row per size and variant. Nothing is derived here: the counts are the occurrences, the sizes are the ones the CAD engine
 * measured. The type names are the catalog's own (machining-feature-tree.ts).
 */
import type { FeatureNodeV2 } from '@/lib/types/manufacturing';
import { groupFeaturesByType } from './machining-feature-tree';

export interface GeometryFeatureRow {
  /** "Ø4.0 mm · blind", "R42.0 mm · round", "default". */
  label: string;
  count: number;
  /** The feature entry the row stands for (viewer highlighting). */
  feature: FeatureNodeV2;
}

export interface GeometryFeatureGroup {
  type: string;
  count: number;
  rows: GeometryFeatureRow[];
}

const positive = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);

/** The size a feature entry is grouped by: a hole's diameter, else the radius its occurrences share (fillets, grooves). */
function sizeLabel(f: FeatureNodeV2): string | null {
  const diameter = positive(f.diameter_mm);
  const radius = positive((f.occurrences[0] as { radius_mm?: unknown } | undefined)?.radius_mm);
  if (radius != null) return `R${radius.toFixed(1)} mm`;
  return diameter != null ? `Ø${diameter.toFixed(1)} mm` : null;
}

export function geometryFeatureGroups(features: readonly FeatureNodeV2[]): GeometryFeatureGroup[] {
  return groupFeaturesByType(features.filter((f) => f.occurrences.length > 0)).map((g) => ({
    type: g.type,
    count: g.occurrenceCount,
    rows: g.variants.flatMap((v) => v.features.map((feature) => {
      const size = sizeLabel(feature);
      const variant = v.variant === 'default' ? null : v.variant;
      return { label: [size, variant].filter(Boolean).join(' · ') || 'default', count: feature.occurrences.length, feature };
    })),
  }));
}

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
  /** The catalog feature type (SimpleHole, PocketV2). */
  type: string;
  /** The type as an engineer reads it, in the plural (Simple holes, Pockets). */
  label: string;
  count: number;
  rows: GeometryFeatureRow[];
}

/**
 * A catalog feature type as words, in the plural: "SimpleHole" -> "Simple holes", "PocketV2" -> "Pockets". Derived from the catalog name itself (its words, minus
 * a version suffix), so a type the catalog adds later reads correctly with no table here to fall behind it.
 */
export function featureTypeLabel(type: string): string {
  const words = type.replace(/V\d+$/, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim().toLowerCase();
  if (!words) return type;
  const plural = /(s|x|z|ch|sh)$/.test(words) ? `${words}es` : `${words}s`;
  return plural.charAt(0).toUpperCase() + plural.slice(1);
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
    label: featureTypeLabel(g.type),
    count: g.occurrenceCount,
    rows: g.variants.flatMap((v) => v.features.map((feature) => {
      const size = sizeLabel(feature);
      const variant = v.variant === 'default' ? null : v.variant;
      return { label: [size, variant].filter(Boolean).join(' · ') || 'default', count: feature.occurrences.length, feature };
    })),
  }));
}

/** The part's features in one line of counts, largest group first: "32 edges", "24 planar faces", "13 simple holes" ... */
export function featureCountSummary(features: readonly FeatureNodeV2[]): string[] {
  return geometryFeatureGroups(features)
    .sort((a, b) => b.count - a.count)
    .map((g) => `${g.count} ${g.label.toLowerCase()}`);
}

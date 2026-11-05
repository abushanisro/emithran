/**
 * The plastic feature graph the CAD engine returns (cad-engine injection_molding/recognition/feature_graph.py), grouped for the cost view.
 * Pure: counts and order only, nothing is derived that the engine did not state.
 */
export interface PlasticGraphItem {
  id: string;
  feature_type: string;
  variant: string | null;
  diameter_mm: number | null;
  depth_mm: number | null;
  attributes: Record<string, unknown>;
  occurrences: { face_ids: number[]; centroid?: [number, number, number] }[];
}

export interface PlasticFeatureGraph {
  schema: string;
  items: PlasticGraphItem[];
  /** Feature types the engine did not assess: absent from `items` does not mean the part has none. */
  not_yet_recognized: string[];
  /** Why each one was not assessed (engine side). Absent on an older engine. */
  not_assessed_reasons?: Record<string, string>;
  unclassified_faces: number;
}

export interface FeatureGroup {
  type: string;
  /** How many of them: ribs and faces carry their own count, every other item is one. */
  count: number;
  items: PlasticGraphItem[];
  /** The engine's reading label when the group is a reading of the staged notes (Void, bundles, parting line), else null. */
  reading: string | null;
}

const ORDER = ['SimpleHole', 'MultiStepHole', 'Void', 'ComboVoid', 'LifterBundle', 'SlideBundle', 'PartingLine', 'Rib', 'PlanarFace', 'CurvedWall', 'CurvedSurface'];
const COUNTED_BY_ATTRIBUTE: Record<string, string> = { Rib: 'count', PlanarFace: 'faces', CurvedWall: 'faces', CurvedSurface: 'faces' };

export const isPlasticGraph = (g: unknown): g is PlasticFeatureGraph =>
  typeof g === 'object' && g !== null && (g as { schema?: unknown }).schema === 'plastic_feature_graph_v1' && Array.isArray((g as { items?: unknown }).items);

function unitCount(item: PlasticGraphItem): number {
  const key = COUNTED_BY_ATTRIBUTE[item.feature_type];
  const v = key ? item.attributes[key] : undefined;
  return typeof v === 'number' && v > 0 ? v : 1;
}

export function groupFeatures(items: readonly PlasticGraphItem[]): FeatureGroup[] {
  const by = new Map<string, PlasticGraphItem[]>();
  for (const i of items) by.set(i.feature_type, [...(by.get(i.feature_type) ?? []), i]);
  const rank = (t: string) => { const i = ORDER.indexOf(t); return i === -1 ? ORDER.length : i; };
  return [...by.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([type, list]) => ({
      type,
      count: list.reduce((n, i) => n + unitCount(i), 0),
      items: list,
      reading: list.map((i) => i.attributes.reading).find((r): r is string => typeof r === 'string') ?? null,
    }));
}

/** What to say about a feature type that was not assessed. */
export function notAssessed(g: PlasticFeatureGraph): { type: string; reason: string }[] {
  return g.not_yet_recognized.map((type) => ({ type, reason: g.not_assessed_reasons?.[type] ?? 'not assessed from the CAD yet' }));
}

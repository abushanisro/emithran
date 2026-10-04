/**
 * feature_graph_v2 feature identification.
 *
 * Every feature_graph_v2 entry carries a reference catalog feature_type
 * (cad-engine/shared/reference_features.json, generated from
 * memory/sheetmetal/process/process_operations.csv and
 * memory/machining/operations_full__operations.csv) plus a geometric
 * `variant`. These helpers are the one place the UI decides what a feature is.
 */

export type FeatureGraphEntryLike = {
  type?: string;
  feature_type?: string;
  variant?: string;
};

/** "ReferenceType:variant", e.g. "SimpleHole:threaded". */
export function featureKey(f: FeatureGraphEntryLike): string {
  return `${f.type ?? f.feature_type}:${f.variant ?? 'default'}`;
}

/**
 * A plain round hole. Extruded-collar and perforation holes are SimpleHole
 * too, but carry their own variant (and, for sheet metal, their own
 * absolute-mm centroid convention), so they are deliberately excluded.
 */
export const isPlainHole = (f: FeatureGraphEntryLike): boolean =>
  f.feature_type === 'SimpleHole' && f.variant === 'through';

export const isExtrudedHole = (f: FeatureGraphEntryLike): boolean =>
  f.feature_type === 'SimpleHole' && f.variant === 'extruded';

export const isBend = (f: FeatureGraphEntryLike): boolean => f.feature_type === 'StraightBend';

/** The blank's cut boundary: outer perimeter plus every internal cut-out wall. */
export const isBlankProfile = (f: FeatureGraphEntryLike): boolean => f.feature_type === 'Blank';


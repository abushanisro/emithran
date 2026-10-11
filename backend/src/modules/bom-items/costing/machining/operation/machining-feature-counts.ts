/**
 * Feature counts read from the cad-engine's `machining_features` response.
 *
 * Its summaries are keyed by reference feature type (`feature_summary`,
 * e.g. "PocketV2") and by "type:variant" (`variant_summary`, e.g.
 * "SimpleHole:through") — cad-engine/machining/feature_models.py
 * MachiningFeatureTree.to_dict(). The pre-vocabulary keys ("pockets",
 * "through_hole", "blind_hole") no longer exist, and reading them silently
 * returned 0 for every machining part, so every consumer reads through here.
 */
interface MachiningFeatureCounts {
  /** Plain axial bores: SimpleHole through + blind (not threaded, cross or PCD-grouped). */
  drilledHoles: number;
  pockets: number;
}

/** null when the part has no machining_features (callers keep their non-CAD fallback). */
export function machiningFeatureCounts(machiningFeatures: unknown): MachiningFeatureCounts | null {
  const mf = machiningFeatures as {
    feature_summary?: Record<string, number>;
    variant_summary?: Record<string, number>;
  } | null | undefined;
  if (!mf?.feature_summary) return null;
  const variants = mf.variant_summary ?? {};
  return {
    drilledHoles: (variants['SimpleHole:through'] ?? 0) + (variants['SimpleHole:blind'] ?? 0),
    pockets: mf.feature_summary['PocketV2'] ?? 0,
  };
}

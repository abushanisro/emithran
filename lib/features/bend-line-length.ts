/**
 * The longest single bend line on the part, in mm, from the CAD analysis, or
 * null when the analysis carries no per-bend lengths (the caller then uses the
 * flat-pattern dimension as a labelled proxy). Same rule as the backend's
 * costing/shared/bend-lengths.ts: the engine's list first, else the lengths on
 * the bend features themselves.
 */
interface BendSource {
  summary?: { bendLengths?: unknown } | null;
  feature_graph_v2?: { features?: { feature_type?: unknown; occurrences?: { bend_length_mm?: unknown }[] }[] } | null;
}

export function longestBendLineMm(featureGraph: BendSource | null | undefined): number | null {
  const positive = (xs: unknown[]): number[] =>
    xs.filter((x): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0);

  const fromSummary = Array.isArray(featureGraph?.summary?.bendLengths) ? positive(featureGraph.summary.bendLengths) : [];
  const lengths = fromSummary.length > 0
    ? fromSummary
    : positive(
        (featureGraph?.feature_graph_v2?.features ?? [])
          .filter((f) => f.feature_type === 'StraightBend')
          .flatMap((f) => f.occurrences ?? [])
          .map((o) => o.bend_length_mm),
      );
  return lengths.length > 0 ? Math.max(...lengths) : null;
}

/**
 * The real length of each bend line on a part, in mm, from the CAD analysis.
 * Prefers the engine's own list (`summary.bendLengths`); for an analysis where
 * that list is empty, falls back to the per-bend lengths carried by the bend
 * features themselves (feature_graph_v2 StraightBend occurrences), which are
 * the same bends the CAD evidence popup highlights. Empty when the analysis has
 * neither: callers then use the flat-pattern dimension and say so.
 */
export function realBendLengthsMm(fg: any): number[] {
  const positive = (xs: unknown[]): number[] =>
    xs.filter((x): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0);

  const fromSummary = Array.isArray(fg?.summary?.bendLengths) ? positive(fg.summary.bendLengths) : [];
  if (fromSummary.length > 0) return fromSummary;

  const features: any[] = Array.isArray(fg?.feature_graph_v2?.features) ? fg.feature_graph_v2.features : [];
  return positive(
    features
      .filter((f) => f?.feature_type === 'StraightBend')
      .flatMap((f) => (Array.isArray(f.occurrences) ? f.occurrences : []))
      .map((o) => o?.bend_length_mm),
  );
}

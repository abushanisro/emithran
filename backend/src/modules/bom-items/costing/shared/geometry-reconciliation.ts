/**
 * Theory checks on a sheet-metal part's stored CAD analysis. The numbers the
 * quote is priced on (the summary) must agree with what the feature tree lists
 * and with geometry that follows from them (a hole of diameter d adds pi*d of
 * cut edge). A disagreement is reported with the real numbers so an engineer
 * can see where the analysis and the quote part ways; nothing is corrected here.
 */
export interface ReconciliationFinding {
  id: 'bend_count' | 'hole_count' | 'flat_pattern_holes' | 'cut_length_breakdown' | 'hole_cut_length';
  message: string;
}

interface Occurrence { [key: string]: unknown }
interface FeatureNode { feature_type?: string; radius_mm?: number; occurrences?: Occurrence[] }

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const r1 = (v: number) => Math.round(v * 10) / 10;

/** Counts per rounded radius, for naming which bend the two lists disagree on. */
function countByRadius(radii: number[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const r of radii) out.set(r1(r), (out.get(r1(r)) ?? 0) + 1);
  return out;
}

export function reconcileSheetGeometry(fg: any): ReconciliationFinding[] {
  const summary = fg?.summary;
  const features: FeatureNode[] = fg?.feature_graph_v2?.features ?? [];
  if (!summary || features.length === 0) return [];
  const out: ReconciliationFinding[] = [];

  // Bends: the summary's bend list (what the press brake line is priced on) vs the feature tree.
  const bendCount = num(summary.bendCount);
  const treeBends = features.filter((f) => f.feature_type === 'StraightBend');
  const treeBendCount = treeBends.reduce((s, f) => s + (f.occurrences?.length ?? 0), 0);
  if (bendCount !== null && bendCount !== treeBendCount) {
    const summaryRadii = countByRadius(Array.isArray(summary.bendRadii) ? summary.bendRadii.filter((r: unknown): r is number => num(r) !== null) : []);
    const treeRadii = countByRadius(treeBends.flatMap((f) => Array((f.occurrences?.length ?? 0)).fill(f.radius_mm ?? NaN)));
    const differing = [...summaryRadii].filter(([r, n]) => n !== (treeRadii.get(r) ?? 0))
      .map(([r, n]) => `R${r} mm (${n} in the summary, ${treeRadii.get(r) ?? 0} in the feature tree)`);
    out.push({
      id: 'bend_count',
      message: `Bend count: the quote counts ${bendCount} bends but the feature tree lists ${treeBendCount}${differing.length ? ` — differs at ${differing.join(', ')}` : ''}. One of the two analyses is wrong; the press brake line is priced on ${bendCount}.`,
    });
  }

  // Holes: summary vs feature tree vs the flat-pattern list the nesting uses.
  const holeCount = num(summary.holeCount);
  const treeHoles = features.filter((f) => f.feature_type === 'SimpleHole').reduce((s, f) => s + (f.occurrences?.length ?? 0), 0);
  if (holeCount !== null && holeCount !== treeHoles) {
    out.push({ id: 'hole_count', message: `Hole count: the quote counts ${holeCount} holes but the feature tree lists ${treeHoles}.` });
  }
  const flatHoles = Array.isArray(summary.flatPatternHolesMm) ? summary.flatPatternHolesMm.length : null;
  const unplaced = num(summary.flatPatternHolesUnplaced);
  if (holeCount !== null && flatHoles !== null && flatHoles + (unplaced ?? 0) !== holeCount) {
    out.push({
      id: 'flat_pattern_holes',
      message: `Flat pattern: ${flatHoles} of ${holeCount} holes are in the flat-pattern hole list that sheet nesting uses, and the analysis accounts for ${unplaced ?? 0} more as unplaced, so ${holeCount - flatHoles - (unplaced ?? 0)} hole(s) are unaccounted for.`,
    });
  }

  // Cut length: the three categories must add up to the total, and the holes alone cannot exceed their category.
  const cutLength = num(summary.cutLengthMm);
  const breakdown = summary.cutLengthBreakdownMm as Record<string, unknown> | undefined;
  const parts = breakdown ? ['outerProfile', 'circularHoles', 'internalProfiles'].map((k) => num(breakdown[k])) : [];
  if (cutLength !== null && parts.length === 3 && parts.every((p) => p !== null)) {
    const sum = (parts as number[]).reduce((a, b) => a + b, 0);
    if (Math.abs(sum - cutLength) > 0.5) {
      out.push({ id: 'cut_length_breakdown', message: `Cut length: the outer profile, circular holes and internal profiles add up to ${r1(sum)} mm but the quote uses ${r1(cutLength)} mm.` });
    }
    const diameters: number[] = Array.isArray(summary.holeDiameters) ? summary.holeDiameters.filter((d: unknown): d is number => num(d) !== null) : [];
    const holesTheory = diameters.reduce((s, d) => s + Math.PI * d, 0);
    const circular = parts[1] as number;
    if (diameters.length > 0 && circular < holesTheory * 0.98) {
      out.push({ id: 'hole_cut_length', message: `Cut length: ${diameters.length} holes need at least ${r1(holesTheory)} mm of cut edge (pi x diameter each) but the circular-hole category holds ${r1(circular)} mm.` });
    }
  }
  return out;
}

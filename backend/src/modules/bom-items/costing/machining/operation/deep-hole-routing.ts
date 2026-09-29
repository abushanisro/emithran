// Pure, framework-free deep-hole routing — no NestJS/DB dependency, so this
// is directly unit-testable without mocking Supabase (this project's
// standing rule against mocked-Supabase spec files).
//
// Root cause this closes (2026-09-18): the Machining Process page lists ~40
// real machine categories, but only Milling/Turning (cost-machining-engine.ts) had
// a cost engine. Two of the real, staged-but-unused categories — "Gun
// Drill" and "Deep Bore Machine" (real machine fleets, real
// tblGunDrilling/deep_bore_drill_lookup physics, migrations 737/738/752/753
// already activate their process_calculator_mappings rows) — need ZERO new
// CAD work: cad-engine's own cnc_feature_recognizer.py already computes a
// real per-hole ld_ratio (_annotate_hole_depth) and documents the real
// threshold ("L/D > 3: standard twist drilling needs peck cycles; > 5 needs
// parabolic-flute or gun drilling"). This module recomputes that same ratio
// directly from the real depth_mm/diameter_mm fields operation-sequencer.ts
// already trusts (occurrences[i].depth_mm, f.diameter_mm) rather than
// depending on an unverified downstream JSON field path for the CAD
// engine's own deep_hole/ld_ratio annotation.
//
// A part with one very deep hole among otherwise ordinary features still
// gets that ONE hole gun-drilled/deep-bored on a real, separate machine —
// this is a genuine per-occurrence split, not a whole-part classification.

export interface FeatureOccurrenceLike {
  depth_mm?: number;
  material_removed_mm3?: number;
  [key: string]: unknown;
}

export interface HoleFeatureLike {
  feature_type?: string;
  variant?: string;
  diameter_mm?: number;
  occurrences?: FeatureOccurrenceLike[];
  [key: string]: unknown;
}

export interface DeepHoleCandidate {
  diameterMm: number;
  depthMm: number;
  count: number;
}

export interface DeepHoleSplitResult {
  /** fgv2Features with deep-hole occurrences removed from their feature's
   * occurrence list (feature dropped entirely if it becomes empty) — pass
   * this, not the original array, into buildOperationSequence() so the
   * regular "Drill" op never double-counts a hole billed via Gun
   * Drilling/Deep Bore Machine below. */
  filteredFeatures: unknown[];
  gunDrillCandidates: DeepHoleCandidate[];
  deepBoreCandidates: DeepHoleCandidate[];
}

// Routing limits come from memory/Machining/lookup/tblOperationSizeRanges
// (staged by migration 748), never from code constants:
//   Gun Drilling       LowerBound 10   "Ratio of L/D"
//   Deep Boring        LowerBound 38.1 "Minimum diameter"
//   Deep Boring Ratio  LowerBound 4    "Ratio of L/D"
// Deep Boring is checked first: it is the range the reference defines for
// large holes, and gun drills are small-diameter tooling. Holes below both
// ranges (incl. "Deep Drilling", L/D >= 3) stay ordinary drilling on the
// part's own machine.
export interface DeepHoleRules {
  gunDrillMinLd: number;
  deepBoreMinLd: number;
  deepBoreMinDiameterMm: number;
}

/** Reads the three limits from the staged tblOperationSizeRanges rows; null
 *  (with what is missing) when any of them is absent — routing is then not
 *  applied rather than guessed. */
export function resolveDeepHoleRules(
  rows: ReadonlyArray<{ OperationName?: string; LowerBound?: number; Comment?: string }> | null | undefined,
): { rules: DeepHoleRules | null; missing: string[] } {
  const lower = (op: string, comment: string): number | null => {
    const r = (rows ?? []).find((x) => x.OperationName === op && x.Comment === comment);
    const v = r ? Number(r.LowerBound) : NaN;
    return Number.isFinite(v) && v > 0 ? v : null;
  };
  const gunDrillMinLd = lower('Gun Drilling', 'Ratio of L/D');
  const deepBoreMinLd = lower('Deep Boring Ratio', 'Ratio of L/D');
  const deepBoreMinDiameterMm = lower('Deep Boring', 'Minimum diameter');
  const missing = [
    gunDrillMinLd == null ? 'Gun Drilling L/D' : null,
    deepBoreMinLd == null ? 'Deep Boring Ratio L/D' : null,
    deepBoreMinDiameterMm == null ? 'Deep Boring minimum diameter' : null,
  ].filter((m): m is string => m != null);
  if (missing.length > 0) return { rules: null, missing };
  return { rules: { gunDrillMinLd: gunDrillMinLd!, deepBoreMinLd: deepBoreMinLd!, deepBoreMinDiameterMm: deepBoreMinDiameterMm! }, missing };
}

// Plain drilled holes: reference feature SimpleHole, through or blind.
const PLAIN_HOLE_VARIANTS = new Set(['through', 'blind']);

export function splitDeepHoleOccurrences(
  fgv2Features: unknown[] | null | undefined,
  rules: DeepHoleRules | null,
): DeepHoleSplitResult {
  if (!rules || !Array.isArray(fgv2Features) || fgv2Features.length === 0) {
    return { filteredFeatures: fgv2Features ?? [], gunDrillCandidates: [], deepBoreCandidates: [] };
  }

  const gunDrillCandidates: DeepHoleCandidate[] = [];
  const deepBoreCandidates: DeepHoleCandidate[] = [];
  const filteredFeatures: unknown[] = [];

  for (const raw of fgv2Features) {
    const f = raw as HoleFeatureLike;
    const isPlainHole = f.feature_type === 'SimpleHole' && PLAIN_HOLE_VARIANTS.has(f.variant ?? '');
    const diamMm = typeof f.diameter_mm === 'number' ? f.diameter_mm : 0;
    const occurrences = Array.isArray(f.occurrences) ? f.occurrences : [];

    // Deep-hole routing only applies to plain drilled holes — a tapped/
    // counterbored/countersunk hole's secondary op (thread/bore/chamfer)
    // still happens after the fact regardless of how the pilot hole was
    // drilled, and those feature types don't carry an independent depth
    // signal this cleanly. Scoped, disclosed, not a fabricated generalization.
    if (!isPlainHole || diamMm <= 0 || occurrences.length === 0) {
      filteredFeatures.push(raw);
      continue;
    }

    const kept: FeatureOccurrenceLike[] = [];
    const gun = { count: 0, depthSum: 0 };
    const bore = { count: 0, depthSum: 0 };

    for (const occ of occurrences) {
      const depthMm = typeof occ.depth_mm === 'number' ? occ.depth_mm : 0;
      const ld = depthMm > 0 ? depthMm / diamMm : 0;
      if (diamMm >= rules.deepBoreMinDiameterMm && ld >= rules.deepBoreMinLd) {
        bore.count += 1; bore.depthSum += depthMm;
      } else if (ld >= rules.gunDrillMinLd) {
        gun.count += 1; gun.depthSum += depthMm;
      } else {
        kept.push(occ);
      }
    }

    if (gun.count > 0) gunDrillCandidates.push({ diameterMm: diamMm, depthMm: gun.depthSum / gun.count, count: gun.count });
    if (bore.count > 0) deepBoreCandidates.push({ diameterMm: diamMm, depthMm: bore.depthSum / bore.count, count: bore.count });

    if (kept.length > 0) {
      filteredFeatures.push({ ...f, occurrences: kept });
    }
    // else: every occurrence of this feature was a deep hole — drop the
    // feature entirely so buildOperationSequence emits no regular Drill op
    // for it (it's fully represented by the candidate(s) above instead).
  }

  return { filteredFeatures, gunDrillCandidates, deepBoreCandidates };
}

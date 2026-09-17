// Pure, framework-free deep-hole routing — no NestJS/DB dependency, so this
// is directly unit-testable without mocking Supabase (this project's
// standing rule against mocked-Supabase spec files).
//
// Root cause this closes (2026-09-18): the Machining Process page lists ~40
// real machine categories, but only Milling/Turning (cost-cnc-engine.ts) had
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
  type?: string;
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

// Real, sourced thresholds — not tuned/fabricated:
// - LD > 5: cad-engine's own documented gun-drilling/deep-boring threshold
//   (_annotate_hole_depth in cnc_feature_recognizer.py).
// - 50mm diameter split: the real Gun Drill fleet's own max diameter
//   (memory/machining/machine/gun_drill_usa.json: 3-50mm) vs. the real Deep
//   Bore Machine fleet's own min diameter (deep_bore_machine_usa.json:
//   50-600mm) — a genuinely disjoint real capability split, not a guess.
export const DEEP_HOLE_LD_THRESHOLD = 5;
export const GUN_DRILL_MAX_DIAMETER_MM = 50;

const PLAIN_HOLE_TYPES = new Set(['through_hole', 'blind_hole']);

export function splitDeepHoleOccurrences(
  fgv2Features: unknown[] | null | undefined,
): DeepHoleSplitResult {
  if (!Array.isArray(fgv2Features) || fgv2Features.length === 0) {
    return { filteredFeatures: fgv2Features ?? [], gunDrillCandidates: [], deepBoreCandidates: [] };
  }

  const gunDrillCandidates: DeepHoleCandidate[] = [];
  const deepBoreCandidates: DeepHoleCandidate[] = [];
  const filteredFeatures: unknown[] = [];

  for (const raw of fgv2Features) {
    const f = raw as HoleFeatureLike;
    const ft = (f.feature_type ?? f.type ?? '').toString().toLowerCase();
    const diamMm = typeof f.diameter_mm === 'number' ? f.diameter_mm : 0;
    const occurrences = Array.isArray(f.occurrences) ? f.occurrences : [];

    // Deep-hole routing only applies to plain drilled holes — a tapped/
    // counterbored/countersunk hole's secondary op (thread/bore/chamfer)
    // still happens after the fact regardless of how the pilot hole was
    // drilled, and those feature types don't carry an independent depth
    // signal this cleanly. Scoped, disclosed, not a fabricated generalization.
    if (!PLAIN_HOLE_TYPES.has(ft) || diamMm <= 0 || occurrences.length === 0) {
      filteredFeatures.push(raw);
      continue;
    }

    const kept: FeatureOccurrenceLike[] = [];
    let deepCount = 0;
    let deepDepthSum = 0;

    for (const occ of occurrences) {
      const depthMm = typeof occ.depth_mm === 'number' ? occ.depth_mm : 0;
      const ld = depthMm > 0 ? depthMm / diamMm : 0;
      if (ld > DEEP_HOLE_LD_THRESHOLD) {
        deepCount += 1;
        deepDepthSum += depthMm;
      } else {
        kept.push(occ);
      }
    }

    if (deepCount > 0) {
      const avgDepthMm = deepDepthSum / deepCount;
      const candidate: DeepHoleCandidate = { diameterMm: diamMm, depthMm: avgDepthMm, count: deepCount };
      if (diamMm <= GUN_DRILL_MAX_DIAMETER_MM) gunDrillCandidates.push(candidate);
      else deepBoreCandidates.push(candidate);
    }

    if (kept.length > 0) {
      filteredFeatures.push({ ...f, occurrences: kept });
    }
    // else: every occurrence of this feature was a deep hole — drop the
    // feature entirely so buildOperationSequence emits no regular Drill op
    // for it (it's fully represented by the candidate(s) above instead).
  }

  return { filteredFeatures, gunDrillCandidates, deepBoreCandidates };
}

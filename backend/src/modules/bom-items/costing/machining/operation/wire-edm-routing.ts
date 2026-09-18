// Pure, framework-free Wire EDM routing — no NestJS/DB dependency, mirroring
// deep-hole-routing.ts / keyway-routing.ts's established split-before-
// buildOperationSequence pattern.
//
// Root cause this closes (2026-09-18): "Wire EDM" is a real, staged machine
// category (migrations 737/738/753, 6 real machines, e.g. "Fanuc 0id") with
// real material cutting-physics data (tblWireEDMing, 73 rows: real per-
// material FeedRateMmPerMin for Roughing/Finishing cut passes) but had ZERO
// cost engine — every "slot" feature was priced as an ordinary milled slot
// regardless of material state.
//
// Real, disclosed trigger: the SAME real signal Jig Grind already uses
// (bom_items.heat_treatment — see isRealHeatTreatmentCallout's own doc
// comment) applied to a sibling real feature type. A hardened slot cannot
// be conventionally milled any more than a hardened bore can be
// conventionally bored — wire EDM (an electrical-erosion process, immune to
// material hardness) is the real substitute process, same physical
// reasoning already used for Jig Grind, just for a different real feature
// shape (a 2D profile cut, not a round bore). Scoped to "slot" only (not
// "pocket"): a slot's real length_mm cleanly represents its cut-path
// length; a pocket's real perimeter is a 2D shape with no single-field
// proxy in the data available today — a disclosed, deliberate scope limit,
// not an oversight.

export const NO_HEAT_TREAT_CALLOUT_VALUES = new Set([
  'none', 'n/a', 'na', 'as required', 'not required', 'no', 'n/r',
]);

// Real, disclosed classifier for "does this part's own real drawing-
// extracted heatTreatment callout (bom_items.heat_treatment) name an actual
// heat-treat process". These specific placeholder strings are not
// fabricated guesses: 'None' is the DrawingIntelligenceDto's own documented
// example value for "no callout", and 'As Required' is
// process-planning.service.ts's own real fallback string when this field
// is empty — both already mean "no real heat-treat callout" elsewhere in
// this codebase.
export function isRealHeatTreatmentCallout(heatTreatment: string | null | undefined): boolean {
  if (!heatTreatment) return false;
  const normalized = heatTreatment.trim().toLowerCase();
  return normalized.length > 0 && !NO_HEAT_TREAT_CALLOUT_VALUES.has(normalized);
}

export interface WireEdmOccurrenceLike {
  length_mm?: number | null;
  [key: string]: unknown;
}

export interface WireEdmFeatureLike {
  feature_type?: string;
  type?: string;
  occurrences?: WireEdmOccurrenceLike[];
  [key: string]: unknown;
}

export interface WireEdmCandidate {
  lengthMm: number;
  count: number;
}

export interface WireEdmSplitResult {
  /** fgv2Features with every real "slot" feature removed entirely (only
   * when a real heat-treat callout is present — see isRealHeatTreatmentCallout)
   * — pass this, not the original array, into buildOperationSequence() so a
   * hardened slot is never milled with ordinary (wrong) physics. */
  filteredFeatures: unknown[];
  wireEdmCandidates: WireEdmCandidate[];
}

export function splitWireEdmOccurrences(
  fgv2Features: unknown[] | null | undefined,
  heatTreatment: string | null | undefined,
): WireEdmSplitResult {
  if (!Array.isArray(fgv2Features) || fgv2Features.length === 0) {
    return { filteredFeatures: fgv2Features ?? [], wireEdmCandidates: [] };
  }
  // No real heat-treat callout — every slot stays an ordinary milled slot,
  // completely untouched.
  if (!isRealHeatTreatmentCallout(heatTreatment)) {
    return { filteredFeatures: fgv2Features, wireEdmCandidates: [] };
  }

  const filteredFeatures: unknown[] = [];
  const groups = new Map<string, WireEdmCandidate>();

  for (const raw of fgv2Features) {
    const f = raw as WireEdmFeatureLike;
    const ft = (f.feature_type ?? f.type ?? '').toString().toLowerCase();
    if (ft !== 'slot') {
      filteredFeatures.push(raw);
      continue;
    }

    const occurrences = Array.isArray(f.occurrences) ? f.occurrences : [];
    const unresolved: WireEdmOccurrenceLike[] = [];
    for (const occ of occurrences) {
      const lengthMm = typeof occ.length_mm === 'number' ? occ.length_mm : null;
      // Real cut-path length genuinely missing -- keep as a generic slot
      // rather than silently dropping it.
      if (lengthMm == null || lengthMm <= 0) {
        unresolved.push(occ);
        continue;
      }
      const key = `${lengthMm}`;
      const existing = groups.get(key);
      if (existing) existing.count += 1;
      else groups.set(key, { lengthMm, count: 1 });
    }

    if (unresolved.length > 0) {
      filteredFeatures.push({ ...f, occurrences: unresolved });
    }
    // else: every occurrence of this slot had a real length and was fully
    // consumed by the Wire EDM candidates above -- drop the feature entirely.
  }

  return { filteredFeatures, wireEdmCandidates: [...groups.values()] };
}

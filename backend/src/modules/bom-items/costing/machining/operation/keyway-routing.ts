// Which keyways are broached and which are milled. Pure; no NestJS or database dependency.
//
// The CAD engine labels an elongated, walled channel a "Keyway" (cad-engine machining_feature_recognizer.py). Two different operations cut one:
//   broached   a keyway open at both ends, so a broach can be drawn straight through it (the keyway of a hub bore): its own line on a broaching machine,
//              timed by the reference broach tables (computeKeywayBroachingLine in cost-machining-engine.ts);
//   milled     every other keyway: one closed at an end (a broach cannot enter or leave it), or one whose width no reference broach cuts. It stays in the
//              feature list and the sequencer mills it (the catalog's "Rough Milling // Keyway").
// Broached keyways are taken out of the feature list here, before buildOperationSequence sees them, so none is costed twice or with the wrong physics.
//
// Open or closed is measured, not assumed: the engine reports walled_fraction, the share of the keyway floor's outline that has a wall standing on it. Open at
// both ends, only the two long sides are walled: 2L / (2L + 2W). Any more than that and an end is closed.

interface KeywayOccurrenceLike {
  length_mm?: number | null;
  width_mm?: number | null;
  depth_mm?: number | null;
  /** Share of the floor's outline that is walled (cad-engine); absent on an analysis older than the measurement. */
  walled_fraction?: number | null;
  [key: string]: unknown;
}

/** Slack on the open-ended share for the engine's rounding and corner radii; far below the step to one closed end (W / (2L + 2W)). */
const OPEN_END_TOLERANCE = 0.02;

/**
 * Whether the keyway is closed at an end, so no broach passes through it. Unknown (no measurement) is not closed: an older analysis keeps the routing it had.
 */
export function isClosedKeyway(lengthMm: number, widthMm: number, walledFraction: number | null | undefined): boolean {
  if (typeof walledFraction !== 'number') return false;
  const openBothEnds = (2 * lengthMm) / (2 * lengthMm + 2 * widthMm);
  return walledFraction > openBothEnds + OPEN_END_TOLERANCE;
}

interface KeywayFeatureLike {
  feature_type?: string;
  occurrences?: KeywayOccurrenceLike[];
  [key: string]: unknown;
}

interface KeywayCandidate {
  lengthMm: number;
  widthMm: number;
  depthMm: number;
  count: number;
}

interface KeywaySplitResult {
  /** fgv2Features with every real "keyway" feature removed entirely — pass
   * this, not the original array, into buildOperationSequence() so a keyway
   * never falls into its generic default-case milling cost. */
  filteredFeatures: unknown[];
  keywayCandidates: KeywayCandidate[];
}

/** The narrowest and widest keyway any broach in the reference tables cuts; null when the tables hold no width. */
export function broachWidthRangeMm(ref: { pullRows: any[]; shimRows: any[] } | null | undefined): { min: number; max: number } | null {
  const widths = [...(ref?.pullRows ?? []), ...(ref?.shimRows ?? [])]
    .map((r) => r['Keyway Width (mm)']).filter((w): w is number => typeof w === 'number' && w > 0);
  return widths.length > 0 ? { min: Math.min(...widths), max: Math.max(...widths) } : null;
}

export function splitKeywayOccurrences(
  fgv2Features: unknown[] | null | undefined,
  // The widths the reference broaches cut (broachWidthRangeMm). Omitted = no width limit.
  broachWidthMm?: { min: number; max: number } | null,
): KeywaySplitResult {
  if (!Array.isArray(fgv2Features) || fgv2Features.length === 0) {
    return { filteredFeatures: fgv2Features ?? [], keywayCandidates: [] };
  }

  const filteredFeatures: unknown[] = [];
  // Group identical real dimensions (length/width/depth) together so N
  // physically-identical keyways on one part become one candidate with
  // count=N, the same shape computeDeepHoleLine's candidates already use.
  const groups = new Map<string, KeywayCandidate>();

  for (const raw of fgv2Features) {
    const f = raw as KeywayFeatureLike;
    if (f.feature_type !== 'Keyway') {
      filteredFeatures.push(raw);
      continue;
    }

    const occurrences = Array.isArray(f.occurrences) ? f.occurrences : [];
    const unresolved: KeywayOccurrenceLike[] = [];
    for (const occ of occurrences) {
      const lengthMm = typeof occ.length_mm === 'number' ? occ.length_mm : null;
      const widthMm = typeof occ.width_mm === 'number' ? occ.width_mm : null;
      const depthMm = typeof occ.depth_mm === 'number' ? occ.depth_mm : null;
      // Not broached, so left for the sequencer to mill: a keyway with a dimension missing (an older analysis), one no reference broach is wide or narrow
      // enough for, and one closed at an end.
      const outsideBroaches = broachWidthMm != null && widthMm != null && (widthMm < broachWidthMm.min || widthMm > broachWidthMm.max);
      if (lengthMm == null || widthMm == null || depthMm == null || outsideBroaches || isClosedKeyway(lengthMm, widthMm, occ.walled_fraction)) {
        unresolved.push(occ);
        continue;
      }
      const key = `${lengthMm}|${widthMm}|${depthMm}`;
      const existing = groups.get(key);
      if (existing) existing.count += 1;
      else groups.set(key, { lengthMm, widthMm, depthMm, count: 1 });
    }

    if (unresolved.length > 0) {
      filteredFeatures.push({ ...f, occurrences: unresolved });
    }
    // else: every occurrence of this feature had real dims and was fully
    // consumed by the keyway candidates above — drop the feature entirely.
  }

  return { filteredFeatures, keywayCandidates: [...groups.values()] };
}

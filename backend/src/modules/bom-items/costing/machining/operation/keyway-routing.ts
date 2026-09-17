// Pure, framework-free keyway routing — no NestJS/DB dependency, mirroring
// deep-hole-routing.ts's established split-before-buildOperationSequence
// pattern.
//
// Root cause this closes (2026-09-17): cnc_feature_recognizer.py already
// detects "keyway" as its own real, distinct feature type (FeatureType
// registry), but build_feature_graph_v2_from_cnc was deliberately collapsing
// it into generic "slot" output — a design choice made only because
// operation-sequencer.ts had no dedicated keyway handling at the time (see
// that file's own now-corrected comment). That collapse is now removed on
// the cad-engine side (cnc_feature_recognizer.py, geo_v44) so "keyway"
// reaches the backend as its own real type. operation-sequencer.ts's switch
// still has no "keyway" case, and correctly so: a keyway is not milled at
// all — it's broached, a fundamentally different, real machine_class
// ("broach", migrations 737/738/753 already stage/activate 4 real linear-
// stroke machines for it) with its own real physics (linear stroke speed,
// not rotary MRR). Rather than add a fake "keyway" case to the milling
// sequencer that would cost it with the wrong physics, every keyway
// occurrence is pulled out here — before buildOperationSequence ever sees
// it — and costed by a dedicated Keyway Broaching process line instead
// (computeKeywayBroachingLine in cost-cnc-engine.ts). Without this split,
// an un-intercepted "keyway" feature_type would fall into
// operation-sequencer.ts's `default:` case (generic volume-based Adaptive
// Rough costing) — a real, worse regression than the old slot-collapse,
// not an improvement, which is why the CAD-side fix and this module must
// land together.

export interface KeywayOccurrenceLike {
  length_mm?: number | null;
  width_mm?: number | null;
  depth_mm?: number | null;
  [key: string]: unknown;
}

export interface KeywayFeatureLike {
  feature_type?: string;
  type?: string;
  occurrences?: KeywayOccurrenceLike[];
  [key: string]: unknown;
}

export interface KeywayCandidate {
  lengthMm: number;
  widthMm: number;
  depthMm: number;
  count: number;
}

export interface KeywaySplitResult {
  /** fgv2Features with every real "keyway" feature removed entirely — pass
   * this, not the original array, into buildOperationSequence() so a keyway
   * never falls into its generic default-case milling cost. */
  filteredFeatures: unknown[];
  keywayCandidates: KeywayCandidate[];
}

export function splitKeywayOccurrences(
  fgv2Features: unknown[] | null | undefined,
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
    const ft = (f.feature_type ?? f.type ?? '').toString().toLowerCase();
    if (ft !== 'keyway') {
      filteredFeatures.push(raw);
      continue;
    }

    const occurrences = Array.isArray(f.occurrences) ? f.occurrences : [];
    const unresolved: KeywayOccurrenceLike[] = [];
    for (const occ of occurrences) {
      const lengthMm = typeof occ.length_mm === 'number' ? occ.length_mm : null;
      const widthMm = typeof occ.width_mm === 'number' ? occ.width_mm : null;
      const depthMm = typeof occ.depth_mm === 'number' ? occ.depth_mm : null;
      // Real dims genuinely missing (e.g. an older cached geometry hash from
      // before geo_v44) — keep as a generic feature rather than silently
      // dropping it, so it still gets SOME cost (default-case milling) until
      // the part is reprocessed with real length/width/depth.
      if (lengthMm == null || widthMm == null || depthMm == null) {
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

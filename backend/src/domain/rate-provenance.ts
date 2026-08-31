// Maps the existing, already-real rate-source tiers (MHRRateInput['source'],
// LhrRateSource) onto the REAL | BENCHMARK | ESTIMATE | REFERENCE taxonomy —
// a lookup table, not a second competing enum. Every existing value is
// mapped explicitly below; there is no catch-all/default case, so adding a
// new rate-source value anywhere upstream is a compile error here until it's
// deliberately classified, not a silent fallthrough.
//
// Grounded in the actual call sites (bom-items.service.ts), not guessed:
//   'default_rate'    — benchmarkMap.get(cls): a location benchmark-rate
//                        table lookup, not a specific machine (bom-items.
//                        service.ts:1793,2034) → BENCHMARK.
//   'tier_synthetic'   — Math.round(baseMhrRate * TIER_RATE_MULT[tier]): a
//                        computed value for a route-comparison slot with no
//                        real machine on file (bom-items.service.ts:5761,
//                        commented "expected, suppress" at :3069) → ESTIMATE.
//   'benchmark_override' — an explicit "DB rate was anomalous — using
//                        location benchmark rate" override (bom-items.
//                        service.ts:1865-1866) → BENCHMARK.
//   'mhr_machine_specific' — "an explicit, approved override" per its own
//                        doc comment in cost-engine.ts → REAL.
//   'lhr_cross_location' — a real DB row, but borrowed from a different
//                        location as a substitute, not this location's own
//                        data → REFERENCE (real data, reference use).
import type { MHRRateInput, LhrRateSource } from './cost-result';

export type RateProvenanceTier = 'REAL' | 'BENCHMARK' | 'ESTIMATE' | 'REFERENCE' | 'NO_RATE';

const MHR_SOURCE_TO_PROVENANCE: Record<MHRRateInput['source'], RateProvenanceTier> = {
  mhr_database: 'REAL',
  benchmark_override: 'BENCHMARK',
  default_rate: 'BENCHMARK',
  tier_synthetic: 'ESTIMATE',
  no_db_rate: 'NO_RATE',
};

const LHR_SOURCE_TO_PROVENANCE: Record<LhrRateSource, RateProvenanceTier> = {
  lhr_database: 'REAL',
  mhr_machine_specific: 'REAL',
  lhr_benchmark: 'BENCHMARK',
  lhr_cross_location: 'REFERENCE',
  no_lhr_rate: 'NO_RATE',
};

export function provenanceOfMhrSource(source: MHRRateInput['source']): RateProvenanceTier {
  return MHR_SOURCE_TO_PROVENANCE[source];
}

export function provenanceOfLhrSource(source: LhrRateSource | null | undefined): RateProvenanceTier {
  if (source == null) return 'NO_RATE';
  return LHR_SOURCE_TO_PROVENANCE[source];
}

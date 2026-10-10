// Maps the rate-source values (MHRRateInput['source'], LhrRateSource) onto the
// REAL | BENCHMARK | ESTIMATE | REFERENCE | NO_RATE taxonomy. Every value is
// mapped explicitly; there is no catch-all, so a new upstream source value is a
// compile error here until it is deliberately classified.
//
// Since migration 805 and the memory/-only rate resolution, only two sources
// exist on each side: a real memory/-backed HR Rates machine (REAL) or none
// (NO_RATE). The benchmark, synthetic-tier, cross-location and wage-grade
// sources this table used to classify were removed as substitutes.
import type { MHRRateInput, LhrRateSource } from './cost-result';

type RateProvenanceTier = 'REAL' | 'BENCHMARK' | 'ESTIMATE' | 'REFERENCE' | 'NO_RATE';

const MHR_SOURCE_TO_PROVENANCE: Record<MHRRateInput['source'], RateProvenanceTier> = {
  mhr_database: 'REAL',
  no_db_rate: 'NO_RATE',
};

const LHR_SOURCE_TO_PROVENANCE: Record<LhrRateSource, RateProvenanceTier> = {
  mhr_machine_specific: 'REAL',
  no_lhr_rate: 'NO_RATE',
};

export function provenanceOfMhrSource(source: MHRRateInput['source']): RateProvenanceTier {
  return MHR_SOURCE_TO_PROVENANCE[source];
}

export function provenanceOfLhrSource(source: LhrRateSource | null | undefined): RateProvenanceTier {
  if (source == null) return 'NO_RATE';
  return LHR_SOURCE_TO_PROVENANCE[source];
}

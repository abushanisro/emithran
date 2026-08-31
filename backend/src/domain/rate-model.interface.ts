// NET NEW — today's rate resolution happens via bespoke method calls
// (mhr.service.ts's economics-resolver, bom-items.service.ts's
// resolveLHRRates 4-pass logic, sheet-metal-lookup.service.ts's ~24 ad hoc
// getters) with no single uniform "ask for a rate" request/response shape.
// This is the target contract for the Phase 5 Rate Resolution Service —
// defined now so Phase 3's MachineEconomicsResolver can be written against
// a stable shape from the start rather than inventing its own.
import type { RateProvenanceTier } from './rate-provenance';

export type RateType = 'reference' | 'budget' | 'custom';

export type RateComponentKind =
  | 'machine' | 'labor' | 'directOverhead' | 'indirectOverhead'
  | 'energy' | 'consumable' | 'other';

export interface RateResolutionRequest {
  locationId: string;
  factoryId: string;
  resourceId?: string;   // machine_master id, when resolving a machine-specific rate
  processId?: string;
  effectiveDate: string; // YYYY-MM-DD — rates are versioned/effective-dated, never "the current value"
  rateType: RateType;
  component: RateComponentKind;
}

/**
 * `provenance: 'NO_RATE'` is a real, valid, EXPECTED result — never replace
 * it with a hardcoded 0 (the exact anti-pattern found in today's
 * `economics-resolver.ts`). A caller receiving NO_RATE must surface an
 * explicit warning, not silently price the operation at zero.
 */
export interface RateResolutionResult {
  value: number | null;
  currencyCode: string;
  provenance: RateProvenanceTier;
  sourceRef?: string;    // e.g. a machine_location_economics row id, or a benchmark table row id
  effectiveFrom?: string;
  effectiveTo?: string | null;
}

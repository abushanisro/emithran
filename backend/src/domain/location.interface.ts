// NET NEW — nothing today models Location/Factory as first-class entities.
// `LOCATION_INFO` (default-rates.ts) is a flat, hardcoded location→currency
// map with no concept of "factory" at all (no REAL vs BENCHMARK distinction,
// no way to have two factories in one location). This is the target shape
// Phase 2 migrates LOCATION_INFO's consumers onto — defined now so Phase
// 3+ (which needs `factory_id` on machine/material economics rows) has a
// stable contract to code against before Phase 2's DB tables exist.

export interface Location {
  id: string;
  code: string;                 // 'USA' | 'India' | ... — matches LOCATION_INFO's current keys verbatim, no renaming
  name: string;
  defaultCurrencyCode: string;  // ISO 4217, e.g. 'USD' — matches LOCATION_INFO[code].code today
  defaultCurrencySymbol: string;
}

/**
 * A Digital Factory within a location. `isBenchmark: true` means this
 * factory's economics come from machine_library-style benchmark/reference
 * data (today's entire fleet, per the Phase 0 audit) rather than a real
 * shop's own owned equipment — the Benchmark-vs-Real-Factory distinction
 * the target architecture requires. Never infer this from data quality;
 * it is set explicitly when a factory is created.
 */
export interface Factory {
  id: string;
  locationId: string;
  name: string;
  isBenchmark: boolean;
}

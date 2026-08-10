// Generic Cost Guide manual-override resolution — see migration 420's own
// comment for the root cause this replaces (a thickness override that either
// would have been silently ignored by costing, or would have destroyed the
// real CAD-extracted reference value, if it had been wired into the same
// column CAD analysis writes to).
//
// One override bag (bom_items.scenario_overrides, a JSONB column) instead of
// a dedicated "<field>_override" column per scenario input — a new override
// (material, batch size, blank stock, ...) is one new resolveEffective()
// call at each costing entry point, not a new migration + new column + new
// plumbing duplicated into getCostSummary/getRouteComparison/getCandidateRoutes
// each time.
//
// Priority, identical for every override key: manual override (if the admin
// explicitly set one) > real CAD-extracted/auto-detected value (if analysis
// found one) > the bom_items row's own fallback column. This function is the
// SINGLE place that priority is encoded — every costing entry point calls it
// instead of duplicating the `??` chain, so they can never drift apart.
export function resolveEffective<T>(
  overrideValue: T | null | undefined,
  detectedValue: T | null | undefined,
  fallbackValue: T,
): T {
  if (overrideValue != null) return overrideValue;
  if (detectedValue != null) return detectedValue;
  return fallbackValue;
}

// Sheet thickness specifically — reads the override bag's 'sheetThicknessMm'
// key. Kept as a named wrapper (rather than every call site reaching into
// scenarioOverrides directly) so the JSON key name and its numeric coercion
// live in exactly one place.
export function resolveEffectiveSheetThicknessMm(
  scenarioOverrides: Record<string, unknown> | null | undefined,
  detectedSheetThicknessMm: number | null | undefined,
  fallbackSheetThicknessMm: number,
): number {
  const raw = scenarioOverrides?.['sheetThicknessMm'];
  const overrideValue = typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : null;
  return resolveEffective(overrideValue, detectedSheetThicknessMm, fallbackSheetThicknessMm);
}

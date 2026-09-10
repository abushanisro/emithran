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

// ── Currency & Ask Price (see common/fx/* for the FX architecture these feed) ──
//
// scenarioCurrency / askPrice / fxSnapshot are written by the Currency & Ask
// Price widget via the SAME merge_scenario_overrides RPC as every other key
// above — no new persistence endpoint. fxSnapshot is the auditable record of
// EXACTLY which rate was applied (provider/source/rate/date/type) so that
// reopening a scenario reproduces the same cost even if today's reference
// rate has since changed (see resolveDisplayCurrency in bom-items.service.ts,
// which uses this stored rate directly and never re-fetches).

export type ScenarioFxRateType = 'reference' | 'budget' | 'custom';

export interface ScenarioFxSnapshot {
  factoryCurrency: string;
  scenarioCurrency: string;
  provider: string | null;
  source: string | null;
  rate: number;
  rateDate: string | null;
  rateType: ScenarioFxRateType;
  retrievedAt: string;
  customReason?: string;
}

export interface ScenarioAskPrice {
  amount: number;
  currency: string;
}

/** The user-selected scenario/display currency (ISO 4217), if one has ever been set. */
export function resolveScenarioCurrency(
  scenarioOverrides: Record<string, unknown> | null | undefined,
): string | null {
  const raw = scenarioOverrides?.['scenarioCurrency'];
  return typeof raw === 'string' && /^[A-Z]{3}$/.test(raw) ? raw : null;
}

/** The last resolved FX snapshot, if one is on file and well-formed. Never guesses a shape. */
export function resolveScenarioFxSnapshot(
  scenarioOverrides: Record<string, unknown> | null | undefined,
): ScenarioFxSnapshot | null {
  const raw = scenarioOverrides?.['fxSnapshot'];
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  if (
    typeof s.factoryCurrency !== 'string' ||
    typeof s.scenarioCurrency !== 'string' ||
    typeof s.rate !== 'number' ||
    !(s.rate > 0)
  ) {
    return null;
  }
  const rateType: ScenarioFxRateType =
    s.rateType === 'reference' || s.rateType === 'budget' || s.rateType === 'custom' ? s.rateType : 'reference';
  return {
    factoryCurrency: s.factoryCurrency,
    scenarioCurrency: s.scenarioCurrency,
    provider: typeof s.provider === 'string' ? s.provider : null,
    source: typeof s.source === 'string' ? s.source : null,
    rate: s.rate,
    rateDate: typeof s.rateDate === 'string' ? s.rateDate : null,
    rateType,
    retrievedAt: typeof s.retrievedAt === 'string' ? s.retrievedAt : new Date(0).toISOString(),
    customReason: typeof s.customReason === 'string' ? s.customReason : undefined,
  };
}

/** The scenario's Ask Price, if one has ever been entered and is well-formed. */
export function resolveScenarioAskPrice(
  scenarioOverrides: Record<string, unknown> | null | undefined,
): ScenarioAskPrice | null {
  const raw = scenarioOverrides?.['askPrice'];
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  if (typeof s.amount !== 'number' || !(s.amount >= 0) || typeof s.currency !== 'string') return null;
  return { amount: s.amount, currency: s.currency };
}

// ── Scenario costing inputs (batch size / location / production life) ─────────
//
// Named readers for the three costing-input keys the Cost Guide persists into
// this same bag via merge_scenario_overrides. Same contract as
// resolveEffectiveSheetThicknessMm above: validate the shape, never guess,
// return null when the key is absent or malformed so the caller's own priority
// chain decides what happens next.
//
// These are deliberately readers ONLY — they hold no defaults. The single place
// a costing-input default is written is COSTING_INPUT_DEFAULTS in
// costing-inputs.ts, which composes these with the request and the bom_items
// row. Putting a `?? 1` here would recreate exactly the per-consumer-default
// problem that work exists to remove.

/** Persisted scenario batch size (parts per order). null when unset or not a positive integer. */
export function resolveScenarioBatchSize(
  scenarioOverrides: Record<string, unknown> | null | undefined,
): number | null {
  const raw = scenarioOverrides?.['batchSize'];
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : null;
}

/** Persisted scenario digital-factory location. null when unset or not a non-empty string. */
export function resolveScenarioLocation(
  scenarioOverrides: Record<string, unknown> | null | undefined,
): string | null {
  const raw = scenarioOverrides?.['location'];
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
}

/**
 * Persisted scenario production life in years — how long this part is quoted to
 * stay in production, used to amortise tooling. null when unset or not a
 * positive number.
 *
 * This key has no bom_items column by design: the JSONB bag already carries
 * every other scenario input (thickness, batch size, location, currency, ask
 * price), and merge_scenario_overrides has no key whitelist, so a new column
 * would add a second home for the same value and a second place its default
 * could drift.
 */
export function resolveScenarioProductionLifeYears(
  scenarioOverrides: Record<string, unknown> | null | undefined,
): number | null {
  const raw = scenarioOverrides?.['productionLifeYears'];
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : null;
}

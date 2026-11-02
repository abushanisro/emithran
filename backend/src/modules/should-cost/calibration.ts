/**
 * Should-cost calibration, the pure part: from actual/prediction pairs, one correction per (process_family, location) cell for the
 * global BENCHMARK machine-hour rates. Operator-run only (scripts/should-cost-calibrate.ts); there is no HTTP endpoint.
 *
 * Three rules keep a run from drifting or being steered:
 *  - Each pair is consumed by at most one run (migration 941): a re-run without new pairs changes nothing.
 *  - A cell is calibrated only with pairs from at least `minOrganizations` distinct organizations (default 2), so one tenant
 *    cannot move the rates every organization uses. Pairs whose organization is unknown are not counted.
 *  - Rates are set from the benchmark baseline (mhr_records.baseline_mhr, migration 953), never from the current rate:
 *      rate = baseline × baselineMultiplier,  baselineMultiplier = previous baselineMultiplier × this run's correction,
 *    clamped to [MIN_MULTIPLIER, MAX_MULTIPLIER]. Rounding never compounds and the rate stays within those bounds of the
 *    benchmark however many runs there are.
 *
 * The correction is a ridge regression with a single intercept parameter:
 *   β = Σ ln(actual/predicted) / (n + α),  correction = exp(β).
 * A correction > 1 means predictions were under-costing (rates are raised); < 1 means over-costing.
 */

export const MIN_SAMPLES = 5; // default minimum unconsumed pairs before a cell is calibrated
export const MIN_ORGANIZATIONS = 2; // default minimum distinct organizations among a cell's pairs
export const RIDGE_ALPHA = 1.0; // L2 regularisation strength (pulls the correction toward 1.0)
export const MAX_MULTIPLIER = 2.0; // a calibrated rate is never more than double its benchmark baseline
export const MIN_MULTIPLIER = 0.5; // ... and never less than half of it

export interface CalibrationPolicy {
  minSamples: number;
  minOrganizations: number;
}

export const DEFAULT_POLICY: CalibrationPolicy = { minSamples: MIN_SAMPLES, minOrganizations: MIN_ORGANIZATIONS };

export interface CalibrationPair {
  /** should_cost_actuals.id */
  actualId: string;
  actualTotalCostUsd: number | string | null;
  predictedTotalCostUsd: number | string | null;
  processFamily: string | null;
  location: string | null;
  /** The organization the prediction was made for (should_cost_predictions.organization_id). */
  organizationId: string | null;
  /** should_cost_actuals.calibration_consumed_at is set: an earlier run already applied this pair. */
  consumed: boolean;
}

export interface CellCalibration {
  processFamily: string;
  location: string;
  sampleCount: number;
  organizationCount: number;
  /** The rate change this run applies (new rate / previous rate); null when the cell is skipped. */
  multiplier: number | null;
  /** The unclamped ridge correction from this run's pairs. */
  rawMultiplier: number | null;
  /** rate = baseline × this, after the run; null when the cell is skipped. */
  baselineMultiplier: number | null;
  /** The pairs this run applies and consumes; empty for a skipped cell. */
  consumedActualIds: string[];
  mapeBefore: number;
  mapeAfter: number;
  biasBefore: number;
  biasAfter: number;
  pctWithin10Before: number;
  pctWithin10After: number;
  skippedReason?: string;
}

/** The key of a (process_family, location) cell; locations compare case-insensitively. */
export function cellKey(processFamily: string, location: string): string {
  return `${processFamily}::${location.toLowerCase()}`;
}

/**
 * One entry per cell with usable, unconsumed pairs. Invalid pairs (missing family/location/organization, non-positive costs) are
 * ignored. `previousBaselineMultipliers` holds each cell's baselineMultiplier from its last run (by cellKey); a cell without one
 * is at its baseline (1).
 */
export function planCalibration(
  pairs: readonly CalibrationPair[],
  policy: CalibrationPolicy = DEFAULT_POLICY,
  previousBaselineMultipliers: ReadonlyMap<string, number> = new Map(),
): CellCalibration[] {
  const cells = new Map<string, { processFamily: string; location: string; ids: string[]; orgs: Set<string>; logRatios: number[] }>();
  for (const pair of pairs) {
    if (pair.consumed) continue;
    const actual = Number(pair.actualTotalCostUsd);
    const predicted = Number(pair.predictedTotalCostUsd);
    if (!pair.processFamily || !pair.location || !pair.organizationId) continue;
    if (!(actual > 0) || !(predicted > 0) || !Number.isFinite(actual) || !Number.isFinite(predicted)) continue;
    const key = cellKey(pair.processFamily, pair.location);
    const cell = cells.get(key) ?? { processFamily: pair.processFamily, location: pair.location, ids: [], orgs: new Set<string>(), logRatios: [] };
    cell.ids.push(pair.actualId);
    cell.orgs.add(pair.organizationId);
    cell.logRatios.push(Math.log(actual / predicted));
    cells.set(key, cell);
  }

  return [...cells.entries()].map(([key, cell]) => {
    const n = cell.logRatios.length;
    const ratiosBefore = cell.logRatios.map(Math.exp); // actual/predicted
    const before = { mapeBefore: round2(mape(ratiosBefore)), biasBefore: round2(meanBias(ratiosBefore)), pctWithin10Before: round2(pctWithin10(ratiosBefore)) };
    const skippedReason =
      n < policy.minSamples ? `only ${n} unconsumed samples (need ${policy.minSamples})`
      : cell.orgs.size < policy.minOrganizations ? `pairs from only ${cell.orgs.size} organization(s) (need ${policy.minOrganizations})`
      : undefined;
    if (skippedReason) {
      return {
        processFamily: cell.processFamily, location: cell.location, sampleCount: n, organizationCount: cell.orgs.size,
        multiplier: null, rawMultiplier: null, baselineMultiplier: null, consumedActualIds: [], ...before,
        mapeAfter: before.mapeBefore, biasAfter: before.biasBefore, pctWithin10After: before.pctWithin10Before, skippedReason,
      };
    }
    const rawMultiplier = Math.exp(cell.logRatios.reduce((s, r) => s + r, 0) / (n + RIDGE_ALPHA));
    const previous = previousBaselineMultipliers.get(key) ?? 1;
    const baselineMultiplier = Math.min(MAX_MULTIPLIER, Math.max(MIN_MULTIPLIER, previous * rawMultiplier));
    const multiplier = baselineMultiplier / previous;
    const ratiosAfter = ratiosBefore.map((r) => r / multiplier);
    return {
      processFamily: cell.processFamily, location: cell.location, sampleCount: n, organizationCount: cell.orgs.size,
      multiplier, rawMultiplier, baselineMultiplier, consumedActualIds: [...cell.ids], ...before,
      mapeAfter: round2(mape(ratiosAfter)), biasAfter: round2(meanBias(ratiosAfter)), pctWithin10After: round2(pctWithin10(ratiosAfter)),
    };
  });
}

/** A benchmark rate after calibration: its baseline times the cell's baselineMultiplier (2 decimals, as stored). */
export function calibratedRate(baseline: number, baselineMultiplier: number): number {
  return Number((baseline * baselineMultiplier).toFixed(2));
}

/** The minimum-organizations setting (SHOULD_COST_CALIBRATION_MIN_ORGANIZATIONS); unset means the default, below 2 is refused. */
export function minOrganizationsSetting(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return MIN_ORGANIZATIONS;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 2) {
    throw new Error(`SHOULD_COST_CALIBRATION_MIN_ORGANIZATIONS must be an integer of at least 2 (got "${value}")`);
  }
  return n;
}

function round2(v: number): number {
  return Number(v.toFixed(2));
}
/** Mean Absolute Percentage Error — ratios are actual/predicted. */
function mape(ratios: number[]): number {
  return ratios.length ? ratios.reduce((s, r) => s + Math.abs(r - 1) * 100, 0) / ratios.length : 0;
}
/** Signed mean bias — positive = the engine under-predicts. */
function meanBias(ratios: number[]): number {
  return ratios.length ? ratios.reduce((s, r) => s + (r - 1) * 100, 0) / ratios.length : 0;
}
/** % of predictions within ±10% of actual. */
function pctWithin10(ratios: number[]): number {
  return ratios.length ? (ratios.filter((r) => Math.abs(r - 1) <= 0.1).length / ratios.length) * 100 : 0;
}

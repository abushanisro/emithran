/**
 * Should-cost calibration, the pure part: from actual/prediction pairs, one correction multiplier per (process_family, location)
 * cell for the global BENCHMARK machine-hour rates. Operator-run only (scripts/should-cost-calibrate.ts); there is no HTTP
 * endpoint. Each pair is consumed by at most one run (migration 941): a pair already consumed is never counted again, so
 * re-running without new pairs changes nothing and multipliers never compound on the same evidence.
 *
 * Ridge regression with a single intercept parameter:
 *   β = Σ ln(actual/predicted) / (n + α),  multiplier = exp(β), clamped to [MIN_MULTIPLIER, MAX_MULTIPLIER].
 * A multiplier > 1 means predictions were under-costing (rates are raised); < 1 means over-costing.
 */

export const MIN_SAMPLES = 5; // minimum unconsumed pairs before a cell is calibrated
export const RIDGE_ALPHA = 1.0; // L2 regularisation strength (pulls the multiplier toward 1.0)
export const MAX_MULTIPLIER = 2.0; // never more than double a rate in one run
export const MIN_MULTIPLIER = 0.5; // never halve a rate in one run

export interface CalibrationPair {
  /** should_cost_actuals.id */
  actualId: string;
  actualTotalCostUsd: number | string | null;
  predictedTotalCostUsd: number | string | null;
  processFamily: string | null;
  location: string | null;
  /** should_cost_actuals.calibration_consumed_at is set: an earlier run already applied this pair. */
  consumed: boolean;
}

export interface CellCalibration {
  processFamily: string;
  location: string;
  sampleCount: number;
  /** null when the cell is skipped (too few samples): nothing is applied and its pairs stay unconsumed. */
  multiplier: number | null;
  rawMultiplier: number | null;
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

/** One entry per cell with usable, unconsumed pairs. Invalid pairs (missing family/location, non-positive costs) are ignored. */
export function planCalibration(pairs: readonly CalibrationPair[]): CellCalibration[] {
  const cells = new Map<string, { processFamily: string; location: string; ids: string[]; logRatios: number[] }>();
  for (const pair of pairs) {
    if (pair.consumed) continue;
    const actual = Number(pair.actualTotalCostUsd);
    const predicted = Number(pair.predictedTotalCostUsd);
    if (!pair.processFamily || !pair.location) continue;
    if (!(actual > 0) || !(predicted > 0) || !Number.isFinite(actual) || !Number.isFinite(predicted)) continue;
    const key = `${pair.processFamily}::${pair.location.toLowerCase()}`;
    const cell = cells.get(key) ?? { processFamily: pair.processFamily, location: pair.location, ids: [], logRatios: [] };
    cell.ids.push(pair.actualId);
    cell.logRatios.push(Math.log(actual / predicted));
    cells.set(key, cell);
  }

  return [...cells.values()].map((cell) => {
    const n = cell.logRatios.length;
    const ratiosBefore = cell.logRatios.map(Math.exp); // actual/predicted
    const before = { mapeBefore: round2(mape(ratiosBefore)), biasBefore: round2(meanBias(ratiosBefore)), pctWithin10Before: round2(pctWithin10(ratiosBefore)) };
    if (n < MIN_SAMPLES) {
      return {
        processFamily: cell.processFamily, location: cell.location, sampleCount: n, multiplier: null, rawMultiplier: null,
        consumedActualIds: [], ...before, mapeAfter: before.mapeBefore, biasAfter: before.biasBefore, pctWithin10After: before.pctWithin10Before,
        skippedReason: `only ${n} unconsumed samples (need ${MIN_SAMPLES})`,
      };
    }
    const rawMultiplier = Math.exp(cell.logRatios.reduce((s, r) => s + r, 0) / (n + RIDGE_ALPHA));
    const multiplier = Math.min(MAX_MULTIPLIER, Math.max(MIN_MULTIPLIER, rawMultiplier));
    const ratiosAfter = ratiosBefore.map((r) => r / multiplier);
    return {
      processFamily: cell.processFamily, location: cell.location, sampleCount: n, multiplier, rawMultiplier,
      consumedActualIds: [...cell.ids], ...before,
      mapeAfter: round2(mape(ratiosAfter)), biasAfter: round2(meanBias(ratiosAfter)), pctWithin10After: round2(pctWithin10(ratiosAfter)),
    };
  });
}

/** A benchmark rate after a cell's multiplier (2 decimals, as stored). */
export function applyMultiplier(rate: number, multiplier: number): number {
  return Number((rate * multiplier).toFixed(2));
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

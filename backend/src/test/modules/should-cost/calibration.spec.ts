import {
  calibratedRate,
  cellKey,
  DEFAULT_POLICY,
  MAX_MULTIPLIER,
  MIN_MULTIPLIER,
  MIN_ORGANIZATIONS,
  MIN_SAMPLES,
  minOrganizationsSetting,
  planCalibration,
  type CalibrationPair,
  type CellCalibration,
} from '../../../modules/should-cost/calibration';
import { ShouldCostController } from '../../../modules/should-cost/should-cost.controller';

const pair = (id: string, actual: number, predicted = 10, changes: Partial<CalibrationPair> = {}): CalibrationPair => ({
  actualId: id, actualTotalCostUsd: actual, predictedTotalCostUsd: predicted, processFamily: 'milled', location: 'India',
  organizationId: 'org-a', consumed: false, ...changes,
});
/** MIN_SAMPLES pairs, alternating between two organizations. */
const five = (actual: number, prefix = 'a') =>
  Array.from({ length: MIN_SAMPLES }, (_, i) => pair(`${prefix}${i}`, actual, 10, { organizationId: i % 2 ? 'org-b' : 'org-a' }));
const ridge = (ratio: number, n = MIN_SAMPLES) => Math.exp((n * Math.log(ratio)) / (n + 1));

/** What the operator script does with a plan: rates from the baseline, the cell's multiplier remembered, pairs consumed. */
function applyRun(pairs: CalibrationPair[], previous: Map<string, number>, baseline: number, rate: number): number {
  for (const cell of planCalibration(pairs, DEFAULT_POLICY, previous)) {
    if (cell.baselineMultiplier == null) continue;
    rate = calibratedRate(baseline, cell.baselineMultiplier);
    previous.set(cellKey(cell.processFamily, cell.location), cell.baselineMultiplier);
    for (const id of cell.consumedActualIds) pairs.find((p) => p.actualId === id)!.consumed = true;
  }
  return rate;
}

describe('should-cost calibration (pure)', () => {
  it('ridge correction exp(Σln(a/p)/(n+α)) per cell, consuming exactly the pairs it used', () => {
    const [cell] = planCalibration(five(12));
    expect(cell.multiplier).toBeCloseTo(ridge(1.2), 12);
    expect(cell.baselineMultiplier).toBeCloseTo(ridge(1.2), 12);
    expect(cell.consumedActualIds).toEqual(['a0', 'a1', 'a2', 'a3', 'a4']);
    expect(cell.sampleCount).toBe(5);
    expect(cell.organizationCount).toBe(2);
  });

  it('clamps to [0.5, 2.0] of the baseline and records the raw value', () => {
    const [cell] = planCalibration(five(100));
    expect(cell.baselineMultiplier).toBe(MAX_MULTIPLIER);
    expect(cell.rawMultiplier).toBeGreaterThan(MAX_MULTIPLIER);
  });

  it('never counts a consumed pair again: a re-run over the same pairs applies nothing', () => {
    const first = planCalibration(five(12));
    const consumed = new Set(first.flatMap((c) => c.consumedActualIds));
    const rerun = planCalibration(five(12).map((p) => ({ ...p, consumed: consumed.has(p.actualId) })));
    expect(rerun).toEqual([]);
  });

  it('sets the rate from the baseline: re-running leaves it where one run put it', () => {
    const pairs = five(12);
    const previous = new Map<string, number>();
    let rate = 100;
    for (let run = 0; run < 3; run++) rate = applyRun(pairs, previous, 100, rate);
    expect(rate).toBe(calibratedRate(100, ridge(1.2)));
  });

  it('a second run on new evidence corrects the calibrated rate, still computed from the baseline', () => {
    const previous = new Map<string, number>();
    const first = five(12, 'a');
    let rate = applyRun(first, previous, 100, 100);
    const m1 = ridge(1.2);
    expect(rate).toBe(calibratedRate(100, m1));
    // The new pairs were predicted with the calibrated rate and are still 10% under.
    rate = applyRun([...first, ...five(11, 'b')], previous, 100, rate);
    expect(rate).toBe(calibratedRate(100, m1 * ridge(1.1)));
  });

  it('cannot drift past the bounds however many runs push the same way', () => {
    const previous = new Map<string, number>();
    let rate = 100;
    for (let run = 0; run < 10; run++) rate = applyRun(five(19, `r${run}-`), previous, 100, rate);
    expect(rate).toBe(calibratedRate(100, MAX_MULTIPLIER));
    for (let run = 0; run < 20; run++) rate = applyRun(five(4, `s${run}-`), previous, 100, rate);
    expect(rate).toBe(calibratedRate(100, MIN_MULTIPLIER));
  });

  it('skips a cell with too few unconsumed pairs and leaves them unconsumed', () => {
    const [cell] = planCalibration([...five(12).slice(0, 3), pair('old', 12, 10, { consumed: true }), pair('old2', 12, 10, { consumed: true })]);
    expect(cell.multiplier).toBeNull();
    expect(cell.baselineMultiplier).toBeNull();
    expect(cell.consumedActualIds).toEqual([]);
    expect(cell.skippedReason).toMatch(/only 3/);
  });

  it('skips a cell whose pairs all come from one organization, however many there are', () => {
    const oneTenant = Array.from({ length: 50 }, (_, i) => pair(`t${i}`, 20, 10, { organizationId: 'org-a' }));
    const [cell] = planCalibration(oneTenant);
    expect(MIN_ORGANIZATIONS).toBe(2);
    expect(cell.multiplier).toBeNull();
    expect(cell.consumedActualIds).toEqual([]);
    expect(cell.skippedReason).toMatch(/only 1 organization/);
  });

  it('does not count pairs with no organization, and honours a stricter policy', () => {
    const anonymous = five(12).map((p, i) => (i < 4 ? { ...p, organizationId: null } : p));
    expect(planCalibration(anonymous)[0].sampleCount).toBe(1);
    const [strict] = planCalibration(five(12), { minSamples: MIN_SAMPLES, minOrganizations: 3 });
    expect(strict.skippedReason).toMatch(/only 2 organization\(s\) \(need 3\)/);
  });

  it('ignores invalid pairs and groups locations case-insensitively', () => {
    const cells: CellCalibration[] = planCalibration([
      ...five(12).map((p, i) => ({ ...p, location: i % 2 ? 'india' : 'India' })),
      pair('zero', 0), pair('noFamily', 12, 10, { processFamily: null }), pair('noPrediction', 12, 0),
    ]);
    expect(cells).toHaveLength(1);
    expect(cells[0].consumedActualIds).toHaveLength(5);
  });

  it('reads the minimum-organizations setting with a default of 2 and refuses anything weaker', () => {
    expect(minOrganizationsSetting(undefined)).toBe(2);
    expect(minOrganizationsSetting('')).toBe(2);
    expect(minOrganizationsSetting('3')).toBe(3);
    expect(() => minOrganizationsSetting('1')).toThrow(/at least 2/);
    expect(() => minOrganizationsSetting('two')).toThrow(/at least 2/);
  });

  it('is not reachable over HTTP: no run or record-actual handler on the controller', () => {
    const handlers = Object.getOwnPropertyNames(ShouldCostController.prototype);
    expect(handlers).not.toContain('runCalibration');
    expect(handlers).not.toContain('recordActual');
    expect(handlers).toContain('getCalibrationHistory');
  });
});

import { applyMultiplier, MAX_MULTIPLIER, MIN_SAMPLES, planCalibration, type CalibrationPair } from '../../../modules/should-cost/calibration';
import { ShouldCostController } from '../../../modules/should-cost/should-cost.controller';

const pair = (id: string, actual: number, predicted = 10, changes: Partial<CalibrationPair> = {}): CalibrationPair => ({
  actualId: id, actualTotalCostUsd: actual, predictedTotalCostUsd: predicted, processFamily: 'milled', location: 'India', consumed: false, ...changes,
});
const five = (actual: number) => Array.from({ length: MIN_SAMPLES }, (_, i) => pair(`a${i}`, actual));

describe('should-cost calibration (pure)', () => {
  it('ridge multiplier exp(Σln(a/p)/(n+α)) per cell, consuming exactly the pairs it used', () => {
    const [cell] = planCalibration(five(12));
    expect(cell.multiplier).toBeCloseTo(Math.exp((5 * Math.log(1.2)) / 6), 12);
    expect(cell.consumedActualIds).toEqual(['a0', 'a1', 'a2', 'a3', 'a4']);
    expect(cell.sampleCount).toBe(5);
  });

  it('clamps to [0.5, 2.0] and records the raw value', () => {
    const [cell] = planCalibration(five(100));
    expect(cell.multiplier).toBe(MAX_MULTIPLIER);
    expect(cell.rawMultiplier).toBeGreaterThan(MAX_MULTIPLIER);
  });

  it('never counts a consumed pair again: a re-run over the same pairs applies nothing', () => {
    const first = planCalibration(five(12));
    const consumed = new Set(first.flatMap((c) => c.consumedActualIds));
    const rerun = planCalibration(five(12).map((p) => ({ ...p, consumed: consumed.has(p.actualId) })));
    expect(rerun).toEqual([]);
  });

  it('a rate calibrated once and then re-run is not compounded', () => {
    const pairs = five(12);
    let rate = 100;
    for (let run = 0; run < 3; run++) {
      for (const cell of planCalibration(pairs)) {
        if (cell.multiplier == null) continue;
        rate = applyMultiplier(rate, cell.multiplier);
        for (const id of cell.consumedActualIds) pairs.find((p) => p.actualId === id)!.consumed = true;
      }
    }
    expect(rate).toBe(applyMultiplier(100, Math.exp((5 * Math.log(1.2)) / 6)));
  });

  it('skips a cell with too few unconsumed pairs and leaves them unconsumed', () => {
    const [cell] = planCalibration([...five(12).slice(0, 3), pair('old', 12, 10, { consumed: true }), pair('old2', 12, 10, { consumed: true })]);
    expect(cell.multiplier).toBeNull();
    expect(cell.consumedActualIds).toEqual([]);
    expect(cell.skippedReason).toMatch(/only 3/);
  });

  it('ignores invalid pairs and groups locations case-insensitively', () => {
    const cells = planCalibration([
      ...five(12).map((p, i) => ({ ...p, location: i % 2 ? 'india' : 'India' })),
      pair('zero', 0), pair('noFamily', 12, 10, { processFamily: null }), pair('noPrediction', 12, 0),
    ]);
    expect(cells).toHaveLength(1);
    expect(cells[0].consumedActualIds).toHaveLength(5);
  });

  it('is not reachable over HTTP: no run or record-actual handler on the controller', () => {
    const handlers = Object.getOwnPropertyNames(ShouldCostController.prototype);
    expect(handlers).not.toContain('runCalibration');
    expect(handlers).not.toContain('recordActual');
    expect(handlers).toContain('getCalibrationHistory');
  });
});

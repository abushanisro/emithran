import { computeRollBendingCost, RollBendingEngine } from '../../../../../../modules/bom-items/costing/sheet-metal/process/roll-bending-engine';
import { ROLL_BENDING_SETUP_MIN } from '../../../../../../modules/bom-items/costing/shared/core/default-rates.constants';
import type { MHRRateInput } from '../../../../../../modules/bom-items/costing/shared/core/cost-engine';

// Real staged values for "2 Roll Bender - 1400mm Roll Length x 300mm Roll
// Diameter" (machine_library.json's "2 Roll Bender" category, 2026-09-01).
// rolling_speed_mm_s=110; 2-Roll machines carry no prebend_time_s field at
// all in the real source data (a genuine physical distinction, not a gap).
function realRoll2Rate(overrides: Partial<MHRRateInput> = {}): MHRRateInput {
  return {
    rate: 4.33 + 14.91, // direct_overhead_rate_usd_hr + indirect_overhead_rate_usd_hr
    source: 'mhr_database',
    machineClass: 'roll_bending_2',
    machineName: '2 Roll Bender - 1400mm Roll Length x 300mm Roll Diameter',
    commodityCode: null,
    ...overrides,
  };
}

// Real staged values for "4 Roll Bender - 12200mm Roll Length x 84mm Roll
// Diameter": rolling_speed_mm_s=75, prebend_time_s=90 (real per-machine
// pre-bend pass, present for 3/4-Roll machines).
function realRoll4Rate(overrides: Partial<MHRRateInput> = {}): MHRRateInput {
  return {
    rate: 253.29 + 36.31,
    source: 'mhr_database',
    machineClass: 'roll_bending_4',
    machineName: '4 Roll Bender - 12200mm Roll Length x 84mm Roll Diameter',
    commodityCode: null,
    ...overrides,
  };
}

describe('computeRollBendingCost — real rolling-speed-derived cycle time', () => {
  it('computes cycle time as rollFeedLengthMm / real rollingSpeedMmPerSec for a 2-Roll machine (no prebend step)', () => {
    const result = computeRollBendingCost('2 Roll Bending', 'roll_bending_2', {
      rollFeedLengthMm: 2200,
      batchSize: 5,
      rollBendingRate: realRoll2Rate(),
      rollingSpeedMmPerSec: 110,
      setupMin: 30,
    });

    const expectedMin = (2200 / 110) / 60;
    expect(result.cuttingMin).toBeCloseTo(expectedMin, 6);
    expect(result.abrasiveCost).toBe(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('adds the real per-machine prebend time for a 3/4-Roll machine', () => {
    const result = computeRollBendingCost('4 Roll Bending', 'roll_bending_4', {
      rollFeedLengthMm: 3000,
      batchSize: 2,
      rollBendingRate: realRoll4Rate(),
      rollingSpeedMmPerSec: 75,
      prebendTimeSec: 90,
      setupMin: 30,
    });

    const expectedMin = ((3000 / 75) + 90) / 60;
    expect(result.cuttingMin).toBeCloseTo(expectedMin, 6);
  });

  it('stays honestly $0/0-min (no guess) when no real rolling-speed data was resolved for this machine', () => {
    const result = computeRollBendingCost('2 Roll Bending', 'roll_bending_2', {
      rollFeedLengthMm: 2200,
      batchSize: 5,
      rollBendingRate: realRoll2Rate({ machineName: 'Unclassified Roll Bender' }),
      setupMin: 30,
    });

    expect(result.cuttingMin).toBe(0);
    expect(result.warnings.some((w) => w.includes('no real rolling-speed data on file'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('Unclassified Roll Bender'))).toBe(true);
  });

  it('does not warn about missing rolling-speed data when there is no real feed length at all', () => {
    const result = computeRollBendingCost('2 Roll Bending', 'roll_bending_2', {
      rollFeedLengthMm: 0,
      batchSize: 5,
      rollBendingRate: realRoll2Rate(),
      setupMin: 30,
    });

    expect(result.cuttingMin).toBe(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('falls back to ROLL_BENDING_SETUP_MIN and discloses it when no real setup time was resolved', () => {
    const result = computeRollBendingCost('2 Roll Bending', 'roll_bending_2', {
      rollFeedLengthMm: 2200,
      batchSize: 5,
      rollBendingRate: realRoll2Rate(),
      rollingSpeedMmPerSec: 110,
    });
    expect(result.warnings.some((w) => w.includes('setup time from fallback'))).toBe(true);
  });

  it('uses a real resolved setup time without warning when provided', () => {
    const result = computeRollBendingCost('2 Roll Bending', 'roll_bending_2', {
      rollFeedLengthMm: 2200,
      batchSize: 5,
      rollBendingRate: realRoll2Rate(),
      rollingSpeedMmPerSec: 110,
      setupMin: 45,
    });
    expect(result.warnings.some((w) => w.includes('setup time from fallback'))).toBe(false);
  });
});

describe('computeRollBendingCost — direct labour cost', () => {
  it('charges labour cost for both setup and run time when a differentiated labour rate is resolved', () => {
    const result = computeRollBendingCost('2 Roll Bending', 'roll_bending_2', {
      rollFeedLengthMm: 2200,
      batchSize: 5,
      rollBendingRate: realRoll2Rate({ labourRate: 43.21 }),
      rollingSpeedMmPerSec: 110,
      setupMin: 30,
    });
    const line = result.processLines[0]!;
    const machineOnlyRunCost = (result.cuttingMin / 60) * realRoll2Rate().rate;
    expect(line.runCost).toBeGreaterThan(machineOnlyRunCost);
  });

  it('charges $0 labour (not a guess) when no differentiated rate was resolved', () => {
    const result = computeRollBendingCost('2 Roll Bending', 'roll_bending_2', {
      rollFeedLengthMm: 2200,
      batchSize: 5,
      rollBendingRate: realRoll2Rate({ labourRate: null }),
      rollingSpeedMmPerSec: 110,
      setupMin: 30,
    });
    expect(result.processLines[0]!.labourRate).toBeNull();
  });
});

describe('RollBendingEngine — ManufacturingProcessEngine wrapper', () => {
  it('reports the correct machineClass/processFamily per instance', () => {
    const r2 = new RollBendingEngine('roll_bending_2', '2 Roll Bending');
    const r3 = new RollBendingEngine('roll_bending_3', '3 Roll Bending');
    const r4 = new RollBendingEngine('roll_bending_4', '4 Roll Bending');
    expect(r2.machineClass).toBe('roll_bending_2');
    expect(r3.machineClass).toBe('roll_bending_3');
    expect(r4.machineClass).toBe('roll_bending_4');
    expect(r2.processFamily).toBe('sheet_metal_forming');
    expect(r3.processFamily).toBe('sheet_metal_forming');
    expect(r4.processFamily).toBe('sheet_metal_forming');
  });

  it('delegates computeCost using context.flatPatternLengthMm as the real roll feed length', () => {
    const engine = new RollBendingEngine('roll_bending_2', '2 Roll Bending');
    const result = engine.computeCost({
      sheetThicknessMm: 3,
      cutLengthMm: 0,
      pierceCount: 0,
      holeCount: 0,
      batchSize: 5,
      grade: 'SECC',
      rate: realRoll2Rate(),
      opSetupMin: 30,
      flatPatternLengthMm: 2200,
      rollBendingParams: { rollingSpeedMmPerSec: 110, prebendTimeSec: 0, dataFound: true },
    });

    expect(result.processLines[0]!.process).toBe('2 Roll Bending');
    const expectedMin = (2200 / 110) / 60;
    expect(result.cuttingMin).toBeCloseTo(expectedMin, 6);
  });

  it('stays honestly $0-min when flatPatternLengthMm is absent (no real flat-pattern extraction yet)', () => {
    const engine = new RollBendingEngine('roll_bending_2', '2 Roll Bending');
    const result = engine.computeCost({
      sheetThicknessMm: 3,
      cutLengthMm: 0,
      pierceCount: 0,
      holeCount: 0,
      batchSize: 5,
      grade: 'SECC',
      rate: realRoll2Rate(),
      opSetupMin: 30,
      rollBendingParams: { rollingSpeedMmPerSec: 110, prebendTimeSec: 0, dataFound: true },
    });

    expect(result.cuttingMin).toBe(0);
  });
});

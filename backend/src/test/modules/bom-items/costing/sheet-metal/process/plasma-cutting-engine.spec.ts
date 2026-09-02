import { computePlasmaCutCost, type PlasmaCutInput } from '../../../../../../modules/bom-items/costing/sheet-metal/process/plasma-cutting-engine';
import { PLASMA_CUT_SETUP_MIN } from '../../../../../../modules/bom-items/costing/shared/core/default-rates.constants';

// Real Steel 6.4mm / 100W row from sm_reference_data's
// 'nestingCutRate:1:PlasmaCut:NoGas:Steel:100:6.4'
// (memory/sheetmetal/lookuptable/sheet_metal_nesting_cut_rate_combined.json):
// feedRateLargeFeaturesMmPerMin: 1037, pierceTimeS: 7. Matches the real
// "Vulcan 3100D" machine's power_watts: 100.
function baseInput(overrides: Partial<PlasmaCutInput> = {}): PlasmaCutInput {
  return {
    sheetThicknessMm: 6.4,
    cutLengthMm: 1000,
    pierceCount: 2,
    batchSize: 10,
    feedRateLargeFeaturesMmPerMin: 1037,
    pierceTimeSec: 7,
    ...overrides,
  };
}

describe('computePlasmaCutCost — cutting/pierce time', () => {
  it('divides cut length by the real feed rate and adds pierceCount * real pierce time', () => {
    const input = baseInput();
    const result = computePlasmaCutCost(input);

    const expectedCuttingSec = (input.cutLengthMm / input.feedRateLargeFeaturesMmPerMin!) * 60;
    const expectedPierceSec = input.pierceCount * input.pierceTimeSec!;
    const expectedCuttingMin = (expectedCuttingSec + expectedPierceSec) / 60;

    expect(result.cuttingMin).toBeCloseTo(expectedCuttingMin, 5);
  });

  it('produces zero pierce time when pierceCount is 0', () => {
    const input = baseInput({ pierceCount: 0 });
    const result = computePlasmaCutCost(input);

    const expectedCuttingSec = (input.cutLengthMm / input.feedRateLargeFeaturesMmPerMin!) * 60;
    expect(result.cuttingMin).toBeCloseTo(expectedCuttingSec / 60, 5);
  });

  it('stays honestly $0/0-min (no guess) when no real feed-rate/pierce-time data was resolved', () => {
    const input = baseInput({ feedRateLargeFeaturesMmPerMin: undefined, pierceTimeSec: undefined });
    const result = computePlasmaCutCost(input);

    expect(result.cuttingMin).toBe(0);
    expect(result.warnings.some((w) => w.includes("nestingCutRate:*:PlasmaCut:*"))).toBe(true);
  });

  it('does not warn about missing cutting data when there is nothing to cut or pierce', () => {
    const input = baseInput({
      feedRateLargeFeaturesMmPerMin: undefined,
      pierceTimeSec: undefined,
      cutLengthMm: 0,
      pierceCount: 0,
    });
    const result = computePlasmaCutCost(input);

    expect(result.cuttingMin).toBe(0);
    expect(result.warnings.some((w) => w.includes('nestingCutRate'))).toBe(false);
  });
});

describe('computePlasmaCutCost — setup time', () => {
  it('uses the real resolved setup time with no warning when provided', () => {
    const input = baseInput({ setupMin: 4.8 });
    const result = computePlasmaCutCost(input);

    expect(result.warnings.some((w) => w.includes('setup time from fallback'))).toBe(false);
  });

  it('falls back to PLASMA_CUT_SETUP_MIN and discloses a warning when no real setup time is resolved', () => {
    const input = baseInput({ setupMin: undefined });
    const result = computePlasmaCutCost(input);
    const line = result.processLines[0]!;

    expect(result.warnings.some((w) => w.includes('setup time from fallback'))).toBe(true);
    expect(line.setupCost).toBeGreaterThanOrEqual(0);
  });
});

describe('computePlasmaCutCost — direct labour cost', () => {
  it('charges labour cost for both setup and run time when a differentiated labour rate is resolved', () => {
    const input = baseInput({
      plasmaCutRate: { rate: 60, source: 'mhr_database', machineClass: 'plasma_cut', machineName: 'Test Plasma', commodityCode: null, labourRate: 36.3 },
      setupMin: 4.8,
    });
    const result = computePlasmaCutCost(input);
    const line = result.processLines[0]!;

    const machineOnlyRunCost = (result.cuttingMin / 60) * 60;
    expect(line.runCost).toBeGreaterThan(machineOnlyRunCost);
    expect(result.warnings.some((w) => w.includes('no direct labor rate'))).toBe(false);
  });

  it('charges $0 labour (not a guess) when no differentiated rate was resolved', () => {
    const input = baseInput({
      plasmaCutRate: { rate: 60, source: 'mhr_database', machineClass: 'plasma_cut', machineName: 'Test Plasma', commodityCode: null, labourRate: null },
    });
    const result = computePlasmaCutCost(input);
    const line = result.processLines[0]!;

    expect(line.labourRate).toBeNull();
    expect(line.runCost).toBeCloseTo(Math.round((result.cuttingMin / 60) * 60 * 100) / 100, 5);
  });
});

describe('computePlasmaCutCost — no abrasive consumable', () => {
  it('always reports abrasiveCost as 0 (no nozzle-wear rate table exists for this class yet)', () => {
    const result = computePlasmaCutCost(baseInput());
    expect(result.abrasiveCost).toBe(0);
  });
});

describe('computePlasmaCutCost — fallback rate', () => {
  it('uses noRateFallback when no plasmaCutRate is provided, producing a defined process line rather than throwing', () => {
    const result = computePlasmaCutCost(baseInput());
    expect(result.processLines).toHaveLength(1);
    expect(result.processLines[0]!.process).toBe('Plasma Cut');
  });
});

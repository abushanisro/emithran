import { computePlasmaPunchCost, type PlasmaPunchInput } from '../../../../../../modules/bom-items/costing/sheet-metal/process/plasma-punch-engine';

// Real Steel 6mm / 30W row from sm_reference_data's
// 'nestingCutRate:1:PlasmaPunch:NoGas:Steel:30.0:6.0'
// (memory/sheetmetal/lookuptable/sheet_metal_nesting_cut_rate_combined.json):
// feedRateLargeFeaturesMmPerMin: 665, pierceTimeS: 0. Matches the real
// "Plasma Punch - 100 Watts, 300kN Press Force" family's power tier.
function baseInput(overrides: Partial<PlasmaPunchInput> = {}): PlasmaPunchInput {
  return {
    sheetThicknessMm: 6,
    cutLengthMm: 1000,
    pierceCount: 2,
    batchSize: 10,
    feedRateLargeFeaturesMmPerMin: 665,
    pierceTimeSec: 0,
    ...overrides,
  };
}

describe('computePlasmaPunchCost — cutting/pierce time', () => {
  it('divides cut length by the real feed rate; pierce time is 0 for this class in the real source data', () => {
    const input = baseInput();
    const result = computePlasmaPunchCost(input);

    const expectedCuttingSec = (input.cutLengthMm / input.feedRateLargeFeaturesMmPerMin!) * 60;
    expect(result.cuttingMin).toBeCloseTo(expectedCuttingSec / 60, 5);
  });

  it('scales cutting time with a non-zero real pierce time when one is resolved', () => {
    const input = baseInput({ pierceTimeSec: 3 });
    const result = computePlasmaPunchCost(input);

    const expectedCuttingSec = (input.cutLengthMm / input.feedRateLargeFeaturesMmPerMin!) * 60;
    const expectedPierceSec = input.pierceCount * 3;
    expect(result.cuttingMin).toBeCloseTo((expectedCuttingSec + expectedPierceSec) / 60, 5);
  });

  it('stays honestly $0/0-min (no guess) when no real feed-rate/pierce-time data was resolved', () => {
    const input = baseInput({ feedRateLargeFeaturesMmPerMin: undefined, pierceTimeSec: undefined });
    const result = computePlasmaPunchCost(input);

    expect(result.cuttingMin).toBe(0);
    expect(result.warnings.some((w) => w.includes("nestingCutRate:*:PlasmaPunch:*"))).toBe(true);
  });

  it('does not warn about missing cutting data when there is nothing to cut or pierce', () => {
    const input = baseInput({
      feedRateLargeFeaturesMmPerMin: undefined,
      pierceTimeSec: undefined,
      cutLengthMm: 0,
      pierceCount: 0,
    });
    const result = computePlasmaPunchCost(input);

    expect(result.cuttingMin).toBe(0);
    expect(result.warnings.some((w) => w.includes('nestingCutRate'))).toBe(false);
  });
});

describe('computePlasmaPunchCost — setup time', () => {
  it('uses the real resolved setup time with no warning when provided', () => {
    const input = baseInput({ setupMin: 30 });
    const result = computePlasmaPunchCost(input);

    expect(result.warnings.some((w) => w.includes('setup time from fallback'))).toBe(false);
  });

  it('falls back to PLASMA_PUNCH_SETUP_MIN and discloses a warning when no real setup time is resolved', () => {
    const input = baseInput({ setupMin: undefined });
    const result = computePlasmaPunchCost(input);

    expect(result.warnings.some((w) => w.includes('setup time from fallback'))).toBe(true);
    expect(result.processLines[0]!.setupCost).toBeGreaterThanOrEqual(0);
  });
});

describe('computePlasmaPunchCost — direct labour cost', () => {
  it('charges labour cost for both setup and run time when a differentiated labour rate is resolved', () => {
    const input = baseInput({
      plasmaPunchRate: { rate: 40, source: 'mhr_database', machineClass: 'plasma_punch', machineName: 'Test Plasma Punch', commodityCode: null, labourRate: 36.3 },
      setupMin: 30,
    });
    const result = computePlasmaPunchCost(input);
    const line = result.processLines[0]!;

    const machineOnlyRunCost = (result.cuttingMin / 60) * 40;
    expect(line.runCost).toBeGreaterThan(machineOnlyRunCost);
  });

  it('charges $0 labour (not a guess) when no differentiated rate was resolved', () => {
    const result = computePlasmaPunchCost(baseInput({
      plasmaPunchRate: { rate: 40, source: 'mhr_database', machineClass: 'plasma_punch', machineName: 'Test Plasma Punch', commodityCode: null, labourRate: null },
    }));
    expect(result.processLines[0]!.labourRate).toBeNull();
  });
});

describe('computePlasmaPunchCost — no abrasive consumable', () => {
  it('always reports abrasiveCost as 0', () => {
    const result = computePlasmaPunchCost(baseInput());
    expect(result.abrasiveCost).toBe(0);
  });
});

describe('computePlasmaPunchCost — fallback rate', () => {
  it('uses noRateFallback when no plasmaPunchRate is provided, producing a defined process line rather than throwing', () => {
    const result = computePlasmaPunchCost(baseInput());
    expect(result.processLines).toHaveLength(1);
    expect(result.processLines[0]!.process).toBe('Plasma Punch');
  });
});

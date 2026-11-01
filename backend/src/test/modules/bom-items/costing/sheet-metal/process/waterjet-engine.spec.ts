import { computeWaterjetCost, waterjetMissingInputs, waterjetSpeedFactor, type WaterjetInput } from '../../../../../../modules/bom-items/costing/sheet-metal/process/waterjet-engine';

// Cycle time is the waterjet calculator result (migration 905; the formula is checked in
// test/migrations/905-waterjet-calculator.spec.ts). The engine prices that time, or reports why
// there is none.
function baseInput(overrides: Partial<WaterjetInput> = {}): WaterjetInput {
  return {
    sheetThicknessMm: 6,
    cutLengthMm: 1000,
    pierceCount: 2,
    batchSize: 10,
    cuttingSecFromCalculator: 150,
    activeCuttingSecFromCalculator: 138,
    calculatorId: 'calc-id',
    ...overrides,
  };
}

describe('computeWaterjetCost — prices the calculator cycle time', () => {
  it('uses the calculator seconds as the line cycle time and carries the calculator id', () => {
    const result = computeWaterjetCost(baseInput());
    expect(result.cuttingMin).toBeCloseTo(150 / 60, 9);
    expect(result.processLines[0]!.cycleTimeMin).toBeCloseTo(150 / 60, 9);
    expect(result.processLines[0]!.calculatorId).toBe('calc-id');
    expect(result.processLines[0]!.physicsGap).toBeUndefined();
  });

  it('charges abrasive on the active cutting seconds only, not on piercing', () => {
    const result = computeWaterjetCost(baseInput({ abrasivePricePerKg: 0.7275, abrasiveKgPerMin: 0.46 }));
    expect(result.abrasiveCost).toBeCloseTo((138 / 60) * 0.46 * 0.7275, 2);
  });

  it('warns, instead of silently charging 0, when no abrasive price is on file', () => {
    for (const abrasivePricePerKg of [null, undefined]) {
      const result = computeWaterjetCost(baseInput({ abrasivePricePerKg, abrasiveKgPerMin: 0.46 }));
      expect(result.abrasiveCost).toBe(0);
      expect(result.warnings.some((w) => w.includes('no garnet abrasive price'))).toBe(true);
    }
  });

  it('does not warn about the abrasive price when one is on file', () => {
    const result = computeWaterjetCost(baseInput({ abrasivePricePerKg: 0.7275, abrasiveKgPerMin: 0.46 }));
    expect(result.warnings.some((w) => w.includes('no garnet abrasive price'))).toBe(false);
  });

  it('adds no gap and no time when there is nothing to cut', () => {
    const result = computeWaterjetCost(baseInput({ cutLengthMm: 0, pierceCount: 0, cuttingSecFromCalculator: undefined }));
    expect(result.cuttingMin).toBe(0);
    expect(result.processLines[0]!.physicsGap).toBeUndefined();
  });
});

describe('computeWaterjetCost — no calculator time is a data gap, not a $0 operation', () => {
  it('raises the gap the caller reports', () => {
    const gap = { gapType: 'unsupported_operation' as const, process: 'Waterjet Cutting', machineClass: 'waterjet', reason: 'Not priced: example.' };
    const line = computeWaterjetCost(baseInput({ cuttingSecFromCalculator: undefined, physicsGap: gap })).processLines[0]!;
    expect(line.physicsGap).toEqual(gap);
  });

  it('raises a gap of its own when there was work but neither a time nor a reason', () => {
    const line = computeWaterjetCost(baseInput({ cuttingSecFromCalculator: undefined })).processLines[0]!;
    expect(line.physicsGap?.gapType).toBe('unsupported_operation');
  });
});

describe('waterjetMissingInputs — why the calculator could not be seeded', () => {
  const full = { machineName: 'Flow Mach 2 1313b', hasCuttingSpeed: true, speedFactor: 1, nozzleDelaySec: 4, leadInMm: 5, adjustmentFactor: 1.4 };

  it('says no machine was selected, not that data is missing', () => {
    expect(waterjetMissingInputs({ ...full, machineName: null })).toContain('no waterjet machine could be selected');
  });

  it('names the machine or the table that is missing', () => {
    expect(waterjetMissingInputs({ ...full, nozzleDelaySec: null })).toContain('Flow Mach 2 1313b has no nozzle_delay_s');
    expect(waterjetMissingInputs({ ...full, hasCuttingSpeed: false })).toContain('sm_lookup_waterjet_cut');
    expect(waterjetMissingInputs({ ...full, speedFactor: null })).toContain('mixing_tube_diameter_mm');
    expect(waterjetMissingInputs({ ...full, leadInMm: null })).toContain('standardWaterjetCutLeadInAmount');
    expect(waterjetMissingInputs({ ...full, adjustmentFactor: null })).toContain('waterjetCutTimeAdjustmentFactor');
  });

  it('is null when every input is on file', () => {
    expect(waterjetMissingInputs(full)).toBeNull();
  });
});

describe('computeWaterjetCost — direct labour cost', () => {
  it('charges labour cost for both setup and run time when a differentiated labour rate is resolved', () => {
    const input = baseInput({
      waterjetRate: { rate: 120, source: 'mhr_database', machineClass: 'waterjet', machineName: 'Test Waterjet', commodityCode: null, labourRate: 60 },
      setupMin: 30,
    });
    const result = computeWaterjetCost(input);
    const line = result.processLines[0]!;

    const dlrMin = 60 / 60; // $1/min
    const expectedSetupCost = (30 / 60) * 120 / input.batchSize + dlrMin * 30 / input.batchSize;

    expect(line.setupCost).toBeCloseTo(expectedSetupCost, 2);
    const machineOnlyRunCost = (result.cuttingMin / 60) * 120;
    expect(line.runCost).toBeGreaterThan(machineOnlyRunCost);
  });

  it('charges $0 labour (not a guess) when no differentiated rate was resolved', () => {
    const input = baseInput({
      waterjetRate: { rate: 120, source: 'mhr_database', machineClass: 'waterjet', machineName: 'Test Waterjet', commodityCode: null, labourRate: null },
    });
    const result = computeWaterjetCost(input);
    const line = result.processLines[0]!;

    expect(line.labourRate).toBeNull();
    expect(line.runCost).toBeCloseTo((result.cuttingMin / 60) * 120, 5);
  });
});

describe('computeWaterjetCost — nozzle-wear cost (closeout Plan Phase 2b)', () => {
  it('adds a distinct Nozzle Wear line, proportional to active cutting time, when a rate is seeded', () => {
    const result = computeWaterjetCost(baseInput({ nozzleRate: { costPerHr: 100 / 85, dataFound: true } }));
    const nozzleLine = result.processLines.find((l) => l.process === 'Nozzle Wear');

    expect(nozzleLine).toBeDefined();
    expect(nozzleLine!.totalCost).toBeCloseTo(Math.round((138 / 3600) * (100 / 85) * 100) / 100, 2);
  });

  it('does not add a nozzle line, and warns, when no rate is seeded and there is real cutting time', () => {
    const result = computeWaterjetCost(baseInput({ nozzleRate: { costPerHr: 0, dataFound: false } }));

    expect(result.processLines.some((l) => l.process === 'Nozzle Wear')).toBe(false);
    expect(result.warnings.some((w) => w.includes('no nozzle-wear rate seeded'))).toBe(true);
  });
});

describe('waterjetSpeedFactor — cut speed of a machine against the reference tier', () => {
  // Mixing tubes from the machine library: Flow Mach 2 1313b 1.061 mm (the reference), OMAX 55100 0.762 mm.
  it('is the focusing tube diameter over the reference machine tube', () => {
    expect(waterjetSpeedFactor(1.061, 1.061)).toBe(1);
    expect(waterjetSpeedFactor(0.762, 1.061)).toBeCloseTo(0.718, 3);
    expect(waterjetSpeedFactor(1.016, 1.061)).toBeCloseTo(0.9576, 3);
  });

  it('is null, never 1, when either tube is not on file', () => {
    expect(waterjetSpeedFactor(null, 1.061)).toBeNull();
    expect(waterjetSpeedFactor(0.762, null)).toBeNull();
  });
});

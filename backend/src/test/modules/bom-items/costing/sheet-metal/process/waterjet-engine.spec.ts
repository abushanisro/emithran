import { computeWaterjetCost, type WaterjetInput } from '../../../../../../modules/bom-items/costing/sheet-metal/process/waterjet-engine';
import { WATERJET_LEAD_IN_MM, WATERJET_CUT_TIME_ADJUSTMENT_FACTOR } from '../../../../../../modules/bom-items/costing/shared/core/default-rates.constants';

function baseInput(overrides: Partial<WaterjetInput> = {}): WaterjetInput {
  return {
    sheetThicknessMm: 6,
    cutLengthMm: 1000,
    pierceCount: 2,
    batchSize: 10,
    cuttingSpeedMmPerMin: 500,
    pierceTimeSec: 3,
    ...overrides,
  };
}

describe('computeWaterjetCost — lead-in/lead-out and accel-decel overhead', () => {
  it('adds 2x lead-in per contour start before dividing by cutting speed, then applies the accel/decel factor', () => {
    const input = baseInput();
    const result = computeWaterjetCost(input);

    const effectiveCutLengthMm = input.cutLengthMm + input.pierceCount * 2 * WATERJET_LEAD_IN_MM;
    const expectedCuttingSec = (effectiveCutLengthMm / input.cuttingSpeedMmPerMin!) * 60 * WATERJET_CUT_TIME_ADJUSTMENT_FACTOR;
    const expectedPierceSec = input.pierceCount * input.pierceTimeSec!;
    const expectedCuttingMin = (expectedCuttingSec + expectedPierceSec) / 60;

    expect(result.cuttingMin).toBeCloseTo(expectedCuttingMin, 5);
  });

  it('produces zero contours-worth of lead-in when pierceCount is 0, so only the accel/decel factor applies', () => {
    const input = baseInput({ pierceCount: 0, pierceTimeSec: 0 });
    const result = computeWaterjetCost(input);

    const expectedCuttingSec = (input.cutLengthMm / input.cuttingSpeedMmPerMin!) * 60 * WATERJET_CUT_TIME_ADJUSTMENT_FACTOR;
    expect(result.cuttingMin).toBeCloseTo(expectedCuttingSec / 60, 5);
  });

  it('stays honestly $0/0-sec (no guess) when no real cuttingSpeedMmPerMin/pierceTimeSec was resolved', () => {
    const input = baseInput({ cuttingSpeedMmPerMin: undefined, pierceTimeSec: undefined });
    const result = computeWaterjetCost(input);

    expect(result.cuttingMin).toBe(0);
    expect(result.warnings.some((w) => w.includes('no sm_lookup_waterjet_cut entry'))).toBe(true);
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
    // Run cost must exceed the machine-only figure now that labour is charged.
    const machineOnlyRunCost = (result.cuttingMin / 60) * 120;
    expect(line.runCost).toBeGreaterThan(machineOnlyRunCost);
    expect(result.warnings.some((w) => w.includes('no direct labor rate'))).toBe(false);
  });

  it('charges $0 labour (not a guess) when no differentiated rate was resolved', () => {
    const input = baseInput({
      waterjetRate: { rate: 120, source: 'mhr_database', machineClass: 'waterjet', machineName: 'Test Waterjet', commodityCode: null, labourRate: null },
    });
    const result = computeWaterjetCost(input);
    const line = result.processLines[0]!;

    expect(line.labourRate).toBeNull();
    expect(line.runCost).toBeCloseTo(Math.round((result.cuttingMin / 60) * 120 * 100) / 100, 5);
  });
});

describe('computeWaterjetCost — nozzle-wear cost (closeout Plan Phase 2b)', () => {
  it('adds a distinct Nozzle Wear line, proportional to active cutting time, when a rate is seeded', () => {
    const input = baseInput({ nozzleRate: { costPerHr: 100 / 85, dataFound: true } });
    const result = computeWaterjetCost(input);
    const nozzleLine = result.processLines.find((l) => l.process === 'Nozzle Wear');

    expect(nozzleLine).toBeDefined();
    const cuttingSec = result.cuttingMin * 60 - input.pierceCount * input.pierceTimeSec!;
    const expectedNozzleCost = Math.round((cuttingSec / 3600) * (100 / 85) * 100) / 100;
    expect(nozzleLine!.totalCost).toBeCloseTo(expectedNozzleCost, 2);
  });

  it('does not add a nozzle line, and warns, when no rate is seeded and there is real cutting time', () => {
    const input = baseInput({ nozzleRate: { costPerHr: 0, dataFound: false } });
    const result = computeWaterjetCost(input);

    expect(result.processLines.some((l) => l.process === 'Nozzle Wear')).toBe(false);
    expect(result.warnings.some((w) => w.includes('no nozzle-wear rate seeded'))).toBe(true);
  });

  it('does not add a nozzle line when there is no real cutting time (nothing to wear a nozzle on)', () => {
    const input = baseInput({ cuttingSpeedMmPerMin: undefined, pierceTimeSec: undefined, nozzleRate: { costPerHr: 1, dataFound: true } });
    const result = computeWaterjetCost(input);

    expect(result.processLines.some((l) => l.process === 'Nozzle Wear')).toBe(false);
  });
});

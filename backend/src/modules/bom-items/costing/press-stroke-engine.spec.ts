import { computePressStrokeCost, PressStrokeEngine, type PressStrokeInput } from './press-stroke-engine';
import type { MHRRateInput } from './cost-engine';

// Real staged values for "Standard Press - 1,500kN Press Force" (migration 608,
// sourced from sm_reference_data.raw's press_cycle_time_s/handling coefficients).
function realRate(overrides: Partial<MHRRateInput> = {}): MHRRateInput {
  return {
    rate: 32.27,
    source: 'mhr_database',
    machineClass: 'standard_press',
    machineName: 'Standard Press - 1,500kN Press Force',
    commodityCode: null,
    pressCycleTimeS: 0.5,
    handlingConstS: 0.0,
    handlingMassCoeffSPerKg: 0.03,
    ...overrides,
  };
}

function baseInput(overrides: Partial<PressStrokeInput> = {}): PressStrokeInput {
  return {
    numberOfStrokes: 1,
    batchSize: 250,
    partWeightKg: 2,
    pressRate: realRate(),
    setupMin: 30,
    ...overrides,
  };
}

describe('computePressStrokeCost — real per-machine cycle time', () => {
  it('computes cycle time as (pressCycleTimeS + handling) / 60 for one stroke', () => {
    const input = baseInput();
    const result = computePressStrokeCost('Standard Press', 'standard_press', input);

    // 0.5s stroke + (0 + 0.03*2)s handling = 0.56s -> /60 min
    const expectedMin = (0.5 + 0.03 * 2) / 60;
    expect(result.cuttingMin).toBeCloseTo(expectedMin, 6);
    expect(result.abrasiveCost).toBe(0);
  });

  it('scales linearly with numberOfStrokes', () => {
    const result = computePressStrokeCost('Standard Press', 'standard_press', baseInput({ numberOfStrokes: 3, partWeightKg: undefined }));
    const expectedMin = (0.5 * 3) / 60;
    expect(result.cuttingMin).toBeCloseTo(expectedMin, 6);
  });

  it('stays honestly $0/0-min (no guess) when no real press_cycle_time_s was resolved for this machine', () => {
    const result = computePressStrokeCost('Standard Press', 'standard_press', baseInput({
      pressRate: realRate({ pressCycleTimeS: null, machineName: 'Aida SMX-0-L2-3000' }),
    }));

    expect(result.cuttingMin).toBe(0);
    expect(result.warnings.some((w) => w.includes('no real press_cycle_time_s on file'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('Aida SMX-0-L2-3000'))).toBe(true);
  });

  it('omits the handling-time term (not a guess) when partWeightKg is unknown', () => {
    const result = computePressStrokeCost('Standard Press', 'standard_press', baseInput({ partWeightKg: undefined }));
    const expectedMin = 0.5 / 60;
    expect(result.cuttingMin).toBeCloseTo(expectedMin, 6);
  });

  it('falls back to PRESS_STROKE_SETUP_MIN and discloses it when no real setup time was resolved', () => {
    const result = computePressStrokeCost('Standard Press', 'standard_press', baseInput({ setupMin: undefined }));
    expect(result.warnings.some((w) => w.includes('setup time from fallback'))).toBe(true);
  });

  it('uses a real resolved setup time without warning when provided', () => {
    const result = computePressStrokeCost('Standard Press', 'standard_press', baseInput({ setupMin: 45 }));
    expect(result.warnings.some((w) => w.includes('setup time from fallback'))).toBe(false);
  });
});

describe('computePressStrokeCost — direct labour cost', () => {
  it('charges labour cost for both setup and run time when a differentiated labour rate is resolved', () => {
    const input = baseInput({
      pressRate: realRate({ labourRate: 36.3 }),
    });
    const result = computePressStrokeCost('Standard Press', 'standard_press', input);
    const line = result.processLines[0]!;

    const machineOnlyRunCost = (result.cuttingMin / 60) * 32.27;
    expect(line.runCost).toBeGreaterThan(machineOnlyRunCost);
    expect(result.warnings.some((w) => w.includes('no direct labor rate'))).toBe(false);
  });

  it('discloses $0 labour (not a guess) when no differentiated rate was resolved', () => {
    const result = computePressStrokeCost('Standard Press', 'standard_press', baseInput({
      pressRate: realRate({ labourRate: null }),
    }));
    expect(result.warnings.some((w) => w.includes('no direct labor rate resolved'))).toBe(true);
  });

  it('falls back to a no_db_rate machine rate (not a guessed number) when no rate is resolved at all', () => {
    const result = computePressStrokeCost('Standard Press', 'standard_press', baseInput({ pressRate: undefined }));
    const line = result.processLines[0]!;

    expect(line.hourlyRate).toBe(0);
    expect(line.rateSource).toBe('no_db_rate');
  });
});

describe('PressStrokeEngine — ManufacturingProcessEngine wrapper', () => {
  it('reports the correct machineClass/processFamily/process label per instance', () => {
    const standard = new PressStrokeEngine('standard_press', 'Standard Press');
    const tandem = new PressStrokeEngine('tandem_press', 'Tandem Press');
    expect(standard.machineClass).toBe('standard_press');
    expect(tandem.machineClass).toBe('tandem_press');
    expect(standard.processFamily).toBe('sheet_metal_forming');
    expect(tandem.processFamily).toBe('sheet_metal_forming');
  });

  it('delegates computeCost to computePressStrokeCost using the context rate/partWeightKg/opSetupMin', () => {
    const engine = new PressStrokeEngine('standard_press', 'Standard Press');
    const result = engine.computeCost({
      sheetThicknessMm: 3,
      cutLengthMm: 0,
      pierceCount: 0,
      holeCount: 0,
      batchSize: 250,
      grade: 'SECC',
      rate: realRate(),
      partWeightKg: 2,
      opSetupMin: 30,
    });

    expect(result.processLines[0]!.process).toBe('Standard Press');
    const expectedMin = (0.5 + 0.03 * 2) / 60;
    expect(result.cuttingMin).toBeCloseTo(expectedMin, 6);
  });
});

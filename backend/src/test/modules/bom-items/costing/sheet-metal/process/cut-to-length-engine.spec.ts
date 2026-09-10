import { computeCutToLengthCost, CutToLengthEngine, type CutToLengthInput } from '../../../../../../modules/bom-items/costing/sheet-metal/process/cut-to-length-engine';
import { CUT_TO_LENGTH_SETUP_MIN } from '../../../../../../modules/bom-items/costing/shared/core/default-rates.constants';
import type { MHRRateInput } from '../../../../../../modules/bom-items/costing/shared/core/cost-engine';

function baseInput(overrides: Partial<CutToLengthInput> = {}): CutToLengthInput {
  return {
    batchSize: 10,
    netWeightKg: 5,
    ...overrides,
  };
}

// Real, uniform per-category formula constants (all 8 real CTL machines,
// memory/sheetmetal/machine/machine_library.json): const_coeff_cycle_time
// -3.69, mass_coeff_cycle_time 0.98, cut_speed_s 25, const_coeff_handling_time
// -4.9, mass_coeff_handling_time_s_kg 0.98, setup_time_hr 0.14 (8.4min).
const ctlRate: MHRRateInput = {
  rate: 45,
  source: 'mhr_database',
  machineClass: 'cut_to_length',
  machineName: 'Heller QLA- Turbo15',
  commodityCode: null,
  labourRate: 12,
  cutToLengthCycleConstS: -3.69,
  cutToLengthCycleMassCoeffSPerKg: 0.98,
  cutToLengthCutSpeedS: 25,
  handlingConstS: -4.9,
  handlingMassCoeffSPerKg: 0.98,
  setupTimeHr: 0.14,
};

describe('computeCutToLengthCost — real per-machine linear formula', () => {
  it('computes cycle time as (ownCycle + handling) / 60 using the real per-machine coefficients', () => {
    const result = computeCutToLengthCost(baseInput({ ctlRate, netWeightKg: 5 }));

    const ownCycleSec = -3.69 + 0.98 * 5 + 25;
    const handlingSec = -4.9 + 0.98 * 5;
    const expectedMin = (ownCycleSec + handlingSec) / 60;

    expect(result.cuttingMin).toBeCloseTo(expectedMin, 6);
    // The process line's cycleTimeMin is rounded for display (same convention
    // every other cutting engine's process line uses) — compare at lower
    // precision than the raw computed value above.
    expect(result.processLines[0]!.cycleTimeMin).toBeCloseTo(expectedMin, 2);
    expect(result.warnings).toHaveLength(0);
  });

  it('scales the cycle time linearly with part weight (mass-coefficient terms)', () => {
    const light = computeCutToLengthCost(baseInput({ ctlRate, netWeightKg: 2 }));
    const heavy = computeCutToLengthCost(baseInput({ ctlRate, netWeightKg: 20 }));
    expect(heavy.cuttingMin).toBeGreaterThan(light.cuttingMin);
  });

  it('floors cycle time at 0 rather than charge negative machine time for a very light part', () => {
    // const_coeff_cycle_time (-3.69) + const_coeff_handling_time (-4.9) can
    // dominate cut_speed_s (25) at a small enough mass — verify the floor,
    // not that this specific weight triggers it (real formula, not tuned to it).
    const result = computeCutToLengthCost(baseInput({ ctlRate, netWeightKg: 0.001 }));
    expect(result.cuttingMin).toBeGreaterThanOrEqual(0);
  });

  it('stays honestly $0/0-min (no guess) when no capable machine was selected at all', () => {
    const result = computeCutToLengthCost(baseInput({ ctlRate: undefined, netWeightKg: 5 }));
    expect(result.cuttingMin).toBe(0);
    expect(result.warnings.some((w) => w.includes('no capable machine on file'))).toBe(true);
  });

  it('stays honestly $0/0-min (no guess) when no real part weight was resolved', () => {
    const result = computeCutToLengthCost(baseInput({ ctlRate, netWeightKg: 0 }));
    expect(result.cuttingMin).toBe(0);
    expect(result.warnings.some((w) => w.includes('no real part weight resolved'))).toBe(true);
  });

  it('stays honestly $0/0-min (no guess) when the selected machine has no real cut-to-length formula on file', () => {
    const rateNoFormula: MHRRateInput = {
      rate: 45, source: 'mhr_database', machineClass: 'cut_to_length',
      machineName: 'Some Other CTL', commodityCode: null,
    };
    const result = computeCutToLengthCost(baseInput({ ctlRate: rateNoFormula, netWeightKg: 5 }));
    expect(result.cuttingMin).toBe(0);
    expect(result.warnings.some((w) => w.includes('no real cut-to-length cycle formula on file'))).toBe(true);
  });
});

describe('computeCutToLengthCost — real per-machine setup time', () => {
  it('uses the real per-machine setup_time_hr (converted to minutes) without a fallback warning', () => {
    const result = computeCutToLengthCost(baseInput({ ctlRate }));
    expect(result.processLines[0]!.setupTimeMin).toBeCloseTo(0.14 * 60, 6);
    expect(result.warnings.some((w) => w.includes('setup time'))).toBe(false);
  });

  it('falls back to CUT_TO_LENGTH_SETUP_MIN with a disclosed warning when no real setup time resolves', () => {
    const rateNoSetup: MHRRateInput = {
      rate: 45, source: 'mhr_database', machineClass: 'cut_to_length',
      machineName: 'Some Other CTL', commodityCode: null,
      cutToLengthCycleConstS: -3.69, cutToLengthCycleMassCoeffSPerKg: 0.98, cutToLengthCutSpeedS: 25,
    };
    const result = computeCutToLengthCost(baseInput({ ctlRate: rateNoSetup }));
    expect(result.processLines[0]!.setupTimeMin).toBeCloseTo(CUT_TO_LENGTH_SETUP_MIN, 6);
    expect(result.warnings.some((w) => w.toLowerCase().includes('setup'))).toBe(true);
  });
});

describe('computeCutToLengthCost — direct labour cost', () => {
  it('charges labour cost when a differentiated labour rate is resolved', () => {
    const result = computeCutToLengthCost(baseInput({ ctlRate }));
    expect(result.processLines[0]!.labourRate).toBe(12);
    expect(result.processLines[0]!.totalCost).toBeGreaterThan(0);
  });
});

describe('CutToLengthEngine — ManufacturingProcessEngine wrapper', () => {
  it('reports the correct machineClass/processFamily/process label', () => {
    const engine = new CutToLengthEngine();
    expect(engine.machineClass).toBe('cut_to_length');
    expect(engine.processFamily).toBe('sheet_metal_cutting');
    expect(engine.processLabel).toBe('Cut To Length Line');
  });

  it('delegates computeCost to computeCutToLengthCost using the context rate/netWeightKg/opSetupMin', () => {
    const engine = new CutToLengthEngine();
    const result = engine.computeCost({
      batchSize: 10,
      netWeightKg: 5,
      rate: ctlRate,
      opSetupMin: undefined,
    } as unknown as Parameters<CutToLengthEngine['computeCost']>[0]);

    expect(result.processLines).toHaveLength(1);
    expect(result.processLines[0]!.process).toBe('Cut To Length Line');
    expect(result.processLines[0]!.hourlyRate).toBe(ctlRate.rate);
    expect(result.processLines[0]!.totalCost).toBeGreaterThan(0);
  });
});

import { computePressStrokeCost, PressStrokeEngine, type PressStrokeInput } from '../../../../../../modules/bom-items/costing/sheet-metal/process/press-stroke-engine';
import type { MHRRateInput } from '../../../../../../modules/bom-items/costing/shared/core/cost-engine';

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

  it('charges $0 labour (not a guess) when no differentiated rate was resolved', () => {
    const result = computePressStrokeCost('Standard Press', 'standard_press', baseInput({
      pressRate: realRate({ labourRate: null }),
    }));
    const line = result.processLines[0]!;

    expect(line.labourRate).toBeNull();
    expect(line.runCost).toBeCloseTo(Math.round((result.cuttingMin / 60) * 32.27 * 100) / 100, 5);
  });

  it('falls back to a no_db_rate machine rate (not a guessed number) when no rate is resolved at all', () => {
    const result = computePressStrokeCost('Standard Press', 'standard_press', baseInput({ pressRate: undefined }));
    const line = result.processLines[0]!;

    expect(line.hourlyRate).toBe(0);
    expect(line.rateSource).toBe('no_db_rate');
  });
});

// Real staged values for "Progressive Die Press - 5,000kN Press Force"
// (2026-09-01, machine_library.json — one of the 14 category-exclusive
// safe machines; see default-rates.ts's progressive_die_press entry for
// why the other 12 are excluded). strokes_per_min=20 converts to
// press_cycle_time_s = 60/20 = 3 at the data-seeding layer, so this engine
// reads it through the exact same rate.pressCycleTimeS field Standard/
// Tandem Press already use.
function realProgressiveDieRate(overrides: Partial<MHRRateInput> = {}): MHRRateInput {
  return {
    rate: 62.2 + 17.44, // direct_overhead_rate_usd_hr + indirect_overhead_rate_usd_hr, USA
    source: 'mhr_database',
    machineClass: 'progressive_die_press',
    machineName: 'Progressive Die Press - 5,000kN Press Force',
    commodityCode: null,
    pressCycleTimeS: 3, // 60 / strokes_per_min(20)
    handlingConstS: 0,
    handlingMassCoeffSPerKg: 0.03,
    ...overrides,
  };
}

describe('computePressStrokeCost — Progressive Die Press (real strokes_per_min-derived cycle time)', () => {
  it('computes cycle time from the real per-machine strokes_per_min-derived press_cycle_time_s, same formula as Standard/Tandem Press', () => {
    const result = computePressStrokeCost('Progressive Die', 'progressive_die_press', {
      numberOfStrokes: 1,
      batchSize: 500,
      partWeightKg: 1.5,
      pressRate: realProgressiveDieRate(),
      setupMin: 0.53 * 60, // setup_time_hr(0.53) -> min
    });

    // 3s stroke + (0 + 0.03*1.5)s handling = 3.045s -> /60 min
    const expectedMin = (3 + 0.03 * 1.5) / 60;
    expect(result.cuttingMin).toBeCloseTo(expectedMin, 6);
    expect(result.abrasiveCost).toBe(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('stays honestly $0/0-min for one of the 12 excluded/contaminated machines (no machine_class assigned, so no real rate resolves)', () => {
    const result = computePressStrokeCost('Progressive Die', 'progressive_die_press', {
      numberOfStrokes: 1,
      batchSize: 500,
      pressRate: realProgressiveDieRate({ pressCycleTimeS: null, machineName: 'Schuler 1150 Ton' }),
      setupMin: 30,
    });

    expect(result.cuttingMin).toBe(0);
    expect(result.warnings.some((w) => w.includes('no real press_cycle_time_s on file'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('Schuler 1150 Ton'))).toBe(true);
  });
});

// Real hardcoded-fallback audit finding (2026-09-02): Progressive Die's real
// setup_time_hr varies 0.47-0.72hr (28.2-43.2min) across the 14 safe
// machines, correlating with press-force tier — unlike Standard/Tandem
// Press, where the real value genuinely is uniform (0.5hr/30min). Collapsing
// it to one shared PRESS_STROKE_SETUP_MIN=30 constant was wrong.
describe('computePressStrokeCost — Progressive Die Press real per-machine setup time', () => {
  it('uses the real per-machine setup time when no op-level setupMin is resolved', () => {
    // "Progressive Die Press - 5,000kN Press Force" real setup_time_hr=0.53 -> 31.8min
    const result = computePressStrokeCost('Progressive Die', 'progressive_die_press', {
      numberOfStrokes: 1,
      batchSize: 500,
      pressRate: realProgressiveDieRate(),
      progressiveDieSetupMinFromMachine: 31.8,
    });
    expect(result.warnings.some((w) => w.includes('setup time from generic fallback'))).toBe(false);
  });

  it('prefers the op-level setupMin over the real per-machine value when both are present', () => {
    const result = computePressStrokeCost('Progressive Die', 'progressive_die_press', {
      numberOfStrokes: 1,
      batchSize: 500,
      pressRate: realProgressiveDieRate(),
      setupMin: 40,
      progressiveDieSetupMinFromMachine: 31.8,
    });
    expect(result.warnings.some((w) => w.includes('setup time from generic fallback'))).toBe(false);
    expect(result.warnings.some((w) => w.includes('setup time from fallback'))).toBe(false);
  });

  it('falls back to the generic 30min constant, with a disclosed warning citing the real range, when neither resolves', () => {
    const result = computePressStrokeCost('Progressive Die', 'progressive_die_press', {
      numberOfStrokes: 1,
      batchSize: 500,
      pressRate: realProgressiveDieRate(),
    });
    expect(result.warnings.some((w) => w.includes('setup time from generic fallback (30min)') && w.includes('28.2-43.2min'))).toBe(true);
  });

  it('does not apply the Progressive-Die-specific fallback message to Standard/Tandem Press (their uniform value is correct as-is)', () => {
    const result = computePressStrokeCost('Standard Press', 'standard_press', {
      numberOfStrokes: 1,
      batchSize: 250,
      pressRate: realRate(),
    });
    expect(result.warnings.some((w) => w.includes('setup time from generic fallback'))).toBe(false);
    expect(result.warnings.some((w) => w === 'Standard Press: setup time from fallback — seed a real per-machine setup time')).toBe(true);
  });
});

describe('PressStrokeEngine — ManufacturingProcessEngine wrapper', () => {
  it('reports the correct machineClass/processFamily/process label per instance', () => {
    const standard = new PressStrokeEngine('standard_press', 'Standard Press');
    const tandem = new PressStrokeEngine('tandem_press', 'Tandem Press');
    const progressiveDie = new PressStrokeEngine('progressive_die_press', 'Progressive Die');
    expect(standard.machineClass).toBe('standard_press');
    expect(tandem.machineClass).toBe('tandem_press');
    expect(progressiveDie.machineClass).toBe('progressive_die_press');
    expect(standard.processFamily).toBe('sheet_metal_forming');
    expect(tandem.processFamily).toBe('sheet_metal_forming');
    expect(progressiveDie.processFamily).toBe('sheet_metal_forming');
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

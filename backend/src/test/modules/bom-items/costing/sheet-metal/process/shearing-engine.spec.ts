import { computePressStrokeCost } from '../../../../../../modules/bom-items/costing/sheet-metal/process/press-stroke-engine';
import { ShearingEngine } from '../../../../../../modules/bom-items/costing/sheet-metal/process/shearing-engine';
import { SHEARING_CUTS_PER_BLANK } from '../../../../../../modules/bom-items/costing/shared/core/default-rates.constants';
import type { MHRRateInput } from '../../../../../../modules/bom-items/costing/shared/core/cost-engine';

// Real staged values for "Chicago - HS 25130" (machine_library.json's
// "Shearing Machine" category, 2026-09-01). shear_speed=11 strokes/min
// converts to press_cycle_time_s = 60/11 at the data-seeding layer, the
// same field Standard/Tandem/Progressive-Die Press already use.
function realShearRate(overrides: Partial<MHRRateInput> = {}): MHRRateInput {
  return {
    rate: 10.46 + 16.22, // direct_overhead_rate_usd_hr + indirect_overhead_rate_usd_hr, USA
    source: 'mhr_database',
    machineClass: 'shear',
    machineName: 'Chicago - HS 25130',
    commodityCode: null,
    pressCycleTimeS: 60 / 11, // 60 / shear_speed(11)
    ...overrides,
  };
}

describe('computePressStrokeCost — Shearing (real shear_speed-derived cycle time, 2-cut blank trim)', () => {
  it('computes cycle time as SHEARING_CUTS_PER_BLANK real strokes, no fabricated single-cut assumption', () => {
    const result = computePressStrokeCost('Shearing', 'shear', {
      numberOfStrokes: SHEARING_CUTS_PER_BLANK,
      batchSize: 100,
      pressRate: realShearRate(),
      setupMin: 22.8,
    });

    const expectedMin = ((60 / 11) * 2) / 60;
    expect(result.cuttingMin).toBeCloseTo(expectedMin, 6);
    expect(result.abrasiveCost).toBe(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('stays honestly $0/0-min (no guess) when no real press_cycle_time_s was resolved for this machine', () => {
    const result = computePressStrokeCost('Shearing', 'shear', {
      numberOfStrokes: SHEARING_CUTS_PER_BLANK,
      batchSize: 100,
      pressRate: realShearRate({ pressCycleTimeS: null, machineName: 'Unclassified Shear' }),
      setupMin: 22.8,
    });

    expect(result.cuttingMin).toBe(0);
    expect(result.warnings.some((w) => w.includes('no real press_cycle_time_s on file'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('Unclassified Shear'))).toBe(true);
  });

  it('falls back to SHEARING_SETUP_MIN (not PRESS_STROKE_SETUP_MIN) and discloses it when no real setup time was resolved', () => {
    const result = computePressStrokeCost('Shearing', 'shear', {
      numberOfStrokes: SHEARING_CUTS_PER_BLANK,
      batchSize: 100,
      pressRate: realShearRate(),
    });

    expect(result.warnings.some((w) => w.includes('setup time from fallback'))).toBe(true);
    expect(result.processLines[0]!.setupCost).toBeGreaterThan(0);
  });

  it('uses a real resolved setup time without warning when provided', () => {
    const result = computePressStrokeCost('Shearing', 'shear', {
      numberOfStrokes: SHEARING_CUTS_PER_BLANK,
      batchSize: 100,
      pressRate: realShearRate(),
      setupMin: 22.8,
    });
    expect(result.warnings.some((w) => w.includes('setup time from fallback'))).toBe(false);
  });
});

describe('computePressStrokeCost — Shearing direct labour cost', () => {
  it('charges labour cost for both setup and run time when a differentiated labour rate is resolved', () => {
    const result = computePressStrokeCost('Shearing', 'shear', {
      numberOfStrokes: SHEARING_CUTS_PER_BLANK,
      batchSize: 100,
      pressRate: realShearRate({ labourRate: 36.3 }),
      setupMin: 22.8,
    });
    const line = result.processLines[0]!;
    const machineOnlyRunCost = (result.cuttingMin / 60) * realShearRate().rate;
    expect(line.runCost).toBeGreaterThan(machineOnlyRunCost);
  });

  it('charges $0 labour (not a guess) when no differentiated rate was resolved', () => {
    const result = computePressStrokeCost('Shearing', 'shear', {
      numberOfStrokes: SHEARING_CUTS_PER_BLANK,
      batchSize: 100,
      pressRate: realShearRate({ labourRate: null }),
      setupMin: 22.8,
    });
    expect(result.processLines[0]!.labourRate).toBeNull();
  });
});

describe('ShearingEngine — ManufacturingProcessEngine wrapper', () => {
  it('reports the correct machineClass/processFamily', () => {
    const engine = new ShearingEngine();
    expect(engine.machineClass).toBe('shear');
    expect(engine.processFamily).toBe('sheet_metal_cutting');
  });

  it('delegates computeCost to computePressStrokeCost with SHEARING_CUTS_PER_BLANK strokes', () => {
    const engine = new ShearingEngine();
    const result = engine.computeCost({
      sheetThicknessMm: 3,
      cutLengthMm: 0,
      pierceCount: 0,
      holeCount: 0,
      batchSize: 100,
      grade: 'SECC',
      rate: realShearRate(),
      opSetupMin: 22.8,
    });

    expect(result.processLines[0]!.process).toBe('Shearing');
    const expectedMin = ((60 / 11) * SHEARING_CUTS_PER_BLANK) / 60;
    expect(result.cuttingMin).toBeCloseTo(expectedMin, 6);
  });
});

// cycle-time.ts: every phase from real inputs — the material's reference
// thermal data (materials_final.csv, what migration 831 / raw_materials carry),
// the press's own timing (machine/injection_molding_machines.csv) and the
// staged Plastic reference (variables, injectionTimeAdjustmentFactors).

import {
  computeCoolingTimeSec,
  computeCycleTime,
  computeFillTimeSec,
  resinThermalProps,
} from '../../../../../../modules/bom-items/costing/plastic-molding/process/cycle-time';
import { realPlasticReference, realPress, realResinInputs } from '../real-plastic-reference';

const REF = realPlasticReference();
const PRESS = realPress('Arburg Allrounder 420 C 1300 - 350');
const ABS = realResinInputs('ABS');

describe('resinThermalProps — the material reference values, no resin-family table', () => {
  it('derives diffusivity from conductivity / (melt density x specific heat)', () => {
    const r = resinThermalProps(ABS, 0);
    if ('missing' in r) throw new Error(r.missing.join());
    // ABS: k 0.127 W/m·K, melt density 885 kg/m³, cp 1.8 J/g·K
    expect(r.props.alpha).toBeCloseTo((0.127 / (885 * 1800)) * 1e6, 6);
    expect(r.props).toMatchObject({ Tm: 240, Tw: 70, Te: 85 });
  });

  it('adds the reference defaultMoldTemperatureIncrease to the mold wall', () => {
    const r = resinThermalProps(ABS, 5);
    if ('missing' in r) throw new Error(r.missing.join());
    expect(r.props.Tw).toBe(75);
  });

  it('names every missing property instead of substituting one', () => {
    const r = resinThermalProps({ ...ABS, densityOfMeltKgM3: null, ejectionTempC: null }, 0);
    expect(r).toEqual({ missing: ['eject temperature', 'density of melt'] });
  });
});

describe('computeCoolingTimeSec — Menges', () => {
  it('has no solution when the eject temperature is not above the mold wall', () => {
    expect(computeCoolingTimeSec(2, { alpha: 0.08, Tm: 240, Tw: 90, Te: 85 })).toBeNull();
  });
});

describe('computeFillTimeSec — press injection rate and the staged adjustment factors', () => {
  it('is shot melt volume over the press rate, times the cavity and gate factors', () => {
    const t = computeFillTimeSec({ shotMeltVolumeMm3: 50_000, injectionRateMm3PerS: 100_000, cavityCount: 4, gatesPerCavity: 1, model: REF.cycleModel });
    const cav = REF.cycleModel.fillFactorByCavities.find((f) => 4 <= f.upTo)!.factor;
    const gate = REF.cycleModel.fillFactorByGates.find((f) => 1 <= f.upTo)!.factor;
    expect(t).toBeCloseTo(0.5 * cav * gate, 2);
  });
});

describe('computeCycleTime', () => {
  const base = { wallMm: 2, isLsr: false, real: ABS, model: REF.cycleModel, press: PRESS.timing, shotMeltVolumeMm3: 20_000, cavityCount: 1, gatesPerCavity: 1 };

  it('sums fill + pack + cooling + the press dry cycle, times cycleTimeAdjustmentFactor, with a trace per phase', () => {
    const r = computeCycleTime(base);
    if (!r.derivable) throw new Error(r.missing.join());
    expect(r.moldMotionSec).toBe(PRESS.timing.dryCycleTimeS);
    expect(r.totalCycleSec).toBeCloseTo((r.fillSec + r.packSec + r.coolSec + r.moldMotionSec) * REF.cycleModel.cycleTimeAdjustmentFactor, 2);
    expect(r.trace.map((t) => t.fieldName)).toEqual(['Cooling Time', 'Fill Time', 'Pack Time', 'Mold Open/Close Time', 'Cycle Time']);
  });

  it('is not derivable without the press timing, the wall, or the material data — and says which', () => {
    const r = computeCycleTime({ ...base, wallMm: null, press: null, real: { ...ABS, specificHeatMeltJgC: null } });
    expect(r.derivable).toBe(false);
    if (r.derivable) return;
    expect(r.missing).toEqual(expect.arrayContaining([
      'nominal wall thickness (CAD)', 'material specific heat of melt',
      'press injection rate (injectionRateMm3PerS)', 'press dry cycle time (dryCycleTimeS)',
    ]));
  });
});

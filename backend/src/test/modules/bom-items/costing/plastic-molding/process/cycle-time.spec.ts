// cycle-time.ts: every phase from real inputs — the material's reference
// thermal data (materials_final.csv, what migration 831 / raw_materials carry),
// the press's own timing (machine/injection_molding_machines.csv) and the
// staged Plastic reference (variables, injectionTimeAdjustmentFactors).

import { hasMengesSolution, resinThermalProps, type CycleTimeInput } from '../../../../../../modules/bom-items/costing/plastic-molding/process/cycle-time';
import { runInjectionCycleTime } from '../../../../../../modules/bom-items/costing/plastic-molding/calculators/plastic-cycle-time';
import { plasticMoldingCalculatorsByName } from '../../../../../../modules/bom-items/costing/plastic-molding/calculators/plastic-molding-calculator-spec';
import { realPlasticReference, realPress, realResinInputs } from '../real-plastic-reference';

// The cycle time is computed by the stored calculators, as the engine does (calculators/plastic-cycle-time.ts); the spec's calculators stand for the database's.
const CALCULATORS = plasticMoldingCalculatorsByName();
const cycle = (input: CycleTimeInput, process: 'injection' | 'structural_foam' = 'injection') => runInjectionCycleTime(input, CALCULATORS, process);

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

describe('the Menges equation has a solution only when the eject temperature lies between the mold wall and the melt', () => {
  it('has none when the eject temperature is not above the mold wall', () => {
    expect(hasMengesSolution(2, { alpha: 0.08, Tm: 240, Tw: 90, Te: 85 })).toBe(false);
    expect(hasMengesSolution(2, { alpha: 0.08, Tm: 240, Tw: 70, Te: 85 })).toBe(true);
  });
});

describe('fill time — press injection rate and the staged adjustment factors, by the stored calculator', () => {
  it('is shot melt volume over the press rate, times the cavity and gate factors', () => {
    const r = cycle({ wallMm: 2, isLsr: false, real: ABS, model: REF.cycleModel, press: { injectionRateMm3PerS: 100_000, dryCycleTimeS: 2 }, shotMeltVolumeMm3: 50_000, cavityCount: 4, gatesPerCavity: 1 });
    if (!r.derivable) throw new Error(r.missing.join());
    const cav = REF.cycleModel.fillFactorByCavities.find((f) => 4 <= f.upTo)!.factor;
    const gate = REF.cycleModel.fillFactorByGates.find((f) => 1 <= f.upTo)!.factor;
    expect(r.fillSec).toBeCloseTo(0.5 * cav * gate, 2);
  });
});

describe('the injection cycle time, by the stored calculator', () => {
  const base = { wallMm: 2, isLsr: false, real: ABS, model: REF.cycleModel, press: PRESS.timing, shotMeltVolumeMm3: 20_000, cavityCount: 1, gatesPerCavity: 1 };

  it('sums fill + pack + cooling + the press dry cycle, times cycleTimeAdjustmentFactor, and shows every input and formula', () => {
    const r = cycle(base);
    if (!r.derivable) throw new Error(r.missing.join());
    expect(r.moldMotionSec).toBe(PRESS.timing.dryCycleTimeS);
    expect(r.totalCycleSec).toBeCloseTo((r.fillSec + r.packSec + r.coolSec + r.moldMotionSec) * REF.cycleModel.cycleTimeAdjustmentFactor, 2);
    expect(r.trace.filter((t) => t.kind === 'calculated').map((t) => t.fieldName)).toEqual(
      ['Mold Wall Temperature', 'Thermal Diffusivity', 'Cooling Time', 'Fill Time', 'Pack to Cooling Ratio', 'Pack Time Minimum', 'Pack Time', 'Cycle Time']);
    expect(r.trace.filter((t) => t.kind === 'input')).toHaveLength(14);
  });

  it('ties each registered step to its formula: id, version and validation state travel with the number', () => {
    const r = cycle(base);
    if (!r.derivable) throw new Error(r.missing.join());
    const by = (name: string) => r.trace.find((t) => t.fieldName === name)!;
    expect(by('Cooling Time')).toMatchObject({ formulaId: 'F-04', state: 'ASSUMED' });
    expect(by('Fill Time')).toMatchObject({ formulaId: 'F-05', state: 'VALIDATED' });
    expect(by('Pack Time')).toMatchObject({ formulaId: 'F-06', state: 'ASSUMED' });
    expect(by('Press Dry Cycle Time')).toMatchObject({ formulaId: 'F-07', state: 'VALIDATED' });
    expect(by('Cycle Time')).toMatchObject({ formulaId: 'F-08', state: 'ASSUMED' });
    // a step that is no registered formula carries none
    expect(by('Mold Wall Temperature').formulaId).toBeUndefined();
  });

  it('names the calculator and a fingerprint of its formulas, which a saved calculation records', () => {
    const r = cycle(base);
    if (!r.derivable) throw new Error(r.missing.join());
    expect(r.calculator).toMatchObject({ name: 'Injection Molding - Cycle Time', version: 1 });
    expect(r.calculator.fingerprint).toMatch(/^[0-9a-f]{16}$/);
    const foam = cycle(base, 'structural_foam');
    if (!foam.derivable) throw new Error(foam.missing.join());
    expect(foam.calculator.name).toBe('Structural Foam Molding - Cycle Time');
    expect(foam.totalCycleSec).toBe(r.totalCycleSec);
  });

  it('with no calculator in the database the cycle is a named gap, never a number', () => {
    for (const calculators of [null, undefined, {}]) {
      const r = runInjectionCycleTime(base, calculators, 'injection');
      expect(r.derivable).toBe(false);
      if (!r.derivable) expect(r.missing.join(' ')).toContain('a calculator for "Injection Molding - Cycle Time"');
    }
  });

  it('uses the LSR calculator for a liquid silicone', () => {
    const r = cycle({ ...base, isLsr: true, real: null });
    if (!r.derivable) throw new Error(r.missing.join());
    expect(r.calculator.name).toBe('Injection Molding - LSR Cycle Time');
    expect(r.packSec).toBe(0);
  });

  it('is not derivable without the press timing, the wall, or the material data — and says which', () => {
    const r = cycle({ ...base, wallMm: null, press: null, real: { ...ABS, specificHeatMeltJgC: null } });
    expect(r.derivable).toBe(false);
    if (r.derivable) return;
    expect(r.missing).toEqual(expect.arrayContaining([
      'nominal wall thickness (CAD)', 'material specific heat of melt',
      'press injection rate (injectionRateMm3PerS)', 'press dry cycle time (dryCycleTimeS)',
    ]));
  });
});

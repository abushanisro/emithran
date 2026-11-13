import { readFileSync } from 'fs';
import { join } from 'path';

import { loadPlasticMoldingCalculatorSpec, plasticMoldingCalculatorsByName, plasticMoldingCalculatorsFromSpec } from '../../../../../modules/bom-items/costing/plastic-molding/calculators/plastic-molding-calculator-spec';
import { buildPlasticMoldingCalculatorsMigrationSql } from '../../../../../modules/bom-items/costing/plastic-molding/calculators/plastic-molding-calculators-migration';
import {
  COMPRESSION_CALCULATOR, INJECTION_CALCULATOR, LSR_CALCULATOR, RIM_CALCULATOR, STRUCTURAL_FOAM_CALCULATOR,
  injectionCalculatorName, injectionCycleTimeSeeds, pressCycleTimeSeeds, rimCycleTimeSeeds,
} from '../../../../../modules/bom-items/costing/plastic-molding/calculators/plastic-cycle-time-seeds';
import { calculatorFingerprint, runInjectionCycleTime } from '../../../../../modules/bom-items/costing/plastic-molding/calculators/plastic-cycle-time';
import { computeCycleTime, type CycleTimeInput } from './legacy-cycle-time-oracle';
import type { CycleTimeInput as EngineCycleInput } from '../../../../../modules/bom-items/costing/plastic-molding/process/cycle-time';
import { computeCompressionMoldingCost } from '../../../../../modules/bom-items/costing/plastic-molding/process/cost-compression-molding-engine';
import { runReferenceCalculator, type ReferenceCalculators } from '../../../../../modules/bom-items/costing/shared/calculators/reference-calculator';
import type { MHRRateInput } from '../../../../../modules/bom-items/costing/shared/core/cost-engine';
import { allRealPresses, realCureTimeMin, realFillFactorRows, realMaterialNames, realOperationCatalog, realPlasticReference, realResinInputs, realRimMachines } from './real-plastic-reference';

const MODEL = realPlasticReference().cycleModel;
const BY_NAME = plasticMoldingCalculatorsByName();
const BY_OPERATION = plasticMoldingCalculatorsFromSpec();

/** The calculator of a name, run on seeds, as the engine will run it. */
function run(name: string, seeds: Record<string, import('../../../../../modules/bom-items/costing/shared/calculators/reference-calculator').CalcSeed>) {
  const calculators: ReferenceCalculators = { [name]: BY_NAME[name]! };
  return runReferenceCalculator(calculators, name, seeds);
}

describe('plastic molding calculator spec', () => {
  const spec = loadPlasticMoldingCalculatorSpec();

  it('has one cycle-time calculator for each of the four molding processes, and an LSR helper no catalog operation maps to', () => {
    expect(spec.processGroup).toBe('Plastic Molding');
    expect(spec.calculators.filter((c) => !c.helper).map((c) => c.operations[0]).sort()).toEqual(
      ['Compression Molding', 'Injection Molding', 'Reaction Injection Molding', 'Structural foam molding']);
    expect(spec.calculators.filter((c) => c.helper).map((c) => c.name)).toEqual([LSR_CALCULATOR]);
  });

  it('every operation it computes is a process of the reference catalog (digital_factory_operations.csv)', () => {
    const catalog = Object.keys(realOperationCatalog()).map((p) => p.toLowerCase());
    for (const c of spec.calculators.filter((x) => !x.helper)) expect(catalog).toContain(c.operations[0]!.toLowerCase());
  });

  it('every input says where its value comes from, and every calculated field is a formula over earlier fields', () => {
    for (const c of spec.calculators) {
      for (const f of c.fields) expect(Boolean(f.formula) !== Boolean(f.source)).toBe(true);
      expect(c.fields[c.fields.length - 1]!.name).toBe('Cycle Time');
    }
  });

  it('structural foam is the injection calculator with the same fields: the physics is the same and cannot drift apart', () => {
    const inj = spec.calculators.find((c) => c.name === INJECTION_CALCULATOR)!;
    const sfm = spec.calculators.find((c) => c.name === STRUCTURAL_FOAM_CALCULATOR)!;
    expect(sfm.fields).toEqual(inj.fields);
    expect(sfm.description).toContain('NOT modelled');
  });

  it('the committed migrations 976 and 1007 are exactly what the generator writes from the spec (975 and 977 are history and are not edited)', () => {
    const committed = (file: string) => readFileSync(join(__dirname, '../../../../../../migrations', file), 'utf8');
    expect(committed('976_plastic_rim_fill_time_calculator.sql')).toBe(buildPlasticMoldingCalculatorsMigrationSql(976));
    expect(committed('1007_plastic_injection_cycle_plasticizing_ejection.sql')).toBe(buildPlasticMoldingCalculatorsMigrationSql(1007));
    const quoted = (name: string) => '$q$' + name + '$q$';
    // 1007 writes injection and structural foam, at version 2; LSR, compression and RIM are not in it
    expect(spec.calculators.filter((c) => c.migration === 1007).map((c) => [c.name, c.version])).toEqual([[INJECTION_CALCULATOR, 2], [STRUCTURAL_FOAM_CALCULATOR, 2]]);
    const m1007 = committed('1007_plastic_injection_cycle_plasticizing_ejection.sql');
    for (const name of [LSR_CALCULATOR, COMPRESSION_CALCULATOR, RIM_CALCULATOR]) expect(m1007).not.toContain(quoted(name));
    expect(m1007).toContain('version = 2');
    // the history files keep what they wrote
    expect(committed('975_plastic_molding_calculators.sql')).toContain(quoted(INJECTION_CALCULATOR));
    for (const name of [INJECTION_CALCULATOR, LSR_CALCULATOR, STRUCTURAL_FOAM_CALCULATOR]) expect(committed('977_plastic_fill_factor_lookup_tables.sql')).toContain(quoted(name));
    // the two fill factors of each injection calculator carry their staged table, and the thermoplastic plasticizing rate its fallback table
    const tabled = spec.calculators.flatMap((c) => c.fields.filter((f) => f.sourceTable).map((f) => `${c.key}:${f.name}:${f.dataSource}:${f.sourceTable}.${f.sourceField}`));
    expect(tabled.sort()).toEqual([
      ...['injection', 'injection_lsr', 'structural_foam'].flatMap((k) => ['Fill Factor for Cavities', 'Fill Factor for Gates'].map((n) => `${k}:${n}:machining_lookup:injectionTimeAdjustmentFactors.adjustment_factor`)),
      ...['injection', 'structural_foam'].map((k) => `${k}:Press Plasticizing Rate:machining_lookup:plasticizingRateByClampForce.Plasticizing Rate (g / s)`),
    ].sort());
  });

  it('the calculators the formulas run on are the same with or without the table metadata (a fingerprint covers formulas, units and field names)', () => {
    const inj = plasticMoldingCalculatorsByName()[INJECTION_CALCULATOR]!;
    expect(inj.fields.filter((f) => f.source_table).map((f) => f.field_name)).toEqual(['Fill Factor for Cavities', 'Fill Factor for Gates', 'Press Plasticizing Rate']);
    expect(calculatorFingerprint({ ...inj, fields: inj.fields.map((f) => ({ ...f, data_source: null, source_table: null, source_field: null })) })).toBe(calculatorFingerprint(inj));
  });

  it('the calculator descriptions say what is not modelled, so no one reads them as complete', () => {
    const text = (n: string) => spec.calculators.find((c) => c.name === n)!.description;
    expect(text(INJECTION_CALCULATOR)).toMatch(/Not modelled.*robotic part handling.*slides and lifters/s);
    expect(text(INJECTION_CALCULATOR)).toMatch(/holding pressure is inside it and is not added again/);
    expect(text(COMPRESSION_CALCULATOR)).toMatch(/charging, preheat, flash trimming/);
    expect(text(RIM_CALCULATOR)).toMatch(/F-19/);
    expect(text(RIM_CALCULATOR)).toMatch(/runner and sprue volume/);
  });
});

// ── version 2: the stored calculator gives the reference model, phase by phase ──────────────────────────────────────
// Cooling is unchanged, so it still equals the frozen oracle (the in-code math the calculator replaced). The other phases are written out here
// from the reference variables, independently of the calculator: injection at the derated press rate; plasticizing of the next shot, which counts
// only beyond cooling; ejection = mold open/close + the ejector stroke; and no pack phase on top of cooling.
const r2 = (v: number) => Math.floor(v * 100 + 0.5) / 100;
function expectedV2(input: EngineCycleInput & { shotGppsMassG: number; partHeightMm: number }, coolSec: number) {
  const m = MODEL;
  const press = input.press!;
  const fc = m.fillFactorByCavities.find((r) => input.cavityCount <= r.upTo)?.factor ?? m.fillFactorByCavities[m.fillFactorByCavities.length - 1]!.factor;
  const fg = m.fillFactorByGates.find((r) => input.gatesPerCavity <= r.upTo)?.factor ?? m.fillFactorByGates[m.fillFactorByGates.length - 1]!.factor;
  const injection = r2(input.shotMeltVolumeMm3! / (press.injectionRateMm3PerS! * m.injectionRateMultiplier) * fc * fg);
  const rate = press.plasticizingRateGPerS ?? m.plasticizingRateByClampKn.find((r) => input.pressClampKn! <= r.clampKn)!.gPerS;
  const plasticizing = r2(input.shotGppsMassG / (rate * m.plasticizingRateMultiplier));
  const speed = 2 * m.dryCycleStrokeFactor * press.openingStrokeMm! / press.dryCycleTimeS!;
  const ejection = press.dryCycleTimeS! + r2(m.numEjectorCycles * 2 * m.ejectorDistanceFactor * input.partHeightMm / (speed * m.ejectorPercentMaxMachineVelocity / 100));
  return { injection, plasticizing, ejection, total: r2((injection + coolSec + Math.max(0, plasticizing - coolSec) + ejection) * m.cycleTimeAdjustmentFactor) };
}

describe('injection and structural foam (version 2): cooling as before, plus injection, plasticizing and ejection from the reference', () => {
  const presses = allRealPresses().filter((_, i) => i % 6 === 0);
  const resins = realMaterialNames().filter((_, i) => i % 4 === 0);
  const walls = [0.8, 1.5, 2.5, 4.2];
  const layouts: Array<[number, number]> = [[1, 1], [2, 1], [4, 2], [8, 3], [16, 4]];
  const volumes = [4_000, 55_000, 310_000];
  const v2 = (base: EngineCycleInput, press: ReturnType<typeof allRealPresses>[number], height = 40): EngineCycleInput & { shotGppsMassG: number; partHeightMm: number } =>
    ({ ...base, shotGppsMassG: (base.shotMeltVolumeMm3 ?? 0) * 1e-3, partHeightMm: height, pressClampKn: press.clampKn });

  it('agrees to the last digit across real presses, real resins, walls, cavity layouts and shot sizes', () => {
    let derivable = 0, notDerivable = 0, plasticizingBeyondCooling = 0, fromTable = 0;
    for (const press of presses) for (const resin of resins) {
      const real = realResinInputs(resin);
      for (const wall of walls) for (const [cav, gates] of layouts) for (const vol of volumes) {
        const input = v2({ wallMm: wall, isLsr: false, real, model: MODEL, press: press.timing, shotMeltVolumeMm3: vol * cav, cavityCount: cav, gatesPerCavity: gates }, press);
        const oracle = computeCycleTime(input);
        const seeded = injectionCycleTimeSeeds(input);
        if (!oracle.derivable || !press.timing.openingStrokeMm) {
          notDerivable += 1;
          expect('missing' in seeded).toBe(true);
          continue;
        }
        derivable += 1;
        if (!('seeds' in seeded)) throw new Error(`seeds must exist: ${press.name} ${resin}`);
        const want = expectedV2(input, oracle.coolSec);
        const r = run(INJECTION_CALCULATOR, seeded.seeds);
        expect(r.missing).toEqual([]);
        expect(r.outputs['Cooling Time']).toBe(oracle.coolSec);
        expect(r.outputs['Injection Time']).toBe(want.injection);
        expect(r.outputs['Plasticizing Time']).toBe(want.plasticizing);
        expect(r.outputs['Ejection Time']).toBeCloseTo(want.ejection, 10);
        expect(r.value).toBe(want.total);
        expect(r.outputs['Pack Time']).toBeUndefined();
        if (want.plasticizing > oracle.coolSec) plasticizingBeyondCooling += 1;
        if (press.timing.plasticizingRateGPerS == null) fromTable += 1;
        for (const process of ['injection', 'structural_foam'] as const) {
          const viaEngine = runInjectionCycleTime(input, BY_NAME, process);
          if (!viaEngine.derivable) throw new Error(viaEngine.missing.join());
          expect(viaEngine).toMatchObject({ totalCycleSec: want.total, coolSec: oracle.coolSec, fillSec: want.injection, plasticizingSec: want.plasticizing });
        }
      }
    }
    // the grid is real: both outcomes, plasticizing that outlasts cooling, and presses whose rate comes from the clamp-force table
    expect(derivable).toBeGreaterThan(1000);
    expect(notDerivable).toBeGreaterThan(0);
    expect(plasticizingBeyondCooling).toBeGreaterThan(0);
    expect(fromTable).toBeGreaterThan(0);
  });

  it('is shorter than version 1 by the pack phase it no longer adds, before the new phases', () => {
    const press = presses.find((p) => p.timing.plasticizingRateGPerS && p.timing.openingStrokeMm)!;
    const input = v2({ wallMm: 2.5, isLsr: false, real: realResinInputs(resins[0]!), model: MODEL, press: press.timing, shotMeltVolumeMm3: 50_000, cavityCount: 1, gatesPerCavity: 1 }, press);
    const oracle = computeCycleTime(input);
    const viaEngine = runInjectionCycleTime(input, BY_NAME, 'injection');
    if (!oracle.derivable || !viaEngine.derivable) throw new Error('fixture must be derivable');
    const newPhases = viaEngine.fillSec + Math.max(0, viaEngine.plasticizingSec - viaEngine.coolSec) + viaEngine.ejectionSec;
    expect(viaEngine.totalCycleSec).toBeCloseTo(oracle.totalCycleSec - oracle.packSec - oracle.fillSec - oracle.moldMotionSec + newPhases, 1);
  });

  it('takes the plasticizing rate from the press record, else the clamp-force table row at or above the clamp force, and says which', () => {
    const press = presses.find((p) => p.timing.plasticizingRateGPerS && p.timing.openingStrokeMm)!;
    const base = v2({ wallMm: 2, isLsr: false, real: realResinInputs(resins[0]!), model: MODEL, press: press.timing, shotMeltVolumeMm3: 50_000, cavityCount: 1, gatesPerCavity: 1 }, press);
    const own = injectionCycleTimeSeeds(base);
    if (!('seeds' in own)) throw new Error('fixture must be derivable');
    expect(own.seeds['Press Plasticizing Rate']).toMatchObject({ value: press.timing.plasticizingRateGPerS, source: expect.stringContaining('plasticizingRateGppsGPerS') });
    const table = injectionCycleTimeSeeds({ ...base, press: { ...base.press!, plasticizingRateGPerS: null }, pressClampKn: 340 });
    if (!('seeds' in table)) throw new Error('fixture must be derivable');
    expect(table.seeds['Press Plasticizing Rate']).toMatchObject({ value: 1.34, lookup: true, match: { table: 'plasticizingRateByClampForce', row: { 'Clamp Force (kN)': 350 } } });
  });

  it('structural foam, which reuses the injection model, gives the same numbers through its own calculator', () => {
    const press = presses.find((p) => p.timing.openingStrokeMm)!;
    const input = v2({ wallMm: 3, isLsr: false, real: realResinInputs(resins[0]!), model: MODEL, press: press.timing, shotMeltVolumeMm3: 90_000, cavityCount: 2, gatesPerCavity: 1 }, press);
    const seeded = injectionCycleTimeSeeds(input);
    if (!('seeds' in seeded)) throw new Error('fixture must be derivable');
    expect(run(STRUCTURAL_FOAM_CALCULATOR, seeded.seeds).value).toBe(run(INJECTION_CALCULATOR, seeded.seeds).value);
    expect(injectionCalculatorName(false, 'structural_foam')).toBe(STRUCTURAL_FOAM_CALCULATOR);
  });

  it('is reached through the operation the catalog names (the mapping), not only by name', () => {
    expect(BY_OPERATION['Injection Molding']!.name).toBe(INJECTION_CALCULATOR);
    expect(BY_OPERATION['Structural foam molding']!.name).toBe(STRUCTURAL_FOAM_CALCULATOR);
    expect(BY_OPERATION['Compression Molding']!.name).toBe(COMPRESSION_CALCULATOR);
    expect(BY_OPERATION['Reaction Injection Molding']!.name).toBe(RIM_CALCULATOR);
  });

  it('names every missing input, and never fills one', () => {
    const press = presses.find((p) => p.timing.plasticizingRateGPerS && p.timing.openingStrokeMm)!;
    const base = v2({ wallMm: 2, isLsr: false, real: realResinInputs(resins[0]!), model: MODEL, press: press.timing, shotMeltVolumeMm3: 50_000, cavityCount: 1, gatesPerCavity: 1 }, press);
    const missing = (broken: EngineCycleInput) => { const r = injectionCycleTimeSeeds(broken); return 'missing' in r ? r.missing.join('; ') : ''; };
    expect(missing({ ...base, wallMm: null })).toContain('nominal wall thickness');
    expect(missing({ ...base, press: { ...base.press!, injectionRateMm3PerS: null } })).toContain('press injection rate');
    expect(missing({ ...base, press: { ...base.press!, dryCycleTimeS: 0 } })).toContain('press dry cycle time');
    expect(missing({ ...base, shotMeltVolumeMm3: null })).toContain('shot melt volume');
    expect(missing({ ...base, real: { ...base.real!, thermalConductivityMeltWMK: null } })).toContain('thermal conductivity');
    expect(missing({ ...base, partHeightMm: null })).toContain('part height');
    expect(missing({ ...base, shotGppsMassG: null })).toContain('shot GPPS-equivalent mass');
    expect(missing({ ...base, press: { ...base.press!, openingStrokeMm: null } })).toContain('press opening stroke');
    expect(missing({ ...base, press: { ...base.press!, plasticizingRateGPerS: null }, pressClampKn: null })).toContain('press plasticizing rate');
  });

  it('a temperature set with no Menges solution is missing, not a cycle', () => {
    const real = { ...realResinInputs(resins[0]!), ejectionTempC: 10_000 };
    const input: CycleTimeInput = { wallMm: 2, isLsr: false, real, model: MODEL, press: presses[0]!.timing, shotMeltVolumeMm3: 50_000, cavityCount: 1, gatesPerCavity: 1 };
    expect(computeCycleTime(input).derivable).toBe(false);
    const seeded = injectionCycleTimeSeeds(input);
    expect('missing' in seeded && seeded.missing.join(' ')).toContain('no Menges solution');
  });

  it('the trace gives every input with its source, the lookup rows it used, and every formula in order', () => {
    const press = presses.find((p) => p.timing.plasticizingRateGPerS && p.timing.openingStrokeMm)!;
    const input = v2({ wallMm: 2.5, isLsr: false, real: realResinInputs(resins[0]!), model: MODEL, press: press.timing, shotMeltVolumeMm3: 90_000, cavityCount: 4, gatesPerCavity: 2 }, press);
    const seeded = injectionCycleTimeSeeds(input);
    if (!('seeds' in seeded)) throw new Error('fixture must be derivable');
    const r = run(INJECTION_CALCULATOR, seeded.seeds);
    const inputs = r.trace.filter((t) => t.kind === 'input');
    expect(inputs.length).toBe(24);
    expect(inputs.every((t) => typeof t.source === 'string' && t.source.length > 0)).toBe(true);
    expect(inputs.filter((t) => t.stepType === 'lookup').map((t) => t.fieldName)).toEqual(['Fill Factor for Cavities', 'Fill Factor for Gates']);
    expect(r.lookups['Fill Factor for Cavities']).toEqual({ table: 'injectionTimeAdjustmentFactors', row: { attribute: 'Cavities Per Mold', number: 5 } });
    expect(r.lookups['Fill Factor for Gates']).toEqual({ table: 'injectionTimeAdjustmentFactors', row: { attribute: 'Gates Per Cavity', number: 2 } });
    const formulas = r.trace.filter((t) => t.kind === 'calculated');
    expect(formulas.map((t) => t.fieldName)).toEqual(['Mold Wall Temperature', 'Thermal Diffusivity', 'Cooling Time', 'Injection Time', 'Plasticizing Time', 'Press Platen Speed', 'Ejector Stroke Time', 'Ejection Time', 'Cycle Time']);
    expect(formulas.every((t) => typeof t.formula === 'string' && t.formula.length > 0)).toBe(true);
  });
});

describe('liquid silicone: the LSR calculator gives the engine\'s numbers', () => {
  it('agrees with the engine (cure instead of cooling, no pack phase)', () => {
    const presses = allRealPresses().filter((_, i) => i % 9 === 0);
    let compared = 0;
    for (const press of presses) for (const wall of [0.5, 1, 2, 3.5]) for (const [cav, gates] of [[1, 1], [4, 2], [16, 3]] as Array<[number, number]>) {
      const input: CycleTimeInput = { wallMm: wall, isLsr: true, real: null, model: MODEL, press: press.timing, shotMeltVolumeMm3: 40_000 * cav, cavityCount: cav, gatesPerCavity: gates };
      const engine = computeCycleTime(input);
      const seeded = injectionCycleTimeSeeds(input);
      if (!engine.derivable) { expect('missing' in seeded).toBe(true); continue; }
      if (!('seeds' in seeded)) throw new Error('seeds must exist when the engine derives a cycle');
      const r = run(injectionCalculatorName(true, 'injection'), seeded.seeds);
      expect(r.value).toBe(engine.totalCycleSec);
      expect(r.outputs['Cure Time']).toBe(engine.coolSec);
      compared += 1;
    }
    expect(compared).toBeGreaterThan(50);
  });
});

describe('compression: the calculator gives the numbers the engine gave', () => {
  const rate = (pressCycleTimeS: number | null) =>
    ({ rate: 60, source: 'mhr_database', machineClass: 'x', machineName: 'M', commodityCode: null, pressCycleTimeS, setupTimeHr: 0.5 }) as unknown as MHRRateInput;
  const input = (pressCycleTimeS: number | null, cureTimeMin: number | null) => ({ batchSize: 1000, partWeightKg: 0.2, rate: rate(pressCycleTimeS), cureTimeMinFromMaterial: cureTimeMin });
  const cures = realMaterialNames().map((n) => realCureTimeMin(n));
  const presses = [3, 7.5, 12.25, 41.6, 95];

  it('press open/close time plus cure time, with and without a cure time on file', () => {
    let withCure = 0, withoutCure = 0;
    for (const press of presses) for (const cure of [...new Set(cures)]) {
      const seeded = pressCycleTimeSeeds({ pressCycleTimeS: press, cureTimeMin: cure });
      if (!('seeds' in seeded)) throw new Error('seeds expected');
      const r = run(COMPRESSION_CALCULATOR, seeded.seeds);
      // the oracle: what the engine did before the calculators: the press cycle plus the cure time when one is on file, over 60, for one stroke
      const legacyMin = (press + (cure != null ? cure * 60 : 0)) / 60;
      expect(r.value! / 60).toBeCloseTo(legacyMin, 12);
      const viaEngine = computeCompressionMoldingCost({ ...input(press, cure), calculators: BY_NAME });
      expect(viaEngine.cuttingMin).toBeCloseTo(legacyMin, 12);
      expect(viaEngine.processLines[0]!.calculationTrace?.some((t) => t.fieldName === 'Cycle Time')).toBe(true);
      cure == null || !(cure > 0) ? (withoutCure += 1) : (withCure += 1);
    }
    expect(withCure).toBeGreaterThan(3);
    expect(withoutCure).toBeGreaterThan(0);
  });

  it('a machine with no cycle time on file is missing, as it is for the engine (no cycle is invented)', () => {
    const seeded = pressCycleTimeSeeds({ pressCycleTimeS: null, cureTimeMin: 3 });
    expect('missing' in seeded && seeded.missing[0]).toContain('press_cycle_time_s');
    expect(computeCompressionMoldingCost(input(null, 3)).processLines[0]!.cycleTimeMin).toBe(0);
  });

  it('a grade with no cure time says so in the trace and is understated, not given a typical time', () => {
    const seeded = pressCycleTimeSeeds({ pressCycleTimeS: 20, cureTimeMin: null });
    if (!('seeds' in seeded)) throw new Error('seeds expected');
    const r = run(COMPRESSION_CALCULATOR, seeded.seeds);
    expect(r.value).toBe(20);
    expect(r.trace.find((t) => t.fieldName === 'Material Cure Time')?.source).toContain('not included');
  });
});

describe('reaction injection (version 2): dry cycle + fill + cure, the fill being volume (mm3) over the machine rate (mm3/s)', () => {
  const RIM = realRimMachines();
  const cures = [...new Set(realMaterialNames().map((n) => realCureTimeMin(n)))];
  const volumes = [150, 4_000, 80_000, 650_000, 4_200_000, 25_000_000];

  it('equals dry + volume/rate + cure for every real RIM machine, volume and cure time, in seconds', () => {
    let n = 0;
    for (const m of RIM) for (const volume of volumes) for (const cure of cures) {
      const seeded = rimCycleTimeSeeds({ machineCycleTimeS: m.dryCycleTimeS, partVolumeMm3: volume, injectionRateMm3PerS: m.injectionRateMm3PerS, cureTimeMin: cure });
      if (!('seeds' in seeded)) throw new Error('seeds expected');
      const r = run(RIM_CALCULATOR, seeded.seeds);
      // independent arithmetic: seconds = mm3 / (mm3/s); the cure in minutes is converted once
      const fill = volume / m.injectionRateMm3PerS;
      const cureSec = cure != null && cure > 0 ? cure * 60 : 0;
      expect(r.outputs['Fill Time']).toBeCloseTo(fill, 12);
      expect(r.value).toBeCloseTo(m.dryCycleTimeS + fill + cureSec, 9);
      n += 1;
    }
    expect(n).toBe(RIM.length * volumes.length * cures.length);
    expect(n).toBeGreaterThan(40);
  });

  it('is the old cycle (dry + cure) plus exactly the fill: the rest is unchanged', () => {
    const m = RIM[0]!;
    const before = (cure: number) => m.dryCycleTimeS + cure * 60;
    const seeded = rimCycleTimeSeeds({ machineCycleTimeS: m.dryCycleTimeS, partVolumeMm3: 1_000_000, injectionRateMm3PerS: m.injectionRateMm3PerS, cureTimeMin: 4 });
    if (!('seeds' in seeded)) throw new Error('seeds expected');
    expect(run(RIM_CALCULATOR, seeded.seeds).value! - before(4)).toBeCloseTo(1_000_000 / m.injectionRateMm3PerS, 9);
  });

  it('names a missing, zero, negative or non-finite volume, rate or dry cycle: never defaulted', () => {
    const ok = { machineCycleTimeS: 10, partVolumeMm3: 5_000, injectionRateMm3PerS: 100_000, cureTimeMin: 3 };
    for (const [over, named] of [
      [{ partVolumeMm3: null }, 'part volume'], [{ partVolumeMm3: 0 }, 'part volume'], [{ partVolumeMm3: -1 }, 'part volume'], [{ partVolumeMm3: Number.POSITIVE_INFINITY }, 'part volume'],
      [{ injectionRateMm3PerS: null }, 'machine injection rate'], [{ injectionRateMm3PerS: 0 }, 'machine injection rate'], [{ injectionRateMm3PerS: -3 }, 'machine injection rate'], [{ injectionRateMm3PerS: Number.NaN }, 'machine injection rate'],
      [{ machineCycleTimeS: null }, 'machine dry cycle time'], [{ machineCycleTimeS: 0 }, 'machine dry cycle time'],
    ] as Array<[Partial<typeof ok>, string]>) {
      const seeded = rimCycleTimeSeeds({ ...ok, ...over });
      expect('missing' in seeded && seeded.missing.join(' ')).toContain(named);
    }
  });

  it('names every missing input at once', () => {
    const seeded = rimCycleTimeSeeds({ machineCycleTimeS: null, partVolumeMm3: null, injectionRateMm3PerS: null, cureTimeMin: null });
    expect('missing' in seeded && seeded.missing).toHaveLength(3);
  });

  it('shows units on the trace so the fill can be read: mm3, mm3/s, seconds', () => {
    const seeded = rimCycleTimeSeeds({ machineCycleTimeS: 10, partVolumeMm3: 80_000, injectionRateMm3PerS: 100_000, cureTimeMin: 3 });
    if (!('seeds' in seeded)) throw new Error('seeds expected');
    const r = run(RIM_CALCULATOR, seeded.seeds);
    const unit = (name: string) => r.trace.find((t) => t.fieldName === name)?.unit;
    expect({ volume: unit('Part Volume'), rate: unit('Machine Injection Rate'), shot: unit('Total Shot Volume'), fill: unit('Fill Time'), cycle: unit('Cycle Time') })
      .toEqual({ volume: 'mm³', rate: 'mm³/s', shot: 'mm³', fill: 's', cycle: 's' });
    expect(r.outputs['Total Shot Volume']).toBe(80_000);
    expect(r.outputs['Fill Time']).toBeCloseTo(0.8, 12);
  });
});

describe('the written report of the calculators', () => {
  it('docs/plastic-modeling/cycle-time-calculators.md is exactly what the generator writes (it cannot go stale)', () => {
    const { buildPlasticCalculatorReport } = jest.requireActual('../../../../../modules/bom-items/costing/plastic-molding/calculators/plastic-calculator-report') as typeof import('../../../../../modules/bom-items/costing/plastic-molding/calculators/plastic-calculator-report');
    const doc = readFileSync(join(__dirname, '../../../../../../../docs/plastic-modeling/cycle-time-calculators.md'), 'utf8');
    expect(doc).toBe(buildPlasticCalculatorReport({ spec: loadPlasticMoldingCalculatorSpec(), catalog: realOperationCatalog(), fillFactorRows: realFillFactorRows() }));
  });

  it('shows each process\'s own feature lookup table and calculation', () => {
    const doc = readFileSync(join(__dirname, '../../../../../../../docs/plastic-modeling/cycle-time-calculators.md'), 'utf8');
    for (const process of ['Injection Molding', 'Structural Foam Molding', 'Compression Molding', 'Reaction Injection Molding']) {
      expect(doc).toContain(`## ${process}`);
      expect(doc).toContain(`Operations the reference lists for ${process}`);
    }
    expect(doc).toContain('| PartingLine | Manual Flash Trimming |'); // compression only
  });
});

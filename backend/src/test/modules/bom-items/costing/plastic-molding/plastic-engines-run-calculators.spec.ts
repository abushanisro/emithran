import { canonicalReferenceRows } from '../../../../../modules/bom-items/costing/plastic-molding/plastic-reference';
import { replayPlasticLine } from '../../../../../modules/bom-items/costing/plastic-molding/calculation-replay';
import type { CalculationSnapshot } from '../../../../../modules/bom-items/costing/plastic-molding/calculation-snapshot';
import { calculatorFingerprint } from '../../../../../modules/bom-items/costing/plastic-molding/calculators/plastic-cycle-time';
import { plasticMoldingCalculatorsByName } from '../../../../../modules/bom-items/costing/plastic-molding/calculators/plastic-molding-calculator-spec';
import { computeCompressionMoldingCost } from '../../../../../modules/bom-items/costing/plastic-molding/process/cost-compression-molding-engine';
import { computeInjectionMoldedCostSummary, type InjectionMoldingCostInput } from '../../../../../modules/bom-items/costing/plastic-molding/process/cost-injection-molding-engine';
import { computeReactionInjectionMoldingCost } from '../../../../../modules/bom-items/costing/plastic-molding/process/cost-reaction-injection-molding-engine';
import type { MHRRateInput } from '../../../../../modules/bom-items/costing/shared/core/cost-engine';
import { realMaterialClamp, realPlasticReference, realPress, realReferenceRows, realResinInputs } from './real-plastic-reference';

// "Calculator driven": the cost engine does not compute a molding cycle time itself. It seeds the stored calculator of the line's process and passes the result on, and the line
// carries the run, so the cost dialog opens that calculator filled with the engine's inputs, the way heat treatment, machining and die casting do.

const CALCULATORS = plasticMoldingCalculatorsByName();
const PRESS = realPress('Arburg Allrounder 420 C 1300 - 350');
const rate = (machineClass: string, usd: number, name: string | null) => ({ rate: usd, labourRate: 34.48, operators: 0.5, source: 'mhr_database' as const, machineClass, machineName: name, commodityCode: null });
const part = (over: Partial<InjectionMoldingCostInput> = {}): InjectionMoldingCostInput => ({
  volume: 50_000, surfaceArea: 40_000, wallThicknessNominalMm: 2, materialGrade: 'ABS', materialCostPerKg: 3.046, materialDensityKgM3: 1040, materialSource: 'db',
  batchSize: 250, family: 'plastic_molded', mhrRate: { ...rate('injection_molding', PRESS.mhrUsd, 'Arburg Allrounder 420 C 1300 - 350'), setupTimeHr: 2 },
  // The part's height along the pull: the ejector stroke of the cycle (calculator version 2).
  bboxMinMm: 30,
  deburrRate: rate('deburring', 0, null), inspectionRate: rate('cmm', 0, null), machineClampTonnes: PRESS.maxTonnage, machineShotCapacityG: PRESS.shotCapacityGrams,
  pressTiming: PRESS.timing, goodPartYield: PRESS.goodPartYield, calculators: CALCULATORS, materialClamp: realMaterialClamp('ABS'), realResinInputs: realResinInputs('ABS'), materialType: 'ABS',
  plasticReference: realPlasticReference(), location: 'USA', annualVolume: 100_000, productionLifeYears: 3, signals: { projectedAreaMm2: 10_000, undercutCount: 0 },
  ...over,
});
const moldingLine = (r: ReturnType<typeof computeInjectionMoldedCostSummary>) => r.processLines.find((l) => l.calculationSnapshot !== undefined)!;

describe('the injection line is driven by its stored calculator', () => {
  it('carries the calculator id and version and the run: every input with its source, every formula with its value', () => {
    const line = moldingLine(computeInjectionMoldedCostSummary(part()));
    expect(line.calculatorId).toBe('Injection Molding - Cycle Time'); // the spec's calculators carry their name as id; the database's carry the uuid
    expect(line.calculatorVersion).toBe(2);
    const trace = line.calculationTrace!;
    const inputs = trace.filter((t) => t.kind === 'input');
    expect(inputs.map((t) => t.fieldName)).toEqual(expect.arrayContaining(['Nominal Wall Thickness', 'Press Injection Rate', 'Fill Factor for Cavities', 'Cycle Time Adjustment Factor']));
    expect(inputs.every((t) => !!t.source)).toBe(true);
    expect(trace.filter((t) => t.kind === 'calculated').every((t) => !!t.formula && t.value != null)).toBe(true);
    expect(trace[trace.length - 1]).toMatchObject({ fieldName: 'Cycle Time', formulaId: 'F-08' });
  });

  it('the line time is the calculator\'s cycle (per cavity, per good part), not a second computation', () => {
    const r = computeInjectionMoldedCostSummary(part());
    const line = moldingLine(r);
    const cycle = line.calculationTrace!.find((t) => t.fieldName === 'Cycle Time')!.value as number;
    expect(r.cycleTimes.totalMin).toBeGreaterThan(0);
    expect(line.cycleTimeMin).toBeGreaterThan(0);
    expect(cycle).toBeGreaterThan(10); // seconds, an ABS part of this size
  });

  it('structural foam is computed by its own calculator through the same engine', () => {
    const foam = moldingLine(computeInjectionMoldedCostSummary(part({ mhrRate: { ...rate('structural_foam_molding', PRESS.mhrUsd, 'Foam press'), setupTimeHr: 2 } })));
    expect(foam.calculatorId).toBe('Structural Foam Molding - Cycle Time');
  });

  it('with no calculator the cycle is a named gap: no time, no calculator id, and the line says what to run', () => {
    for (const calculators of [null, undefined, {}]) {
      const r = computeInjectionMoldedCostSummary(part({ calculators }));
      const line = moldingLine(r);
      expect(line.calculatorId).toBeUndefined();
      expect(line.cycleTimeMin).toBe(0);
      const gap = line.physicsGap;
      expect(gap && 'reason' in gap ? gap.reason : '').toContain('the stored calculator "Injection Molding - Cycle Time" is not in this database');
      expect(r.warnings.join(' ')).toContain('Cycle time not derivable');
    }
  });

  it('a calculator edited in the database changes the number: the calculator is the computation', () => {
    const edited = JSON.parse(JSON.stringify(CALCULATORS)) as typeof CALCULATORS;
    const ejection = edited['Injection Molding - Cycle Time']!.fields.find((f) => f.field_name === 'Ejection Time')!;
    ejection.default_value = '{Press Dry Cycle Time} + {Ejector Stroke Time} + 1';
    const base = moldingLine(computeInjectionMoldedCostSummary(part())).cycleTimeMin;
    const changed = moldingLine(computeInjectionMoldedCostSummary(part({ calculators: edited }))).cycleTimeMin;
    expect(changed).toBeGreaterThan(base);
  });
});

describe('a saved calculation records which calculators it ran, and replay holds them to it', () => {
  const rows = () => JSON.parse(JSON.stringify(canonicalReferenceRows(realReferenceRows())));
  const save = () => {
    const line = moldingLine(computeInjectionMoldedCostSummary(part()));
    return {
      saved: JSON.parse(JSON.stringify({ setupCost: line.setupCost, runCost: line.runCost, totalCost: line.totalCost, machineCostPerPart: line.machineCostPerPart, laborCostPerPart: line.laborCostPerPart })),
      snapshot: JSON.parse(JSON.stringify(line.calculationSnapshot)) as CalculationSnapshot,
    };
  };

  it('the snapshot names the calculator and a fingerprint of its formulas, and keeps the calculators out of the stored inputs', () => {
    const { snapshot } = save();
    expect(snapshot.calculators).toEqual([{ name: 'Injection Molding - Cycle Time', version: 2, fingerprint: calculatorFingerprint(CALCULATORS['Injection Molding - Cycle Time']!) }]);
    expect(JSON.stringify(snapshot.inputs)).not.toContain('Press Platen Speed');
    expect(Object.keys(snapshot.inputs)).not.toContain('calculators');
  });

  it('replays to the saved amounts with the same formulas', () => {
    const { saved, snapshot } = save();
    const r = replayPlasticLine(snapshot, rows(), saved);
    expect(r.reasons).toEqual([]);
    expect(r.reproduced).toBe(true);
  });

  it('is refused when the formulas now in force are not the ones it ran', () => {
    const { saved, snapshot } = save();
    const tampered = { ...snapshot, calculators: [{ name: 'Injection Molding - Cycle Time', version: 1, fingerprint: '0000000000000000' }] };
    const r = replayPlasticLine(tampered, rows(), saved);
    expect(r.reproduced).toBe(false);
    expect(r.reasons.join(' ')).toContain('have changed since this calculation');
    expect(r.audit[r.audit.length - 1]).toMatch(/^REFUSED/);
  });

  it('a calculator that is not in this engine build is refused, not skipped', () => {
    const { saved, snapshot } = save();
    const r = replayPlasticLine({ ...snapshot, calculators: [{ name: 'Some Other Calculator', version: 1, fingerprint: 'abc' }] }, rows(), saved);
    expect(r.reproduced).toBe(false);
    expect(r.reasons.join(' ')).toContain('is not in this engine build');
  });

  it('a calculation saved before the cycle time was calculator-driven still replays, and the trail says so', () => {
    const { saved, snapshot } = save();
    const { calculators: _calculators, ...older } = snapshot;
    const r = replayPlasticLine(older as CalculationSnapshot, rows(), saved);
    expect(r.reproduced).toBe(true);
    expect(r.audit.join(' ')).toContain('none recorded (saved before the cycle time was calculator-driven)');
  });
});

describe('compression and reaction injection lines are driven by their calculators too', () => {
  const rateOf = (pressCycleTimeS: number | null) =>
    ({ rate: 60, source: 'mhr_database', machineClass: 'x', machineName: 'M', commodityCode: null, pressCycleTimeS, setupTimeHr: 0.5 }) as unknown as MHRRateInput;
  const input = (cure: number | null) => ({ batchSize: 1000, partWeightKg: 0.2, rate: rateOf(20), cureTimeMinFromMaterial: cure });
  // RIM: an 80,000 mm3 part on a machine that injects 100,000 mm3/s fills in 0.8 s
  const rimFill = { partVolumeMm3: 80_000, injectionRateMm3PerS: 100_000 };

  it('compression: the line carries the calculator and its run, and the cycle is press time plus cure', () => {
    const r = computeCompressionMoldingCost({ ...input(3), calculators: CALCULATORS });
    const line = r.processLines[0]!;
    expect(line.calculatorId).toBe('Compression Molding - Cycle Time');
    expect(line.calculationTrace!.find((t) => t.fieldName === 'Cycle Time')!.value).toBe(200); // 20 s + 3 min x 60
    expect(r.cuttingMin).toBeCloseTo(200 / 60, 12);
  });

  it('rim: the line carries the calculator (version 2) and its run, and the cycle is dry cycle + fill + cure', () => {
    const r = computeReactionInjectionMoldingCost({ ...input(3), ...rimFill, calculators: CALCULATORS });
    const line = r.processLines[0]!;
    expect(line.calculatorId).toBe('Reaction Injection Molding - Cycle Time');
    expect(line.calculatorVersion).toBe(2);
    expect(line.calculationTrace!.find((t) => t.fieldName === 'Cycle Time')!.value).toBeCloseTo(200.8, 9); // 20 + 0.8 + 180
    expect(r.cuttingMin).toBeCloseTo(200.8 / 60, 12);
  });

  it.each([
    ['compression', (calculators: null) => computeCompressionMoldingCost({ ...input(3), calculators })],
    ['rim', (calculators: null) => computeReactionInjectionMoldingCost({ ...input(3), ...rimFill, calculators })],
  ] as const)('%s: with no calculator the cycle is a named gap, not a number', (_p, run) => {
    const r = run(null);
    expect(r.cuttingMin).toBe(0);
    expect(r.processLines[0]?.calculatorId).toBeUndefined();
    expect(r.warnings.join(' ')).toContain('is not in this database');
  });
});

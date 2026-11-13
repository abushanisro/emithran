import { readFileSync } from 'fs';
import { join } from 'path';

import { loadPlasticMoldingCalculatorSpec, plasticMoldingCalculatorsByName } from '../../../../../modules/bom-items/costing/plastic-molding/calculators/plastic-molding-calculator-spec';
import { buildPlasticMoldingCalculatorsMigrationSql } from '../../../../../modules/bom-items/costing/plastic-molding/calculators/plastic-molding-calculators-migration';
import { DEFLASH_CALCULATOR } from '../../../../../modules/bom-items/costing/plastic-molding/calculators/plastic-cycle-time-seeds';
import { runDeflashingTime } from '../../../../../modules/bom-items/costing/plastic-molding/calculators/plastic-cycle-time';
import { moldingSignals } from '../../../../../modules/bom-items/costing/plastic-molding/molding-input';
import { computeInjectionMoldedCostSummary, type InjectionMoldingCostInput } from '../../../../../modules/bom-items/costing/plastic-molding/process/cost-injection-molding-engine';
import { realMaterialClamp, realPlasticReference, realPress, realResinInputs } from './real-plastic-reference';

// Deflashing: the flash left on the parting line is trimmed by hand. Its time is the parting line length (measured on the CAD model) over the reference's
// manual flash trimming rate, cmManualFlashTrimmingRate, by a stored calculator. The rate is staged for compression molding and borrowed for injection
// molding (no injection rate is staged), and its unit is taken as mm/s (the reference types it only "Length/Time"; see the calculator description).

const CALCULATORS = plasticMoldingCalculatorsByName();
const REF = realPlasticReference();
const PRESS = realPress('Arburg Allrounder 420 C 1300 - 350');
const rate = (machineClass: string, usd: number, name: string | null) => ({ rate: usd, labourRate: 34.48, operators: 1, source: 'mhr_database' as const, machineClass, machineName: name, commodityCode: null });
const part = (over: Partial<InjectionMoldingCostInput> = {}): InjectionMoldingCostInput => ({
  volume: 50_000, surfaceArea: 40_000, wallThicknessNominalMm: 2, materialGrade: 'ABS', materialCostPerKg: 3.046, materialDensityKgM3: 1040, materialSource: 'db',
  batchSize: 250, family: 'plastic_molded', mhrRate: { ...rate('injection_molding', PRESS.mhrUsd, 'Arburg Allrounder 420 C 1300 - 350'), setupTimeHr: 2 },
  deburrRate: rate('deburring', 12, 'Bench'), inspectionRate: rate('cmm', 0, null), machineClampTonnes: PRESS.maxTonnage, machineShotCapacityG: PRESS.shotCapacityGrams,
  pressTiming: PRESS.timing, goodPartYield: PRESS.goodPartYield, calculators: CALCULATORS, materialClamp: realMaterialClamp('ABS'), realResinInputs: realResinInputs('ABS'), materialType: 'ABS',
  plasticReference: REF, location: 'USA', signals: { projectedAreaMm2: 10_000, undercutCount: 0, partingComplexity: 0.6, partingLineLengthMm: 784.61 },
  ...over,
});
const deflash = (over: Partial<InjectionMoldingCostInput> = {}) => computeInjectionMoldedCostSummary(part(over));

describe('the deflashing calculator', () => {
  it('is a helper of the plastic spec (no catalog operation maps to it), written by migration 1010', () => {
    const c = loadPlasticMoldingCalculatorSpec().calculators.find((x) => x.name === DEFLASH_CALCULATOR)!;
    expect(c).toMatchObject({ helper: true, operations: [], migration: 1010 });
    expect(c.fields.map((f) => f.name)).toEqual(['Parting Line Length', 'Manual Flash Trimming Rate', 'Cycle Time']);
    expect(c.description).toMatch(/cmManualFlashTrimmingRate/);
    expect(c.description).toMatch(/mm\/s/);
    expect(readFileSync(join(__dirname, '../../../../../../migrations/1010_plastic_deflashing_calculator.sql'), 'utf8')).toBe(buildPlasticMoldingCalculatorsMigrationSql(1010));
  });

  it('times the parting line at the reference rate: 784.61 mm / 75 mm/s = 10.46 s', () => {
    expect(REF.featureRules.manualFlashTrimmingRateMmPerS).toBe(75);
    const r = runDeflashingTime({ partingLineLengthMm: 784.61, rateMmPerS: 75 }, CALCULATORS);
    if (!r.derivable) throw new Error(r.missing.join());
    expect(r.cycleSec).toBe(10.46);
    expect(r.trace.find((t) => t.fieldName === 'Parting Line Length')?.source).toMatch(/CAD/);
    expect(r.trace.find((t) => t.fieldName === 'Manual Flash Trimming Rate')?.source).toMatch(/cmManualFlashTrimmingRate/);
  });

  it('names a missing length or rate, never a default', () => {
    const r = runDeflashingTime({ partingLineLengthMm: null, rateMmPerS: null }, CALCULATORS);
    expect(r.derivable).toBe(false);
    if (!r.derivable) expect(r.missing.join(' ')).toMatch(/parting line length.*manual flash trimming rate/);
  });
});

describe('the parting line length signal', () => {
  it('is the PartingLine feature\'s measured length; none when the graph has no parting line', () => {
    const graph = (items: unknown[]) => ({ plasticFeatureGraph: { schema: 'plastic_feature_graph_v1', items, not_yet_recognized: [], unclassified_faces: 0 } }) as never;
    expect(moldingSignals(graph([{ id: 'parting-line', feature_type: 'PartingLine', variant: 'non_flat', attributes: { length_mm: 784.61 }, occurrences: [] }]), [170, 93, 48]).partingLineLengthMm).toBe(784.61);
    expect(moldingSignals(graph([]), [170, 93, 48]).partingLineLengthMm).toBeNull();
    expect(moldingSignals({} as never, [170, 93, 48]).partingLineLengthMm).toBeNull();
  });
});

describe('the injection molding route', () => {
  it('costs deflashing as its own line when the parting line routes it: the trimming time at the bench rate, with its calculation', () => {
    const r = deflash();
    const line = r.processLines.find((l) => l.process === 'Deflashing')!;
    expect(line).toBeDefined();
    expect(line.cycleTimeMin).toBeCloseTo(10.46 / 60, 6);
    expect(line.machineClass).toBe('deburring');
    // 10.46 s at (12 + 34.48 x 1) USD/h
    expect(line.totalCost).toBeCloseTo((10.46 / 3600) * (12 + 34.48), 6);
    expect(line.calculationTrace?.map((t) => t.fieldName)).toEqual(['Parting Line Length', 'Manual Flash Trimming Rate', 'Cycle Time']);
    expect(r.warnings.join(' ')).not.toMatch(/Deflashing required .* not costed/);
  });

  it('says what is missing when the parting line was not measured, and costs nothing for it', () => {
    const r = deflash({ signals: { projectedAreaMm2: 10_000, undercutCount: 0, partingComplexity: 0.6, partingLineLengthMm: null } });
    expect(r.processLines.find((l) => l.process === 'Deflashing')).toBeUndefined();
    expect(r.warnings.join(' ')).toMatch(/Deflashing not costed: .*parting line length/);
  });

  it('adds no deflashing when the parting line does not route it', () => {
    const r = deflash({ signals: { projectedAreaMm2: 10_000, undercutCount: 0, partingComplexity: 0.3, partingLineLengthMm: 784.61 } });
    expect(r.processLines.find((l) => l.process === 'Deflashing')).toBeUndefined();
  });
});

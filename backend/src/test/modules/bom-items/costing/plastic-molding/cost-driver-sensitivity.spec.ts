import { plasticMoldingCalculatorsByName } from '../../../../../modules/bom-items/costing/plastic-molding/calculators/plastic-molding-calculator-spec';
import { driverImpacts } from '../../../../../modules/bom-items/costing/plastic-molding/cost-driver-sensitivity';
import { computeInjectionMoldedCostSummary, type InjectionMoldingCostInput } from '../../../../../modules/bom-items/costing/plastic-molding/process/cost-injection-molding-engine';
import { realMaterialClamp, realPlasticReference, realPress, realResinInputs } from './real-plastic-reference';

// What a driver is worth: the engine run again with only that driver moved one step. The expected relations are physical (a thicker wall cools longer, so the machine line
// costs more; more volume is more material), and a driver the engine does not read must come out as exactly zero.

const PRESS = realPress('Arburg Allrounder 420 C 1300 - 350');
const rate = (machineClass: string, usd: number, name: string | null) => ({ rate: usd, labourRate: 34.48, operators: 0.5, source: 'mhr_database' as const, machineClass, machineName: name, commodityCode: null });
const input = (over: Partial<InjectionMoldingCostInput> = {}): InjectionMoldingCostInput => ({
  volume: 50_000, surfaceArea: 40_000, wallThicknessNominalMm: 2, materialGrade: 'ABS', materialCostPerKg: 3.046, materialDensityKgM3: 1040, materialSource: 'db',
  batchSize: 250, family: 'plastic_molded', mhrRate: { ...rate('injection_molding', PRESS.mhrUsd, 'Arburg Allrounder 420 C 1300 - 350'), setupTimeHr: 2 },
  deburrRate: rate('deburring', 0, null), inspectionRate: rate('cmm', 0, null), machineClampTonnes: PRESS.maxTonnage, machineShotCapacityG: PRESS.shotCapacityGrams,
  pressTiming: PRESS.timing, goodPartYield: PRESS.goodPartYield, calculators: plasticMoldingCalculatorsByName(), materialClamp: realMaterialClamp('ABS'), realResinInputs: realResinInputs('ABS'), materialType: 'ABS',
  plasticReference: realPlasticReference(), location: 'USA', annualVolume: 100_000, productionLifeYears: 3,
  signals: { projectedAreaMm2: 10_000, undercutCount: 0, partingComplexity: 0.5 }, ...over,
});
const impacts = (over: Partial<InjectionMoldingCostInput> = {}) => {
  const i = input(over);
  return Object.fromEntries(driverImpacts(i, computeInjectionMoldedCostSummary(i) as never).map((d) => [d.driver, d]));
};

describe('driverImpacts', () => {
  it('a thicker wall costs more on the machine (it cools longer) and nowhere else', () => {
    const d = impacts()['Nominal wall thickness']!;
    expect(d.step).toBe('+10 %');
    expect(d.variantValue).toBeCloseTo(d.baselineValue * 1.1, 9);
    expect(d.deltaPerPart).toBeGreaterThan(0);
    expect(d.lines.map((l) => l.line)).not.toContain('Material');
  });

  it('more volume is more material', () => {
    const d = impacts()['Part volume']!;
    expect(d.deltaPerPart).toBeGreaterThan(0);
    expect(d.lines[0]!.line).toBeTruthy();
    expect(d.lines.find((l) => l.line === 'Material')!.deltaPerPart).toBeGreaterThan(0);
  });

  it('a driver the engine does not read is worth exactly nothing, which is how "not priced" is proven', () => {
    const d = impacts()['Surface area']!;
    expect(d.deltaPerPart).toBe(0);
    expect(d.lines).toEqual([]);
  });

  it('the lines add up to the change', () => {
    for (const d of Object.values(impacts())) {
      const sum = d.lines.reduce((s, l) => s + l.deltaPerPart, 0);
      expect(sum).toBeCloseTo(d.deltaPerPart, 3);
    }
  });

  it('a driver the part has no value for is left out, never probed from nothing', () => {
    const d = impacts({ signals: { projectedAreaMm2: null, undercutCount: null, partingComplexity: null } });
    expect(d['Footprint (two longest sides)']).toBeUndefined();
    expect(d['Undercut features']).toBeUndefined();
    expect(d['Parting complexity']).toBeUndefined();
  });

  it('does not change the input it was given', () => {
    const i = input();
    const before = JSON.stringify({ v: i.volume, w: i.wallThicknessNominalMm, s: i.signals });
    driverImpacts(i, computeInjectionMoldedCostSummary(i) as never);
    expect(JSON.stringify({ v: i.volume, w: i.wallThicknessNominalMm, s: i.signals })).toBe(before);
  });
});

describe('driverImpacts: threshold drivers are stepped across their threshold', () => {
  it('a part under 3 undercut features and 0.6 parting complexity is worth the mold class it would reach', () => {
    const d = impacts({ signals: { projectedAreaMm2: 10_000, undercutCount: 1, partingComplexity: 0.5 } });
    expect(d['Undercut features']).toMatchObject({ variantValue: 3, step: 'to 3 features (the mold class rises)' });
    expect(d['Parting complexity']).toMatchObject({ variantValue: 0.61 });
  });

  it('a part already past the threshold is stepped by one, and a step that changes no price says so with zero', () => {
    const d = impacts({ signals: { projectedAreaMm2: 10_000, undercutCount: 6, partingComplexity: 0.8 } });
    expect(d['Undercut features']).toMatchObject({ variantValue: 7, step: '+1 feature' });
    expect(d['Parting complexity']!.variantValue).toBeCloseTo(0.9, 9);
  });
});

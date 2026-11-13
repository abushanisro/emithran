// The material gate in the injection molding engine, on the case the user hit: "Generic 18420 White", a stereolithography resin ($240/kg, no melt
// or mold temperature, no injection pressure or flow length), chosen as the material of an injection-molded part. Before the gate the cost view
// showed a dozen unrelated warnings (clamp force, cycle time, tool life, "no machine"...). Now it names the one cause.
//
// Run: npm run test -- material-gate

import { computeInjectionMoldedCostSummary } from '../../../../../../modules/bom-items/costing/plastic-molding/process/cost-injection-molding-engine';
import type { InjectionMoldingCostInput } from '../../../../../../modules/bom-items/costing/plastic-molding/process/cost-injection-molding-engine';
import { realMaterialClamp, realPlasticReference, realPress, realResinInputs } from '../real-plastic-reference';
import { plasticMoldingCalculatorsByName } from '../../../../../../modules/bom-items/costing/plastic-molding/calculators/plastic-molding-calculator-spec';

const REF = realPlasticReference();
const MID = realPress('Arburg Allrounder 420 C 1300 - 350');
const rate = (machineClass: string, rateUsd: number, machineName: string | null) =>
  ({ rate: rateUsd, labourRate: 30, source: 'mhr_database' as const, machineClass, machineName, commodityCode: null });

const base = (over: Partial<InjectionMoldingCostInput>): InjectionMoldingCostInput => ({
  volume: 18_800, surfaceArea: 25_700, wallThicknessNominalMm: 1.5, batchSize: 3001, family: 'plastic_molded', materialSource: 'db',
  materialGrade: 'Generic ABS', materialCostPerKg: 3.046, materialDensityKgM3: 1040,
  mhrRate: rate('injection_molding', MID.mhrUsd, 'Arburg Allrounder 420 C 1300 - 350'),
  deburrRate: rate('deburring', 0, null), inspectionRate: rate('cmm', 0, null),
  // The part's height along the pull: the ejector stroke of the cycle (calculator version 2).
  bboxMinMm: 30,
  machineClampTonnes: MID.maxTonnage, machineShotCapacityG: MID.shotCapacityGrams, pressTiming: MID.timing, goodPartYield: MID.goodPartYield, calculators: plasticMoldingCalculatorsByName(),
  materialClamp: realMaterialClamp('ABS'), realResinInputs: realResinInputs('ABS'), materialType: 'ABS',
  materialStockForm: 'Granules', materialMatlState: 'Base Polymer',
  plasticReference: REF, location: 'USA', signals: { projectedAreaMm2: 8000, undercutCount: 0 }, annualVolume: 12_003, productionLifeYears: 5,
  ...over,
});

// What the catalog holds for Generic 18420 White (raw_materials, local database).
const SLA_RESIN: Partial<InjectionMoldingCostInput> = {
  materialGrade: 'Generic 18420 White', materialCostPerKg: 240, materialDensityKgM3: 1160, materialType: 'ProtoGen',
  materialStockForm: 'Liquid Resin (SLA)', materialMatlState: 'Photopolymer',
  materialClamp: { injectionPressureMaxMpa: null, flowLengthRatio: null, referenceMaterial: null },
  realResinInputs: { meltingTempC: 0, moldTempC: 0, ejectionTempC: 50, specificHeatMeltJgC: 1.25, thermalConductivityMeltWMK: 0.18, densityOfMeltKgM3: null },
};

describe('computeInjectionMoldedCostSummary: a material that is not injection-molding feedstock', () => {
  const result = computeInjectionMoldedCostSummary(base(SLA_RESIN));

  it('says one thing: the material is 3D-printing feedstock, and what to do', () => {
    expect(result.warnings).toEqual([
      '"Generic 18420 White" is 3D-printing feedstock (Liquid Resin (SLA), Photopolymer), not an injection-molding material: it has no injection pressure, flow length, melt or mold temperature on file. Choose an injection-molding grade in Material Grade.',
    ]);
  });

  it('shows none of the steps the material makes impossible, and no price alert for a price that is correct for that resin', () => {
    const text = result.warnings.join('\n');
    for (const noise of ['MATERIAL COST ALERT', 'Clamp force not derivable', 'Cycle time not derivable', 'tblToolLife', 'not costed']) {
      expect(text).not.toContain(noise);
    }
  });

  it('marks the molding line unresolved for that reason, so no total reads as a finished cost', () => {
    const line = result.processLines.find((l) => l.process === 'Injection Molding')!;
    expect(line.totalCost).toBe(0);
    expect(line.physicsGap).toMatchObject({ gapType: 'unsupported_operation', requiredCapability: 'An injection-molding material' });
    expect(result.injectionMolding!.clampTrace).toContain('3D-printing feedstock');
  });

  it('judges a stock shape the same way', () => {
    const rod = computeInjectionMoldedCostSummary(base({ materialStockForm: 'Rod / Sheet / Tube', materialMatlState: 'Machined Stock', materialClamp: { injectionPressureMaxMpa: null, flowLengthRatio: null, referenceMaterial: null } }));
    expect(rod.warnings).toHaveLength(1);
    expect(rod.warnings[0]).toContain('is supplied as Rod / Sheet / Tube, which is not injection-molding feedstock');
  });
});

describe('computeInjectionMoldedCostSummary: materials that are molding feedstock are costed as before', () => {
  it('Generic ABS with its reference data resolves with no gate finding', () => {
    const r = computeInjectionMoldedCostSummary(base({}));
    expect(r.processLines.every((l) => !l.physicsGap)).toBe(true);
    expect(r.warnings.join('\n')).not.toContain('3D-printing feedstock');
  });

  it('a granule grade that lacks reference data keeps the specific warnings that name what is missing', () => {
    const r = computeInjectionMoldedCostSummary(base({
      materialGrade: 'Generic Nylon, Type 12 30% GF', materialType: 'Nylon', materialStockForm: 'Granules', materialMatlState: 'Semi-Crystalline',
      materialClamp: { injectionPressureMaxMpa: null, flowLengthRatio: null, referenceMaterial: null },
      realResinInputs: { ...realResinInputs('ABS'), densityOfMeltKgM3: null },
    }));
    const text = r.warnings.join('\n');
    expect(text).toContain('Clamp force not derivable');
    expect(text).not.toContain('3D-printing feedstock');
  });

  it('a caller that does not pass the form is not judged by form (the data decides, as before)', () => {
    const r = computeInjectionMoldedCostSummary(base({ materialStockForm: undefined, materialMatlState: undefined }));
    expect(r.processLines.every((l) => !l.physicsGap)).toBe(true);
  });
});

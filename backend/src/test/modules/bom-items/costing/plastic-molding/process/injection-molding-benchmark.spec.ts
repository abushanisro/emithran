// Injection molding cost engine, on real inputs only: presses from
// memory/Plastic Modeling/machine/injection_molding_machines.csv (clamp, shot,
// injection rate, dry cycle, machine hour rate), materials from
// materials_final.csv (reference cost, density, thermal and clamp properties)
// and the staged Plastic reference. Quoted in USD.
//
// Run: npm run test -- injection-molding-benchmark

import {
  computeInjectionMoldedCostSummary,
  recommendMoldClass,
} from '../../../../../../modules/bom-items/costing/plastic-molding/process/cost-injection-molding-engine';
import type { InjectionMoldingCostInput } from '../../../../../../modules/bom-items/costing/plastic-molding/process/cost-injection-molding-engine';
import { realMaterialClamp, realPlasticReference, realPress, realResinInputs } from '../real-plastic-reference';

const REF = realPlasticReference();

type Press = ReturnType<typeof realPress>;
const SMALL = realPress('Arburg Allrounder 221 K');             // 338 kN, 37.69 g
const MID = realPress('Arburg Allrounder 420 C 1300 - 350');    // 1300 kN, 117 g
const LARGE = realPress('Arburg Allrounder 520 C 2000 - 800');  // 2000 kN, 353 g

const MATERIALS = {
  PP: { reference: 'Polypropylene G-P H', costUsdPerKg: 1.077, densityKgM3: 910, type: 'Polypropylene' },
  ABS: { reference: 'ABS', costUsdPerKg: 3.046, densityKgM3: 1040, type: 'ABS' },
  PA66: { reference: 'Nylon, Type 66', costUsdPerKg: 4.363, densityKgM3: 1346, type: 'Nylon' },
} as const;

const rate = (machineClass: string, rateUsd: number, machineName: string | null) =>
  ({ rate: rateUsd, source: 'mhr_database' as const, machineClass, machineName, commodityCode: null });

function input(material: keyof typeof MATERIALS, press: Press, name: string, overrides: Partial<InjectionMoldingCostInput> = {}): InjectionMoldingCostInput {
  const m = MATERIALS[material];
  return {
    volume: 10_000,
    surfaceArea: 50_000,
    wallThicknessNominalMm: 2.0,
    materialGrade: material,
    materialCostPerKg: m.costUsdPerKg,
    materialDensityKgM3: m.densityKgM3,
    materialSource: 'db',
    batchSize: 1000,
    family: 'plastic_molded',
    mhrRate: rate('injection_molding', press.mhrUsd, name),
    deburrRate: rate('deburring', 0, null),
    inspectionRate: rate('cmm', 0, null),
    machineClampTonnes: press.maxTonnage,
    machineShotCapacityG: press.shotCapacityGrams,
    pressTiming: press.timing,
    goodPartYield: press.goodPartYield,
    materialClamp: realMaterialClamp(m.reference),
    realResinInputs: realResinInputs(m.reference),
    materialType: m.type,
    plasticReference: REF,
    location: 'USA',
    signals: { projectedAreaMm2: 2000, undercutCount: 0 },
    annualVolume: 10_000,
    productionLifeYears: 3,
    ...overrides,
  };
}

describe('recommendMoldClass — tblSpiType lifetime cycles', () => {
  it('picks the cheapest class whose rating covers the lifetime shots', () => {
    expect(recommendMoldClass(400, REF.spiClasses, null, null).moldClass).toBe('Class105');
    expect(recommendMoldClass(50_000, REF.spiClasses, null, null).moldClass).toBe('Class104');
    expect(recommendMoldClass(400_000, REF.spiClasses, null, null).moldClass).toBe('Class103');
    expect(recommendMoldClass(800_000, REF.spiClasses, null, null).moldClass).toBe('Class102');
  });
});

describe('computeInjectionMoldedCostSummary', () => {
  it('a sized PP part is complete: cycle from the press and material, clamp from the reference model', () => {
    const r = computeInjectionMoldedCostSummary(input('PP', MID, 'Arburg Allrounder 420 C 1300 - 350'));
    const im = r.injectionMolding!;
    expect(r.processLines.every((l) => !l.physicsGap)).toBe(true);
    expect(im.flowClass).toBe('easy'); // PP flow ratio 290
    expect(im.cycleTimeSec).toBeGreaterThan(0);
    const line = r.processLines.find((l) => l.process === 'Injection Molding')!;
    expect(line.calculationTrace?.map((t) => t.fieldName)).toContain('Mold Open/Close Time');
    expect(line.hourlyRate).toBeCloseTo(MID.mhrUsd, 6);
  });

  it('molds the reference defaultNumCavities whatever the volume (no volume rule of thumb)', () => {
    const proto = computeInjectionMoldedCostSummary(input('PP', LARGE, 'x', { annualVolume: 200, productionLifeYears: 1 }));
    const mass = computeInjectionMoldedCostSummary(input('PP', LARGE, 'x', { annualVolume: 1_000_000, productionLifeYears: 2 }));
    for (const r of [proto, mass]) {
      expect(r.injectionMolding!.cavityCount).toBe(REF.defaultNumCavities);
      expect(r.injectionMolding!.cavityConstrainedBy).toBe('default');
    }
  });

  it('uses the user cavity count when it is a reference mold layout, and reports one that is not', () => {
    const two = computeInjectionMoldedCostSummary(input('PP', LARGE, 'x', { cavityCountOverride: 2 }));
    expect(REF.cavityLayouts).toContain(2);
    expect(two.injectionMolding!.cavityCount).toBe(2);
    expect(two.injectionMolding!.cavityConstrainedBy).toBe('user');
    expect(two.injectionMolding!.cavityLayouts).toEqual(REF.cavityLayouts);
    expect(two.processLines.every((l) => !l.physicsGap)).toBe(true);

    const three = computeInjectionMoldedCostSummary(input('PP', LARGE, 'x', { cavityCountOverride: 3 }));
    expect(REF.cavityLayouts).not.toContain(3);
    const g = three.processLines[0]!.physicsGap;
    expect(g?.gapType === 'unsupported_operation' ? g.reason : null).toMatch(/3 cavities has no reference mold layout/);
    expect(three.injectionMolding!.cavityCount).toBe(3); // reported as asked, never swapped for the default
  });

  it('sizes clamp with the reference model: ABS is Medium flow, 34% of 127.5 MPa', () => {
    const r = computeInjectionMoldedCostSummary(input('ABS', MID, 'Arburg Allrounder 420 C 1300 - 350', { signals: { projectedAreaMm2: 8000 } }));
    const im = r.injectionMolding!;
    expect(im.flowClass).toBe('medium');
    expect(im.cavityPressureMpa).toBeCloseTo(127.5 * 0.34, 2);
    expect(im.clampRequiredT).toBeCloseTo((8000 * im.cavityCount * 127.5 * 0.34 * 1.1) / 9806.65, 0);
  });

  it('marks the molding line incomplete when the press cannot hold one cavity', () => {
    // 8000 mm² of ABS needs ~39 t; the Arburg 221 K is 34.5 t.
    const r = computeInjectionMoldedCostSummary(input('ABS', SMALL, 'Arburg Allrounder 221 K', { signals: { projectedAreaMm2: 8000 } }));
    const line = r.processLines.find((l) => l.process === 'Injection Molding')!;
    expect(line.physicsGap?.gapType === 'unsupported_operation' && line.physicsGap.reason).toMatch(/cannot hold 1 cavity closed: it needs 38.9 t/);
    expect(r.injectionMolding!.cavityConstrainedBy).toBe('unverified');
  });

  it('marks the line incomplete, never substitutes a value, when material, press timing, wall or volume are missing', () => {
    const noClamp = computeInjectionMoldedCostSummary(input('PP', MID, 'x', { materialClamp: { injectionPressureMaxMpa: null, flowLengthRatio: null, referenceMaterial: null } }));
    const noTiming = computeInjectionMoldedCostSummary(input('PP', MID, 'x', { pressTiming: null }));
    const noWall = computeInjectionMoldedCostSummary(input('PP', MID, 'x', { wallThicknessNominalMm: 0 }));
    const reason = (r: ReturnType<typeof computeInjectionMoldedCostSummary>) => {
      const g = r.processLines.find((l) => l.process === 'Injection Molding')!.physicsGap;
      return g?.gapType === 'unsupported_operation' ? g.reason : null;
    };
    expect(reason(noClamp)).toMatch(/Clamp force not derivable/);
    expect(reason(noTiming)).toMatch(/press injection rate/);
    expect(reason(noWall)).toMatch(/nominal wall thickness/);
  });

  it('prices per good part with the press good-part yield, and is incomplete without it', () => {
    const full = computeInjectionMoldedCostSummary(input('PP', MID, 'x'));
    const half = computeInjectionMoldedCostSummary(input('PP', MID, 'x', { goodPartYield: 0.5 }));
    const none = computeInjectionMoldedCostSummary(input('PP', MID, 'x', { goodPartYield: null }));
    expect(MID.goodPartYield).toBe(1);
    expect(half.materialCost).toBeCloseTo(full.materialCost * 2, 1);
    expect(half.processLines[0]!.cycleTimeMin).toBeCloseTo(full.processLines[0]!.cycleTimeMin * 2, 1);
    const g = none.processLines[0]!.physicsGap;
    expect(g?.gapType === 'unsupported_operation' ? g.reason : null).toMatch(/good-part yield/);
  });

  it('checks shot size in GPPS-equivalent grams, from the two melt densities', () => {
    const r = computeInjectionMoldedCostSummary(input('PA66', MID, 'Arburg Allrounder 420 C 1300 - 350'));
    const im = r.injectionMolding!;
    const pa66Melt = realResinInputs('Nylon, Type 66').densityOfMeltKgM3!;
    const shotKg = r.grossWeightKg;
    expect(im.shotRequiredG).toBeCloseTo(shotKg * 1000 * (REF.cycleModel.gppsMeltDensityKgM3 / pa66Melt) * REF.shotSizeSafetyFactor * im.cavityCount, 0);
  });

  it('uses the reference default runner (cold, edge gate) unless the part has a gate signal', () => {
    const cold = computeInjectionMoldedCostSummary(input('PP', MID, 'x'));
    const hot = computeInjectionMoldedCostSummary(input('PP', MID, 'x', { signals: { projectedAreaMm2: 2000, gateType: 'hot_tip' } }));
    expect(cold.injectionMolding!.runnerSystemType).toBe('cold');
    expect(cold.injectionMolding!.gateType).toBe('edge');
    expect(cold.injectionMolding!.runnerScrapKg).toBeGreaterThan(hot.injectionMolding!.runnerScrapKg);
    expect(hot.injectionMolding!.runnerSystemType).toBe('hot');
  });

  it('prices USA toolroom labour and every mold the job wears out (tblToolLife)', () => {
    const r = computeInjectionMoldedCostSummary(input('ABS', MID, 'x', { annualVolume: 500_000, productionLifeYears: 1 }));
    const t = r.tooling!;
    expect(t.moldToolLifeShots).toBe(144_000);
    expect(t.moldsRequired).toBe(Math.ceil((500_000 / r.injectionMolding!.cavityCount) / 144_000));
    expect(t.moldLabourCostUsd).toBeGreaterThan(0);
    expect(t.moldCostUsd).toBeCloseTo((t.moldBomSubtotalUsd! + t.moldLabourCostUsd!) * t.moldsRequired!, 1);
  });

  it('prices side-action hardware only when the part has an undercut', () => {
    const without = computeInjectionMoldedCostSummary(input('PP', MID, 'x'));
    const withUndercut = computeInjectionMoldedCostSummary(input('PP', MID, 'x', { signals: { projectedAreaMm2: 2000, undercutCount: 1 } }));
    expect(withUndercut.tooling!.moldBomSubtotalUsd!).toBeGreaterThan(without.tooling!.moldBomSubtotalUsd!);
    expect(without.tooling!.moldMissingComponents).toEqual(expect.arrayContaining([expect.stringContaining('Ejector Pin')]));
  });

  it('routes the real secondary signals: hygroscopic resin -> drying, undercut -> side action, inserts', () => {
    const abs = computeInjectionMoldedCostSummary(input('ABS', MID, 'x'));
    const pa = computeInjectionMoldedCostSummary(input('PA66', MID, 'x', { signals: { projectedAreaMm2: 2000, undercutCount: 1 } }));
    const ins = computeInjectionMoldedCostSummary(input('ABS', MID, 'x', { moldingSubtype: 'insert', signals: { projectedAreaMm2: 2000, insertCount: 3 } }));
    expect(abs.processTree!.operations.map((o) => o.id)).toContain('material_drying');
    expect(pa.processTree!.operations.map((o) => o.id)).toContain('side_action');
    expect(ins.processTree!.operations.map((o) => o.id)).toContain('insert_loading');
    // Routed but not costed: disclosed, never a fabricated line.
    expect(abs.processLines.find((l) => l.process === 'Material Drying')).toBeUndefined();
    expect(abs.warnings.some((w) => /Material Drying/.test(w))).toBe(true);
  });
});

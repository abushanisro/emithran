// A representative part through the real calculators end to end: press pool from
// machine/injection_molding_machines.csv -> tier selection (clamp, shot,
// tie-bar) -> the cost engine with the staged reference. No mocks of any
// calculator; only the press rows and material rows come from memory/.

import { selectIMmachinesByTier } from '../../../../../modules/bom-items/costing/plastic-molding/machine/machine-selector-im';
import { computeInjectionMoldedCostSummary } from '../../../../../modules/bom-items/costing/plastic-molding/process/cost-injection-molding-engine';
import type { InjectionMoldingCostInput } from '../../../../../modules/bom-items/costing/plastic-molding/process/cost-injection-molding-engine';
import { shotGppsGramsPerCavity, shotWeightKgPerPart } from '../../../../../modules/bom-items/costing/plastic-molding/shot-size';
import type { MachineCandidate } from '../../../../../modules/bom-items/dto/machine-selection.dto';
import { allRealPresses, realMaterialClamp, realPlasticReference, realResinInputs } from './real-plastic-reference';

const REF = realPlasticReference();
const PRESSES = allRealPresses();
const POOL: MachineCandidate[] = PRESSES.map((p) => ({
  machineId: p.name, machineName: p.name, machineClass: 'injection_molding', hourlyRate: p.mhrUsd, availabilityStatus: 'available',
  capability: { maxTonnage: p.maxTonnage, shotCapacityGrams: p.shotCapacityGrams, tieBarXMm: p.tieBarXMm, tieBarYMm: p.tieBarYMm, minMoldHeightMm: null, maxMoldHeightMm: null },
} as unknown as MachineCandidate));

// PA66 housing: 120 x 80 x 30 mm bbox, 45,000 mm3, 2.5 mm wall, 9,600 mm2 footprint.
const PART = { volume: 45_000, wall: 2.5, lengthMm: 120, widthMm: 80, densityKgM3: 1346, costPerKg: 4.363 };
const AREA = PART.lengthMm * PART.widthMm;
const CLAMP = realMaterialClamp('Nylon, Type 66');
const RESIN = realResinInputs('Nylon, Type 66');

function pick() {
  const shotKg = shotWeightKgPerPart((PART.volume / 1e9) * PART.densityKgM3, 'cold');
  const tiers = selectIMmachinesByTier(POOL, {
    projectedAreaMm2: AREA, cavityCount: 1,
    shotGppsGPerCavity: shotGppsGramsPerCavity({ shotWeightKg: shotKg, meltDensityKgM3: RESIN.densityOfMeltKgM3, reference: REF }),
    material: CLAMP, materialLabel: 'PA66', runner: 'cold',
    partLengthMm: PART.lengthMm, partWidthMm: PART.widthMm, partHeightMm: 30, estimatedToolHeightMm: null, clampModel: REF.clampModel,
  });
  const capable = tiers.flatMap((t) => t.candidates).filter((e) => e.capable);
  return { tiers, capable, smallest: capable.sort((a, b) => a.candidate.capability.maxTonnage! - b.candidate.capability.maxTonnage!)[0]! };
}

function quote(over: Partial<InjectionMoldingCostInput> = {}, pressName = pick().smallest.candidate.machineName!) {
  const p = PRESSES.find((x) => x.name === pressName)!;
  return computeInjectionMoldedCostSummary({
    volume: PART.volume, surfaceArea: 30_000, wallThicknessNominalMm: PART.wall, materialGrade: 'PA66',
    materialCostPerKg: PART.costPerKg, materialDensityKgM3: PART.densityKgM3, materialSource: 'db', batchSize: 1000, family: 'plastic_molded',
    mhrRate: { rate: p.mhrUsd, source: 'mhr_database', machineClass: 'injection_molding', machineName: p.name, commodityCode: null },
    deburrRate: { rate: 0, source: 'mhr_database', machineClass: 'deburring', machineName: null, commodityCode: null },
    inspectionRate: { rate: 0, source: 'mhr_database', machineClass: 'cmm', machineName: null, commodityCode: null },
    machineClampTonnes: p.maxTonnage, machineShotCapacityG: p.shotCapacityGrams, pressTiming: p.timing, goodPartYield: p.goodPartYield,
    materialClamp: CLAMP, realResinInputs: RESIN, materialType: 'Nylon', plasticReference: REF, location: 'USA',
    bboxMaxMm: PART.lengthMm, bboxMidMm: PART.widthMm,
    signals: { projectedAreaMm2: AREA, undercutCount: 1, partingComplexity: 0.3, gateType: 'edge' },
    annualVolume: 50_000, productionLifeYears: 4,
    ...over,
  });
}

describe('plastic molding: representative PA66 part through the real calculators', () => {
  it('selects a press that fits the part on clamp, shot and tie-bar, and the engine agrees', () => {
    const { smallest, capable } = pick();
    expect(capable.length).toBeGreaterThan(0);
    const ev = smallest;
    // Nylon 66: pressure x flow class -> clamp must be derivable and within the press.
    expect(ev.clampRequiredT).not.toBeNull();
    expect(ev.clampUtil!).toBeLessThanOrEqual(1);
    expect(ev.shotUtil!).toBeLessThanOrEqual(1);
    const cap = ev.candidate.capability;
    const reqL = PART.lengthMm + 45, reqW = PART.widthMm + 45;
    expect((reqL <= cap.tieBarXMm! && reqW <= cap.tieBarYMm!) || (reqL <= cap.tieBarYMm! && reqW <= cap.tieBarXMm!)).toBe(true);
    // Every smaller press is rejected, each with a reason.
    for (const e of pick().tiers.flatMap((t) => t.candidates)) {
      if (!e.capable) expect(e.blockReasons.length).toBeGreaterThan(0);
      if (e.candidate.capability.maxTonnage! < cap.maxTonnage!) expect(e.capable).toBe(false);
    }
    const r = quote();
    expect(r.processLines.every((l) => !l.physicsGap)).toBe(true);
    expect(r.injectionMolding!.cavityConstrainedBy).toBe('default');
    expect(r.injectionMolding!.clampUtilPct!).toBeLessThanOrEqual(100);
    expect(r.injectionMolding!.shotUtilPct!).toBeLessThanOrEqual(100);
  });

  it('breakdown sums, no NaN, nothing negative', () => {
    const r = quote();
    expect(r.totalCost).toBeCloseTo(r.materialCost + r.totalProcessCost, 2);
    expect(r.totalProcessCost).toBeCloseTo(r.processLines.reduce((s, l) => s + l.setupCost + l.runCost, 0), 2);
    const nums: number[] = [
      r.materialCost, r.totalProcessCost, r.totalCost, r.grossWeightKg, r.cycleTimes.totalMin,
      ...r.processLines.flatMap((l) => [l.setupCost, l.runCost, l.totalCost, l.cycleTimeMin, l.hourlyRate]),
      ...Object.values(r.injectionMolding!).filter((v): v is number => typeof v === 'number'),
      ...Object.values(r.tooling!).filter((v): v is number => typeof v === 'number'),
    ];
    for (const n of nums) { expect(Number.isFinite(n)).toBe(true); expect(n).toBeGreaterThanOrEqual(0); }
    expect(r.totalCost).toBeGreaterThan(0);
    expect(r.tooling!.moldCostUsd).toBeGreaterThan(0);
    // Material: net 60.57 g + 8% runner = 65.42 g x 4.363.
    expect(r.materialCost).toBeCloseTo((PART.volume / 1e9) * PART.densityKgM3 * 1.08 * PART.costPerKg, 2);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(quote())).toBe(JSON.stringify(quote()));
  });

  it('batch size never raises the unit cost, and more annual volume never raises tooling per part', () => {
    const totals = [1, 10, 100, 1000, 10_000, 100_000].map((batchSize) => quote({ batchSize }).totalCost);
    for (let i = 1; i < totals.length; i++) expect(totals[i]!).toBeLessThanOrEqual(totals[i - 1]!);
    const perPart = [1_000, 10_000, 100_000, 1_000_000].map((v) => quote({ annualVolume: v }).tooling!.moldCostPerPartUsd);
    for (let i = 1; i < perPart.length; i++) expect(perPart[i]!).toBeLessThanOrEqual(perPart[i - 1]!);
  });

  it('a thicker wall costs more machine time, a heavier part more material', () => {
    expect(quote({ wallThicknessNominalMm: 4 }).processLines[0]!.runCost).toBeGreaterThan(quote({ wallThicknessNominalMm: 2 }).processLines[0]!.runCost);
    expect(quote({ volume: 90_000 }).materialCost).toBeGreaterThan(quote().materialCost);
  });

  it('an undercut adds side-action hardware to the mold', () => {
    expect(quote().tooling!.moldBomSubtotalUsd!).toBeGreaterThan(quote({ signals: { projectedAreaMm2: AREA, undercutCount: 0, gateType: 'edge' } }).tooling!.moldBomSubtotalUsd!);
  });
});

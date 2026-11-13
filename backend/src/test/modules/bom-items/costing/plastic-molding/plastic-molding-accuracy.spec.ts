// Hand-calculated checks of the injection molding model against memory/Plastic
// Modeling (materials_final.csv, machine/injection_molding_machines.csv,
// variables, lookup, settings_usa). Every expected number below is worked out
// in the comment above it from those files, not read back from the code.
//
// Worked part (used throughout): ABS, 50,000 mm3, 2 mm nominal wall, 10,000 mm2
// projected, one cavity, cold runner (reference default), on the Arburg
// Allrounder 420 C 1300 - 350 (1300 kN = 132.56 t, 117 g GPPS, 130,000 mm3/s,
// dry cycle 2.0 s, 14.17 + 15.01 = 29.18 USD/h, yield 1.0).
//   ABS: 150 MPa, flow ratio 175 (Medium: >=100, <200), melt 240 C, mold 70 C,
//        eject 85 C, k 0.127, cp 1.8, melt density 885, density 1040, 3.046 USD/kg.

import { requiredClampForce } from '../../../../../modules/bom-items/costing/plastic-molding/clamp-force';
import { shotGppsGramsPerCavity, shotWeightKgPerPart } from '../../../../../modules/bom-items/costing/plastic-molding/shot-size';
import { resinThermalProps } from '../../../../../modules/bom-items/costing/plastic-molding/process/cycle-time';
import { runInjectionCycleTime } from '../../../../../modules/bom-items/costing/plastic-molding/calculators/plastic-cycle-time';
import { plasticMoldingCalculatorsByName } from '../../../../../modules/bom-items/costing/plastic-molding/calculators/plastic-molding-calculator-spec';
import type { RibSignals } from '../../../../../modules/bom-items/costing/plastic-molding/process/rib-inserts';
import { computeInjectionMoldedCostSummary } from '../../../../../modules/bom-items/costing/plastic-molding/process/cost-injection-molding-engine';
import type { InjectionMoldingCostInput } from '../../../../../modules/bom-items/costing/plastic-molding/process/cost-injection-molding-engine';
import { expectSetupContract } from '../shared/setup-contract';
import { findRouteDataGaps } from '../../../../../modules/bom-items/costing/shared/core/engine-kernel';
import { isPlasticGrade } from '../../../../../modules/bom-items/costing/plastic-molding/process/process-tree';
import { isCapable } from '../../../../../modules/bom-items/costing/shared/capability/machine-selection/selector';
import { injectionMoldingRequirement } from '../../../../../modules/bom-items/costing/shared/capability/machine-selection/physics';
import type { MachineCandidate } from '../../../../../modules/bom-items/dto/machine-selection.dto';
import { realMaterialClamp, realPlasticReference, realPress, realResinInputs } from './real-plastic-reference';

const REF = realPlasticReference();
const PRESS_NAME = 'Arburg Allrounder 420 C 1300 - 350';
const MID = realPress(PRESS_NAME);
const ABS_CLAMP = realMaterialClamp('ABS');
const ABS_RESIN = realResinInputs('ABS');

const rate = (machineClass: string, usd: number, name: string | null) =>
  ({ rate: usd, labourRate: 30, source: 'mhr_database' as const, machineClass, machineName: name, commodityCode: null });

function absPart(overrides: Partial<InjectionMoldingCostInput> = {}): InjectionMoldingCostInput {
  return {
    volume: 50_000, surfaceArea: 40_000, wallThicknessNominalMm: 2, materialGrade: 'ABS',
    materialCostPerKg: 3.046, materialDensityKgM3: 1040, materialSource: 'db', batchSize: 1000, family: 'plastic_molded',
    mhrRate: rate('injection_molding', MID.mhrUsd, PRESS_NAME), deburrRate: rate('deburring', 0, null), inspectionRate: rate('cmm', 0, null),
    machineClampTonnes: MID.maxTonnage, machineShotCapacityG: MID.shotCapacityGrams, pressTiming: MID.timing, goodPartYield: MID.goodPartYield,
    calculators: plasticMoldingCalculatorsByName(),
    materialClamp: ABS_CLAMP, realResinInputs: ABS_RESIN, materialType: 'ABS', plasticReference: REF, location: 'USA',
    // The part's box: 100 x 100 mm on the parting plane (the 10,000 mm2 projected area), 30 mm along the pull.
    bboxMaxMm: 100, bboxMidMm: 100, bboxMinMm: 30,
    // 900 CAD faces: an average mold (cmMoldSurfaceCountThreshold 500 / 2,500).
    cadFaceCount: 900,
    signals: { projectedAreaMm2: 10_000, undercutCount: 0 },
    ...overrides,
  };
}

describe('clamp force (reference model)', () => {
  const model = REF.clampModel;
  const base = { model, materialLabel: 'x', cavityCount: 1 };

  it('ABS, 10,000 mm2, cold runner: 150 x (1 - 0.15) = 127.5 MPa, Medium flow 34% = 43.35 MPa, x 1.1 / 9806.65 = 48.625 t', () => {
    const r = requiredClampForce({ ...base, material: ABS_CLAMP, projectedAreaMm2: 10_000, runner: 'cold' });
    if (!r.derivable) throw new Error(r.reason);
    expect(r.flowClass).toBe('medium');
    expect(r.adjustedInjectionPressureMpa).toBeCloseTo(127.5, 6);
    expect(r.cavityPressureMpa).toBeCloseTo(43.35, 6);
    expect(r.requiredTonnes).toBeCloseTo(48.625, 3);
  });

  it('hot runner takes 30% off the pressure: 100 MPa, ratio 150 (Medium), 5,000 mm2 -> 70 MPa x 34% -> 13.348 t', () => {
    const r = requiredClampForce({ ...base, material: { injectionPressureMaxMpa: 100, flowLengthRatio: 150, referenceMaterial: null }, projectedAreaMm2: 5000, runner: 'hot' });
    expect(r.derivable && r.requiredTonnes).toBeCloseTo(13.348, 3);
  });

  it('floors the adjusted pressure at minInjectionPressure (27.57903 MPa): 30 MPa cold = 25.5 -> 27.579; Easy 12%, 2 cavities, 20,000 mm2 -> 14.849 t', () => {
    const r = requiredClampForce({ ...base, material: { injectionPressureMaxMpa: 30, flowLengthRatio: 250, referenceMaterial: null }, projectedAreaMm2: 20_000, cavityCount: 2, runner: 'cold' });
    if (!r.derivable) throw new Error(r.reason);
    expect(r.flowClass).toBe('easy');
    expect(r.adjustedInjectionPressureMpa).toBeCloseTo(27.57903, 5);
    expect(r.requiredTonnes).toBeCloseTo(14.849, 3);
  });

  it('Hard flow (ratio 50) takes 59%: 150 MPa cold, 10,000 mm2 -> 84.379 t', () => {
    const r = requiredClampForce({ ...base, material: { injectionPressureMaxMpa: 150, flowLengthRatio: 50, referenceMaterial: null }, projectedAreaMm2: 10_000, runner: 'cold' });
    expect(r.derivable && r.flowClass).toBe('hard');
    expect(r.derivable && r.requiredTonnes).toBeCloseTo(84.379, 3);
  });

  it('is not derivable, never defaulted, without material pressure/flow or projected area', () => {
    expect(requiredClampForce({ ...base, material: { injectionPressureMaxMpa: null, flowLengthRatio: null, referenceMaterial: null }, projectedAreaMm2: 1000, runner: 'cold' }).derivable).toBe(false);
    expect(requiredClampForce({ ...base, material: ABS_CLAMP, projectedAreaMm2: 0, runner: 'cold' }).derivable).toBe(false);
  });
});

describe('shot size', () => {
  it('52 g ABS part + 8% cold runner = 56.16 g; x GPPS 893 / ABS 885 melt density x 1.02 safety = 57.801 g GPPS', () => {
    const shotKg = shotWeightKgPerPart(0.052, 'cold');
    expect(shotKg).toBeCloseTo(0.05616, 9);
    expect(shotGppsGramsPerCavity({ shotWeightKg: shotKg, meltDensityKgM3: 885, reference: REF })).toBeCloseTo(57.801, 3);
  });

  it('a hot runner adds 1%, not 8%', () => {
    expect(shotWeightKgPerPart(0.052, 'hot')).toBeCloseTo(0.05252, 9);
  });

  it('keeps milligrams: a 4.16 g part shot is 4.4928 g, not rounded to the gram (regression)', () => {
    expect(shotWeightKgPerPart(0.00416, 'cold')).toBeCloseTo(0.0044928, 9);
  });

  it('has no GPPS figure without a melt density', () => {
    expect(shotGppsGramsPerCavity({ shotWeightKg: 0.05, meltDensityKgM3: null, reference: REF })).toBeNull();
  });
});

describe('cooling and cycle time', () => {
  it('ABS 2 mm wall: alpha = 0.127 / (885 x 1800) = 0.07972 mm2/s; Menges 4/(pi2 alpha) ln(4/pi x 170/15) = 13.57 -> 13.6 s', () => {
    const t = resinThermalProps(ABS_RESIN, REF.cycleModel.moldTemperatureIncreaseC);
    if (!('props' in t)) throw new Error(t.missing.join());
    expect(t.props.alpha).toBeCloseTo(0.0797238, 6);
    const c = runInjectionCycleTime({ wallMm: 2, isLsr: false, real: ABS_RESIN, model: REF.cycleModel, press: MID.timing, shotMeltVolumeMm3: 60_000, cavityCount: 1, gatesPerCavity: 1 }, plasticMoldingCalculatorsByName(), 'injection');
    if (!c.derivable) throw new Error(c.missing.join());
    expect(c.coolSec).toBe(13.6);
  });

  it('cooling grows with wall squared: 4 mm is 4x the 2 mm time (54.3 s)', () => {
    // the molding mold-temperature increase is part of the reference: the 54.3 s is at the reference increase of 0 C
    const model = { ...REF.cycleModel, moldTemperatureIncreaseC: 0 };
    const c = runInjectionCycleTime({ wallMm: 4, isLsr: false, real: ABS_RESIN, model, press: MID.timing, shotMeltVolumeMm3: 60_000, cavityCount: 1, gatesPerCavity: 1 }, plasticMoldingCalculatorsByName(), 'injection');
    if (!c.derivable) throw new Error(c.missing.join());
    expect(c.coolSec).toBe(54.3);
  });

  it('cycle = fill 0.29 + pack 4.8 + cool 13.6 + dry 2.0 = 20.69 s', () => {
    // fill: 56.16 g / 885 kg/m3 = 63,457.6 mm3 / 130,000 = 0.4881 s x 1.0 (1 cavity) x 0.6 (1 gate) = 0.2929 -> 0.29
    // pack: max(2, 0.35 x 13.6 = 4.76 -> 4.8)
    const c = runInjectionCycleTime({
      wallMm: 2, isLsr: false, real: ABS_RESIN, model: REF.cycleModel, press: MID.timing,
      shotMeltVolumeMm3: (0.05616 / 885) * 1e9, cavityCount: 1, gatesPerCavity: 1,
    }, plasticMoldingCalculatorsByName(), 'injection');
    if (!c.derivable) throw new Error(c.missing.join());
    expect(c.fillSec).toBe(0.29);
    expect(c.packSec).toBe(4.8);
    expect(c.coolSec).toBe(13.6);
    expect(c.moldMotionSec).toBe(2);
    expect(c.totalCycleSec).toBe(20.69);
  });
});

describe('press setup', () => {
  it('a press with a setup time on file charges it as the line\'s setup, so the route is fully costed; with none, the route stays incomplete', () => {
    const base = absPart();
    const withSetup = computeInjectionMoldedCostSummary({ ...base, batchSize: 250, mhrRate: { ...base.mhrRate, setupTimeHr: 2 } });
    const line = withSetup.processLines.find((l) => l.process === 'Injection Molding')!;
    expect(line.setupTimeMin).toBe(120);
    expect(line.setupTimeSource).toBe('machine');
    expect(line.setupCost).toBeCloseTo((2 * (base.mhrRate.rate + 30)) / 250, 2); // the press and its one operator
    expect(findRouteDataGaps(withSetup.processLines)).toEqual([]);

    const without = computeInjectionMoldedCostSummary({ ...base, batchSize: 250, mhrRate: { ...base.mhrRate, setupTimeHr: null } });
    expect(findRouteDataGaps(without.processLines).map((g) => g.reason)).toEqual(['setup time was not resolved, and this system will not persist a substituted one']);
    expectSetupContract(withSetup.processLines, true, 'Injection Molding');
    expectSetupContract(without.processLines, false, 'Injection Molding');
  });
});

describe('cost summary: worked ABS part', () => {
  const r = computeInjectionMoldedCostSummary(absPart());
  const im = r.injectionMolding!;

  it('sizes clamp 48.6 t (36.7% of the press) and shot 57.8 g GPPS (49.4% of 117 g)', () => {
    expect(im.cavityCount).toBe(1);
    expect(im.cavityConstrainedBy).toBe('default');
    expect(im.clampRequiredT).toBe(48.6);
    expect(im.clampUtilPct).toBe(36.7);
    expect(im.shotRequiredG).toBe(57.8);
    expect(im.shotUtilPct).toBe(49.4);
    expect(r.processLines.every((l) => !l.physicsGap)).toBe(true);
  });

  it('prices material 56.16 g x 3.046 = 0.171063, press and operator 20.69 s x (29.18 + 30) USD/h = 0.340125, total 0.511188: to the millionth, not to the cent', () => {
    expect(r.grossWeightKg).toBeCloseTo(0.05616, 6);
    expect(im.cycleTimeSec).toBe(20.69);
    const material = 0.05616 * 3.046;
    const run = (20.69 * (29.18 + 30)) / 3600;
    expect(r.materialCost).toBeCloseTo(material, 6);
    expect(r.processLines[0]!.runCost).toBeCloseTo(run, 6);
    expect(r.totalProcessCost).toBeCloseTo(run, 6);
    expect(r.totalCost).toBeCloseTo(material + run, 6);
  });

  it('tooling, USA, 10,000/yr x 3 yr: BOM 2,140 + labour 2,398.67 + base steel 871.56 + cavity machining 1,122.14 + polish 1,843.44 + ejector pins 48.41 + sprue and ring 155 + try-out 2,765.16 + heat treatment 988.70 + cooling 715.29 = 13,048.36, one mold, 0.4349 per part', () => {
    // BOM (no undercut: no Hydraulic Cylinder / Side Lock; Ejector Pin has no quantity; Electrical has no cost):
    //   Air Poppet 25x30 + Ejector Guide Pin Bushing 30x6 + Guide Bush 100x4 + Guide Pin 100x4 + Limit Switch 50x4 + Return Pin 35x6 = 2,140
    // design 3.24 h (area <= 59,253 mm2) x 64.73 = 209.73
    // machining 0.01 m2 / 0.32 x 2 + 4 setup h = 4.0625 h x 100.55 = 408.46
    // assembly 0.006x30 + 2x6 + 1x4(pins 0.25x4) + 4 + 6 = 23.18 h x 76.81 = 1,780.48 (Guide Bush has no assembly time)
    // base steel: 100 x 100 mm part, 1,300 kN press: edge borders 140 / 152 mm -> 380 x 404 mm -> standard base 396 x 446 mm;
    //   depth borders 4 in = 101.6 mm: A = B = max(85.725, 0.5 x 30 + 101.6) = 116.6 mm; stack 28.575 + 116.6 + 116.6 + 47.625 + 28.575 = 337.975 mm;
    //   396 x 446 x 337.975 mm = 59.69 dm3 x 7,850 kg/m3 = 468.58 kg x 1.86 USD/kg x 1.0 = 871.56
    // cavity: 40,000 mm2 = 62.0 in2, average (900 faces): tblHrsPerSqInchAverage row up to 100 in2 = 0.18 h/in2 -> 11.16 h x 100.55 = 1,122.14
    // polish: 0.04 m2 x SPI B3 600 h/m2 = 24 h x 76.81 (assembly rate) = 1,843.44
    // ejector pins: ceil(10,000 / 7,903.21 mm2) = 2 x (5 + 0.25 h x 76.81) = 48.405; sprue bushing 70 + locating ring 85;
    // try-out: 12 h x 1 (press under 500 t) x 3 try-outs x 76.81 = 2,765.16
    // heat treatment: no slides, and both rates are 2.11 USD/kg, so the whole 468.58 kg stack x 2.11 = 988.70
    // cooling: floor(446 / (3 x 8 mm)) = 18 lines x 396 mm / 25.4 mm/min / 60 = 4.677 h x 100.55 = 470.29 + 18 x 2 x (1.25 + 2.50) + 2 x 55 = 715.29
    const t = computeInjectionMoldedCostSummary(absPart({ annualVolume: 10_000, productionLifeYears: 3 })).tooling!;
    expect(t.moldBomSubtotalUsd).toBe(2140);
    expect(t.moldEstimatedDesignHrs).toBe(3.24);
    expect(t.moldEstimatedMachiningHrs).toBeCloseTo(4.0625, 6);
    expect(t.moldEstimatedAssemblyHrs).toBeCloseTo(23.18, 6);
    expect(t.moldLabourCostUsd).toBe(2398.67);
    expect(t.moldToolLifeShots).toBe(144_000);
    expect(t.moldsRequired).toBe(1);
    expect(t.moldBaseSteelUsd).toBeCloseTo(871.56, 2);
    expect(t.moldCavityMachiningUsd).toBeCloseTo(1122.14, 2);
    expect(t.moldPolishUsd).toBeCloseTo(1843.44, 2);
    expect(t.moldEjectorSystemUsd).toBeCloseTo(48.405, 6);
    expect(t.moldSprueAndLocatingRingUsd).toBe(155);
    expect(t.moldTryoutUsd).toBeCloseTo(2765.16, 6);
    expect(t.moldHeatTreatmentUsd).toBeCloseTo(988.70, 1);
    expect(t.moldCoolingUsd).toBeCloseTo(715.29, 2);
    expect(t.moldCostUsd).toBe(13048.36);
    expect(t.moldCostPerPartUsd).toBe(0.4349);
  });

  it('wears out ceil(3,000,000 / 144,000) = 21 molds at 1,000,000/yr x 3 yr: 21 x 13,048.37 = 274,015.65 USD, 0.0913 per part (regression: not rounded to 0.09)', () => {
    const t = computeInjectionMoldedCostSummary(absPart({ annualVolume: 1_000_000, productionLifeYears: 3 })).tooling!;
    expect(t.moldsRequired).toBe(21);
    expect(t.moldCostUsd).toBe(274_015.65);
    expect(t.moldCostPerPartUsd).toBe(0.0913);
  });
});

describe('regressions', () => {
  it('a 4 g part keeps its milligrams: material at 300/kg is 4.4928 g x 300 = 1.34784, not 4 g x 300 = 1.20', () => {
    const r = computeInjectionMoldedCostSummary(absPart({ volume: 4000, materialCostPerKg: 300, signals: { projectedAreaMm2: 1000, undercutCount: 0 } }));
    expect(r.grossWeightKg).toBeCloseTo(0.0044928, 6);
    expect(r.materialCost).toBeCloseTo(0.0044928 * 300, 6);
    expect(r.injectionMolding!.runnerScrapKg).toBeCloseTo(0.0003328, 6);
  });

  it('the 50/kg mis-mapped material alert is a USD benchmark: INR 250/kg (about 3 USD) does not fire it, INR 5,000/kg does', () => {
    const inr = (perKg: number) => computeInjectionMoldedCostSummary(absPart({ materialCostPerKg: perKg, usdToLocal: 85, currencySymbol: '₹' }));
    expect(inr(250).warnings.some((w) => w.includes('MATERIAL COST ALERT'))).toBe(false);
    expect(inr(5000).warnings.some((w) => w.includes('MATERIAL COST ALERT'))).toBe(true);
  });

  it('the material alert states the USD price and the threshold it tests, and the quote-currency price when that differs', () => {
    const alert = (r: ReturnType<typeof computeInjectionMoldedCostSummary>) => r.warnings.find((w) => w.includes('MATERIAL COST ALERT'));
    expect(alert(computeInjectionMoldedCostSummary(absPart({ materialCostPerKg: 5000, usdToLocal: 85, currencySymbol: '₹' }))))
      .toBe('MATERIAL COST ALERT: ABS resolved to $58.82/kg (₹5000.00/kg in the quote currency), above the $50/kg this check expects of a molding resin (most are under $40/kg). Verify the material grade; the cost breakdown below is unreliable until it is confirmed.');
    expect(alert(computeInjectionMoldedCostSummary(absPart({ materialCostPerKg: 90 })))).toContain('resolved to $90.00/kg, above the $50/kg');
    expect(alert(computeInjectionMoldedCostSummary(absPart({ materialCostPerKg: 50 })))).toBeUndefined(); // the threshold itself does not fire
  });

  it('the tooling-dominated check compares USD tooling with the material price in USD, not in local currency', () => {
    // 0.3781 USD/part tooling vs material 0.052 kg: at 3.046 USD/kg = 0.158 USD x 2 = 0.316 -> warns in USD;
    // the same part priced in INR (x85) must not change that verdict (comparing with the INR material price would not warn).
    const toolingWarn = (usdToLocal: number) => computeInjectionMoldedCostSummary(absPart({
      materialCostPerKg: 3.046 * usdToLocal, usdToLocal, annualVolume: 10_000, productionLifeYears: 3,
    })).warnings.some((w) => w.startsWith('Tooling-dominated'));
    expect(toolingWarn(1)).toBe(true);
    expect(toolingWarn(85)).toBe(true);
    // Light part: 5 cm3 = 5.2 g x 3.046 = 0.0158 USD x 2 < its tooling per part -> warns, in either currency.
    const light = (usdToLocal: number) => computeInjectionMoldedCostSummary(absPart({
      volume: 5000, materialCostPerKg: 3.046 * usdToLocal, usdToLocal, annualVolume: 10_000, productionLifeYears: 3,
      signals: { projectedAreaMm2: 1000, undercutCount: 0 },
    })).warnings.some((w) => w.startsWith('Tooling-dominated'));
    expect(light(1)).toBe(true);
    expect(light(85)).toBe(true);
  });

  it('recognises PETG, TPO and TPS (reference thermoplastics) as plastic grades, and still not a metal', () => {
    for (const g of ['PETG Copol', 'TPO', 'TPS', 'ABS', 'Nylon, Type 66', 'Polypropylene G-P H']) expect(isPlasticGrade(g)).toBe(true);
    for (const g of ['SPCC', 'Aluminium 6061', 'Mild Steel IS2062']) expect(isPlasticGrade(g)).toBe(false);
  });
});

describe('press capability (active-quote selector): shot size gates a press', () => {
  const press = (maxTonnage: number, shot: number): MachineCandidate => ({
    machineId: 'm', machineName: 'press', machineClass: 'injection_molding', availabilityStatus: 'available',
    capability: { maxTonnage, shotCapacityGrams: shot, tieBarXMm: 600, tieBarYMm: 600, minMoldHeightMm: null, maxMoldHeightMm: null },
  } as unknown as MachineCandidate);
  const need = (shotGppsG: number | null) => injectionMoldingRequirement({
    projectedAreaMm2: 10_000, clampTonnageRequired: 48.6, clampNotDerivableReason: null, shotGppsG, partLengthMm: 150, partWidthMm: 100,
  });

  it('a press with enough clamp but a 37.69 g shot cannot fill a 57.8 g GPPS shot (regression: it was picked on clamp alone)', () => {
    expect(isCapable(press(132, 37.69), need(57.8))).toBe(false);
    expect(isCapable(press(132, 117), need(57.8))).toBe(true);
  });

  it('a shot that cannot be derived (no melt density) means the press cannot be sized: not capable, never passed unchecked', () => {
    expect(isCapable(press(132, 37.69), need(null))).toBe(false);
  });
});

describe('press labour', () => {
  it('charges the operators as well as the press, in the cycle and the setup, and keeps the two apart on the line', () => {
    const base = absPart();
    const crewOfTwo = computeInjectionMoldedCostSummary({ ...base, batchSize: 250, mhrRate: { ...base.mhrRate, setupTimeHr: 2, labourRate: 34.48, operators: 2 } });
    const line = crewOfTwo.processLines.find((l) => l.process === 'Injection Molding')!;
    const machinePerHr = base.mhrRate.rate;
    const labourPerHr = 34.48 * 2;
    const cycleHours = crewOfTwo.injectionMolding!.cycleTimeSec / 3600;
    const hours = cycleHours + 2 / 250;
    expect(line.operators).toBe(2);
    expect(line.labourRate).toBe(34.48);
    // The split is the cycle's; the setup is stated once, for the machine and the crew together.
    expect(line.machineCostPerPart).toBeCloseTo(cycleHours * machinePerHr, 2);
    expect(line.laborCostPerPart).toBeCloseTo(cycleHours * labourPerHr, 2);
    expect(line.setupCost).toBeCloseTo((2 / 250) * (machinePerHr + labourPerHr), 2);
    expect(line.totalCost).toBeCloseTo(hours * (machinePerHr + labourPerHr), 2);
    expect(line.setupCost + line.runCost).toBeCloseTo(line.totalCost, 2);
  });

  it('half an operator (one operator for two presses, the source value of every injection and foam press) charges half the labour', () => {
    const base = absPart();
    const run = (operators: number) => computeInjectionMoldedCostSummary({ ...base, batchSize: 250, mhrRate: { ...base.mhrRate, setupTimeHr: 2, labourRate: 34.48, operators } });
    const half = run(0.5).processLines.find((l) => l.process === 'Injection Molding')!;
    const one = run(1).processLines.find((l) => l.process === 'Injection Molding')!;
    expect(half.operators).toBe(0.5);
    // Hand-worked on the Kawaguchi KM80 figures (machine 22.69, labour 34.48/h, setup 2 h, batch 250): the crew's hourly cost is 34.48 x 0.5 = 17.24.
    const cycleHours = run(0.5).injectionMolding!.cycleTimeSec / 3600;
    expect(half.laborCostPerPart).toBeCloseTo(cycleHours * 17.24, 2);
    expect(half.setupCost).toBeCloseTo((2 / 250) * (base.mhrRate.rate + 17.24), 2);
    expect(half.laborCostPerPart).toBeCloseTo(one.laborCostPerPart! / 2, 2);
    expect(half.machineCostPerPart).toBeCloseTo(one.machineCostPerPart!, 2); // the machine is charged the same
  });

  it('a press with no labour rate on file leaves the line a gap instead of a free operator', () => {
    const base = absPart();
    const noLabour = computeInjectionMoldedCostSummary({ ...base, mhrRate: { ...base.mhrRate, setupTimeHr: 2, labourRate: null } });
    expect(findRouteDataGaps(noLabour.processLines).map((g) => g.reason).join(' ')).toContain('No labour rate on file');
  });
});

// CHARACTERIZATION, not endorsement: these pin what the model does today so that a change to it is deliberate (docs/plastic-modeling/investigations.md,
// I-1 and I-2). A reviewer who changes a number here is changing the cost model and needs the formula's approval (formula register F-15..F-17).
describe('characterization: what the mold cost depends on today', () => {
  const mold = (over: Partial<InjectionMoldingCostInput>, signals: object = {}) => {
    const r = computeInjectionMoldedCostSummary(absPart({ annualVolume: 100_000, productionLifeYears: 3, ...over, signals: { projectedAreaMm2: 10_000, undercutCount: 0, ...signals } }));
    return { total: r.tooling!.moldCostUsd, molds: r.tooling!.moldsRequired!, perMold: r.tooling!.moldCostUsd / r.tooling!.moldsRequired!, cls: r.tooling!.moldClass, bom: r.tooling!.moldBomSubtotalUsd };
  };

  it('I-1: the cost of ONE mold grows with the cavity count only through the larger base (its plate steel); the components stay the same; more cavities mean fewer molds worn out', () => {
    const one = mold({ cavityCountOverride: 1 });
    expect(one.molds).toBe(3);
    for (const cavities of [2, 4]) {
      const m = mold({ cavityCountOverride: cavities });
      expect(m.bom).toBe(one.bom); // the same purchased components for any number of cavities
      expect(m.perMold).toBeGreaterThanOrEqual(one.perMold); // a larger layout never needs a smaller base
    }
    // 8 cavities of a 100 x 100 mm part in a row need a base over 1.6 m wide: no standard base holds it, so the tooling is a named gap, not a guess.
    const eight = computeInjectionMoldedCostSummary(absPart({ annualVolume: 100_000, productionLifeYears: 3, cavityCountOverride: 8 }));
    expect(eight.tooling).toBeUndefined();
    expect(eight.warnings.join(' ')).toMatch(/Tooling not costed: .*no standard mold base.*custom base is not modelled/);
    expect(mold({ cavityCountOverride: 4 }).molds).toBe(1);
    expect(mold({ cavityCountOverride: 4 }).total).toBeLessThan(one.total); // a 4-cavity tool is priced below a 1-cavity one only because fewer molds wear out
  });

  it('I-2: the SPI class changes with volume, complexity and undercuts, but not the cost of a mold (Class 105, 103 and 101 molds cost the same each)', () => {
    const c105 = mold({ annualVolume: 1000, productionLifeYears: 1 });
    const c103 = mold({ annualVolume: 100_000, productionLifeYears: 3 });
    const c101 = mold({ annualVolume: 2_000_000, productionLifeYears: 5 });
    expect([c105.cls, c103.cls, c101.cls]).toEqual(['Class105', 'Class103', 'Class101']);
    expect(c103.perMold).toBeCloseTo(c105.perMold, 2);
    expect(c101.perMold).toBeCloseTo(c105.perMold, 2);
  });

  it('I-2: how many molds are bought comes from tblToolLife (shots per tool by resin), not from the class rating: a Class 101 mold rated for 9,999,999,999 cycles is bought 70 times for 10 million ABS shots', () => {
    const c101 = mold({ annualVolume: 2_000_000, productionLifeYears: 5 });
    expect(c101.cls).toBe('Class101');
    expect(c101.molds).toBe(Math.ceil(10_000_000 / 144_000)); // tblToolLife ABS
  });

  it('I-2: undercuts add the staged slide hardware (hydraulic cylinder, side lock) and raise the class; nothing else about the class is priced', () => {
    const plain = mold({}, { partingComplexity: 0.1 });
    const slides = mold({}, { partingComplexity: 0.9, undercutCount: 6, slideBundleCount: 2 });
    expect(slides.bom! - plain.bom!).toBe(1400 + 640); // 4 hydraulic cylinders x 350 + 4 side locks x 160
    expect(slides.cls).toBe('Class102');
  });
});

describe('slides and lifters in the mold (F-28)', () => {
  const NONE = { small: 0, medium: 0, large: 0 };
  it('prices the CAD-sized lifter blocks into the mold and drops G-03 from the quote; unsized bundles keep it a gap', () => {
    const sized = computeInjectionMoldedCostSummary(absPart({
      annualVolume: 10_000, productionLifeYears: 3,
      signals: { ...absPart().signals, sideActionBlocks: { slide: NONE, lifter: { ...NONE, small: 4 }, unsized: 0 } },
    }));
    expect(sized.tooling?.moldSideActionUsd).toBeGreaterThan(0);
    expect(sized.validation?.unsupported.map((u) => u.id)).not.toContain('G-03');
    const unsized = computeInjectionMoldedCostSummary(absPart({
      annualVolume: 10_000, productionLifeYears: 3,
      signals: { ...absPart().signals, sideActionBlocks: { slide: NONE, lifter: NONE, unsized: 2 } },
    }));
    expect(unsized.validation?.unsupported.map((u) => u.id)).toContain('G-03');
    expect(unsized.warnings.join(' ')).toMatch(/slides and lifters \(the CAD bundles are not all recognised and sized\)/);
  });
});

describe('rib inserts and their EDM in the mold (F-31)', () => {
  it('prices the CAD-measured ribs taller than machinedRibThreshold and drops G-04; unmeasured ribs keep it a gap', () => {
    const run = (ribs: RibSignals) => computeInjectionMoldedCostSummary(absPart({ annualVolume: 10_000, productionLifeYears: 3, signals: { ...absPart().signals, ribs } }));
    const measured = run({ measured: [{ heightMm: 25, lengthMm: 300, thicknessMm: 2 }], unmeasured: 0 });
    expect(measured.tooling?.moldRibInsertUsd).toBeGreaterThan(0);
    expect(measured.validation?.unsupported.map((u) => u.id)).not.toContain('G-04');
    const unmeasured = run({ measured: [], unmeasured: 3 });
    expect(unmeasured.tooling?.moldRibInsertUsd).toBe(0);
    expect(unmeasured.validation?.unsupported.map((u) => u.id)).toContain('G-04');
  });
});

describe('operations the model does not cost', () => {
  const warn = (signals: object, grade = 'Generic ABS') => computeInjectionMoldedCostSummary({ ...absPart(), materialGrade: grade, signals: { ...absPart().signals, ...signals } }).warnings.join('\n');

  it('names the reference data a required operation has that the model does not read yet, instead of saying none exists', () => {
    const w = warn({ undercutCount: 6 });
    expect(w).toContain('Side Action (Slide/Lifter) required');
    // the blocks are in the tooling (F-28); what stays unread is the slide movement in the cycle
    expect(w).toContain('slideCycleRate');
    expect(w).not.toMatch(/Side Action[^\n]*no sourced time\/rate data/);
  });

  it('an operation with nothing in the reference still says there is no sourced data', () => {
    expect(warn({}, 'Generic ABS')).toMatch(/Visual Inspection required[^\n]*no sourced time\/rate data exists/);
  });
});

describe('quote validation: how far the quote can be trusted', () => {
  const part = (over: Partial<InjectionMoldingCostInput> = {}) => computeInjectionMoldedCostSummary(absPart({ annualVolume: 100_000, productionLifeYears: 3, ...over }));

  it('lists the formulas the quote used with their versions, the weakest state, and the assumptions it rests on', () => {
    const v = part().validation!;
    expect(v.formulas.map((f) => f.id)).toEqual(expect.arrayContaining(['F-01', 'F-02', 'F-03', 'F-04', 'F-05', 'F-06', 'F-07', 'F-08', 'F-10', 'F-11', 'F-12', 'F-13', 'F-14', 'F-15', 'F-16', 'F-17', 'F-18']));
    expect(v.formulas.find((f) => f.id === 'F-04')).toMatchObject({ version: 1, state: 'ASSUMED' });
    expect(v.state).toBe('ASSUMED');
    expect(v.assumptions.some((a) => a.startsWith('F-03: '))).toBe(true); // the runner allowance
    expect(v.assumptions.some((a) => a.startsWith('F-16: '))).toBe(true); // the mold tooling scope
  });

  it('says what a real mold quote needs that the model cannot compute: a quote with a mold is not complete', () => {
    const v = part().validation!;
    expect(v.complete).toBe(false);
    // G-11: ABS is hygroscopic, so material drying is routed, and no data exists for it. The mold is a cold runner (no hot drops, G-08), an SPI class
    // tblSpiType builds without inserts (G-07) and the default texture None (G-05): only the gaps that apply are listed.
    expect(v.unsupported.map((u) => u.id)).toEqual(['G-03', 'G-04', 'G-06', 'G-09', 'G-10', 'G-11']);
  });

  it('without a volume there is no mold: the mold formulas and gaps are left out, the cycle and period gaps remain', () => {
    const v = computeInjectionMoldedCostSummary(absPart()).validation!;
    expect(v.formulas.map((f) => f.id)).not.toContain('F-16');
    expect(v.unsupported.map((u) => u.id)).toEqual(['G-09', 'G-10', 'G-11']);
  });

  it('a cycle that cannot be derived does not claim the cycle formulas', () => {
    const v = part({ pressTiming: null }).validation!;
    expect(v.formulas.map((f) => f.id)).not.toEqual(expect.arrayContaining(['F-04']));
  });

  it('the cycle steps in the trace carry their formula id, version and state', () => {
    const line = part().processLines.find((l) => l.process === 'Injection Molding')!;
    const byId = Object.fromEntries((line.calculationTrace ?? []).map((t) => [t.formulaId, t]));
    expect(byId['F-04']).toMatchObject({ fieldName: 'Cooling Time', formulaVersion: 1, state: 'ASSUMED' });
    expect(byId['F-05']).toMatchObject({ state: 'VALIDATED' });
    expect(byId['F-07']).toMatchObject({ state: 'VALIDATED' });
  });

  it('a material that cannot be molded has no quote to qualify: no validation, the one finding stands', () => {
    const r = computeInjectionMoldedCostSummary(absPart({ materialGrade: 'Clear Resin (SLA)', materialStockForm: 'Liquid Resin (SLA)', materialMatlState: 'Photopolymer' }));
    expect(r.validation).toBeUndefined();
  });
});

describe('calculation snapshot on the saved line', () => {
  const line = () => computeInjectionMoldedCostSummary(absPart({ annualVolume: 100_000, productionLifeYears: 3 })).processLines.find((l) => l.process === 'Injection Molding')!;

  it('the molding line carries the dataset fingerprint, the engine contract and the formulas the quote used with their versions', () => {
    const s = line().calculationSnapshot!;
    expect(s.schema).toBe('plastic_calc_snapshot_v1');
    expect(s.referenceData).toEqual({ sourceVersion: REF.sourceVersion, fingerprint: REF.datasetFingerprint });
    expect(s.engineVersion).toBe('emithran-cost-1');
    expect(s.formulas.map((f) => f.id)).toEqual(expect.arrayContaining(['F-04', 'F-12', 'F-16']));
    expect(s.state).toBe('ASSUMED');
    expect(s.unsupported).toContain('G-03');
    expect(s.unsupported).not.toContain('G-01'); // the mold base steel is costed (F-25)
    expect(s.unsupported).not.toContain('G-02'); // the cavity and core machining and polish are costed (F-26)
  });

  it('the fingerprint is that of the reference rows (the real staged data resolves to one stable value)', () => {
    expect(REF.datasetFingerprint).toMatch(/^[0-9a-f]{16}$/);
  });

  it('a material that cannot be molded has no snapshot: there is no calculation to reproduce', () => {
    const r = computeInjectionMoldedCostSummary(absPart({ materialGrade: 'Clear Resin (SLA)', materialStockForm: 'Liquid Resin (SLA)', materialMatlState: 'Photopolymer' }));
    expect(r.processLines.every((l) => l.calculationSnapshot === undefined)).toBe(true);
  });
});

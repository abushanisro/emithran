import { plasticMoldingCalculatorsByName } from '../../../../../modules/bom-items/costing/plastic-molding/calculators/plastic-molding-calculator-spec';
import { computeInjectionMoldedCostSummary, type InjectionMoldingCostInput } from '../../../../../modules/bom-items/costing/plastic-molding/process/cost-injection-molding-engine';
import { realMaterialClamp, realPlasticReference } from './real-plastic-reference';

// Validation against an independent reference: the should-cost workbook of the Mirror Cover (RVMSA2CP1, PP + 20% GF, injection molding, 2 cavities, 150,000 per year, rupees).
// Part A recomputes the workbook from its own inputs, formula by formula, to prove the reference was read right. Part B replays the same part through our engine and, for each step,
// asserts what must be equal and pins what differs, with the cause: an input the library does not have, a different method, a scope not modelled, or a defect. Cell addresses are the
// workbook's ("Mirror Cover.xlsx", sheet RVMSA2CP1-Mirror Cover unless noted).

// ── The workbook's inputs ───────────────────────────────────────────────────────────────────────
const WB_IN = {
  annualVolume: 150000, lotSize: 12500, cavities: 2,
  sprue: { lengthMm: 165, diaMm: 4.5 }, runner: { lengthMm: 45, diaMm: 3 }, gate: { lengthMm: 20, diaMm: 2.5, count: 2 },
  density: 1040, partVolumeMm3: 72115.38461538461, surfaceAreaMm2: 25854,
  pricePerKg: 120, scrapPricePerKg: 30, scrapRecovery: 0.9,
  projectedAreaMm2: 11703, runnerProjectedAreaMm2: 135, cavityPressureBar: 300, viscosityGrade: 1, safetyFactor: 1.2,
  injectionRateKgPerHr: 130, injectionEfficiency: 0.75,
  avgWallMm: 1.84, k: 0.35, cp: 1.25, meltDensity: 936, injectionTempC: 235, ejectionTempC: 120, moldTempC: 65,
  holdingS: 5, slideLifterS: 4, dryCycleS: 3, ejectionS: 1, insertPickPlaceS: 5,
  toolLoadingMin: 120, directLabors: 1, qaInspectors: 1, directLaborRate: 102, qaRate: 115, samplingRate: 0.01, inspectionMin: 5, yieldFraction: 0.95, machineRate: 120,
  overheads: { material: 0.05, machine: 0.03, labor: 0.02, profit: 0.08 },
};

// ── The workbook's results (its stored values) ──────────────────────────────────────────────────
const WB_OUT = {
  runnerVolumeMm3: 3138.6474104770527,       // E36
  runnerWeightG: 4,                          // E40
  partWeightG: 75,                           // E57
  shotWeightG: 154,                          // E59
  grossMaterialPerPart: 9.24,                // E64
  scrapCreditPerPart: 0.054,                 // E65
  materialCost: 9.186,                       // E68
  clampTonnes: 86.44255199999998,            // E82
  injectionTimeS: 5.686153846153846,         // E99
  thermalDiffusivity: 0.29914529914529914,   // E105
  coolingS: 2.4672103366268323,              // E110 (the formula there divides by 2 x 3.142, see Part A)
  cycleS: 26.153364182780678,                // E118
  machineCost: 0.4358894030463446,           // E170
  setupCost: 0.035519999999999996,           // E171
  laborCost: 0.37050599258939293,            // E172
  inspectionCost: 0.09583333333333334,       // E173
  yieldCost: 0.3936874364484539,             // E174
  processCost: 1.3314361654175246,           // E175
  overheads: 1.3211816951765802,             // E185
  totalPartCost: 11.838617860594105,         // E191
  moldCostInr: 1306174.8591871501,           // 'Mold Cost Estimate'!C65
};

/** The workbook's own pi (3.142), squared: the denominator its cooling cell has in mind. */
const PI2 = 3.142 ** 2;

/** The workbook, recomputed from its inputs: each line is the formula of the cell named in its comment. */
function oracle(coolingDenominator: 'workbook (2 x 3.142)' | 'pi squared') {
  const i = WB_IN;
  const area = (d: number) => (Math.PI / 4) * d * d;
  const runnerVolume = area(i.sprue.diaMm) * i.sprue.lengthMm + area(i.runner.diaMm) * i.runner.lengthMm + area(i.gate.diaMm) * i.gate.lengthMm * i.gate.count;     // E25, E29, E34, E36
  const runnerWeight = Math.ceil(i.density * runnerVolume * 1e-6);                                                                                                 // E40 (ROUNDUP)
  const partWeight = (1.04 * i.partVolumeMm3) / 1000;                                                                                                              // E57
  const shotWeight = partWeight * i.cavities + runnerWeight;                                                                                                       // E59
  const gross = ((shotWeight / 1000) * i.pricePerKg) / i.cavities;                                                                                                 // E64
  const scrapCredit = (((runnerWeight / i.cavities) / 1000) * i.scrapRecovery) * i.scrapPricePerKg;                                                                // E65
  const material = gross - scrapCredit;                                                                                                                            // E66, E68
  const shotArea = i.projectedAreaMm2 * i.cavities + i.runnerProjectedAreaMm2;                                                                                     // E81
  const cavityPressure = i.cavityPressureBar * 1.02 * i.viscosityGrade;                                                                                            // E79
  const clamp = ((shotArea / 100) * cavityPressure / 1000) * i.safetyFactor;                                                                                       // E82
  const injection = (3600 * (shotWeight / 1000)) / (i.injectionRateKgPerHr * i.injectionEfficiency);                                                               // E99
  const alpha = (i.k / (i.cp * i.meltDensity)) * 1000;                                                                                                             // E105
  const ln = Math.log((4 / 3.142) * (i.injectionTempC - i.moldTempC) / (i.ejectionTempC - i.moldTempC));
  const cooling = (i.avgWallMm ** 2) / ((coolingDenominator === 'pi squared' ? PI2 : 3.142 * 2) * alpha) * ln;                                                     // E110
  const cycle = i.holdingS + i.slideLifterS + i.dryCycleS + i.ejectionS + i.insertPickPlaceS + injection + cooling;                                                // E118
  const setupMinPerPart = i.toolLoadingMin / i.lotSize;                                                                                                            // E158
  const machine = ((i.machineRate / 3600) * cycle) / i.cavities;                                                                                                   // E170
  const setup = (i.directLaborRate / 60) * (setupMinPerPart * i.directLabors) + (i.machineRate / 60) * setupMinPerPart;                                             // E171
  const labor = (i.directLaborRate / 3600) * (cycle * i.directLabors) / i.cavities;                                                                                // E172
  const inspection = ((i.qaRate / 60) * (i.qaInspectors * i.inspectionMin)) * (i.samplingRate * i.lotSize) / i.lotSize;                                            // E173
  const yieldCost = (1 - i.yieldFraction) * ((material - (partWeight / 1000) * i.scrapPricePerKg) + machine + setup + labor + inspection);                          // E174
  const process = machine + setup + labor + inspection + yieldCost;                                                                                                // E175
  const overheads = i.overheads.material * material + i.overheads.machine * machine + i.overheads.labor * labor + i.overheads.profit * (material + process);        // E180-E185
  return { runnerVolume, runnerWeight, partWeight, shotWeight, gross, scrapCredit, material, clamp, injection, alpha, cooling, cycle, machine, setup, labor, inspection, yieldCost, process, overheads, total: material + process + overheads };
}

describe('Part A: the workbook, recomputed from its own inputs', () => {
  const o = oracle('workbook (2 x 3.142)');

  it('every material, tonnage, time and cost the workbook states is reproduced by its formulas (so the reference was read correctly)', () => {
    expect(o.runnerVolume).toBeCloseTo(WB_OUT.runnerVolumeMm3, 9);
    expect(o.runnerWeight).toBe(WB_OUT.runnerWeightG);
    expect(o.partWeight).toBeCloseTo(WB_OUT.partWeightG, 9);
    expect(o.shotWeight).toBeCloseTo(WB_OUT.shotWeightG, 9);
    expect(o.gross).toBeCloseTo(WB_OUT.grossMaterialPerPart, 9);
    expect(o.scrapCredit).toBeCloseTo(WB_OUT.scrapCreditPerPart, 9);
    expect(o.material).toBeCloseTo(WB_OUT.materialCost, 9);
    expect(o.clamp).toBeCloseTo(WB_OUT.clampTonnes, 9);
    expect(o.injection).toBeCloseTo(WB_OUT.injectionTimeS, 9);
    expect(o.alpha).toBeCloseTo(WB_OUT.thermalDiffusivity, 9);
    expect(o.cooling).toBeCloseTo(WB_OUT.coolingS, 9);
    expect(o.cycle).toBeCloseTo(WB_OUT.cycleS, 9);
    expect(o.machine).toBeCloseTo(WB_OUT.machineCost, 9);
    expect(o.setup).toBeCloseTo(WB_OUT.setupCost, 9);
    expect(o.labor).toBeCloseTo(WB_OUT.laborCost, 9);
    expect(o.inspection).toBeCloseTo(WB_OUT.inspectionCost, 9);
    expect(o.yieldCost).toBeCloseTo(WB_OUT.yieldCost, 9);
    expect(o.process).toBeCloseTo(WB_OUT.processCost, 9);
    expect(o.overheads).toBeCloseTo(WB_OUT.overheads, 9);
    expect(o.total).toBeCloseTo(WB_OUT.totalPartCost, 9);
  });

  it('FINDING in the workbook: its cooling time divides by 2 x 3.142 where the cooling formula has pi squared (3.142 ^ 2); with pi squared it is 1.57 s, not 2.47 s', () => {
    const intended = oracle('pi squared');
    expect(intended.cooling).toBeCloseTo(1.5703, 3);
    expect(WB_OUT.coolingS / intended.cooling).toBeCloseTo(3.142 / 2, 6);    // 2.47 / 1.57: pi squared over 2 pi
    // the workbook's 26.15 s cycle carries that: 0.9 s of its 26 s
    expect(WB_OUT.cycleS - intended.cycle).toBeCloseTo(0.8969, 3);
  });
});

// ── Part B: our engine, replaying the same part ─────────────────────────────────────────────────
const INR_PER_USD = 1 / 0.0155;          // the workbook's exchange rate is not stated; the same factor is used both ways, so nothing here depends on it
const press = { clampTonnes: 110, shotCapacityG: 800 };                      // 'Selected Tonnage 110 Ton' (E153); a shot capacity that does not constrain
const injectionRateMm3PerS = (WB_IN.injectionRateKgPerHr * 1e9) / 3600 / WB_IN.meltDensity;   // 130 kg/h of melt at 936 kg/m3

const replay = (over: Partial<InjectionMoldingCostInput> = {}) => computeInjectionMoldedCostSummary({
  volume: WB_IN.partVolumeMm3, surfaceArea: WB_IN.surfaceAreaMm2, wallThicknessNominalMm: WB_IN.avgWallMm, materialGrade: 'PP GF20%', materialCostPerKg: WB_IN.pricePerKg,
  materialDensityKgM3: WB_IN.density, materialSource: 'db', batchSize: WB_IN.lotSize, family: 'plastic_molded',
  mhrRate: { rate: WB_IN.machineRate, labourRate: WB_IN.directLaborRate, operators: 1, source: 'mhr_database', machineClass: 'injection_molding', machineName: 'Generic Injection Molding Machine', commodityCode: null, setupTimeHr: WB_IN.toolLoadingMin / 60 },
  deburrRate: { rate: 0, labourRate: 0, operators: 0, source: 'mhr_database', machineClass: 'deburring', machineName: null, commodityCode: null },
  inspectionRate: { rate: 0, labourRate: 0, operators: 0, source: 'mhr_database', machineClass: 'cmm', machineName: null, commodityCode: null },
  machineClampTonnes: press.clampTonnes, machineShotCapacityG: press.shotCapacityG,
  pressTiming: { injectionRateMm3PerS, dryCycleTimeS: WB_IN.dryCycleS }, goodPartYield: WB_IN.yieldFraction,
  calculators: plasticMoldingCalculatorsByName(),
  // PP + 20% GF is not a grade of the library (memory/ lists Polypropylene G-P H and other unfilled grades): the plain grade's clamp properties stand in, and its flow class is the difference below
  materialClamp: realMaterialClamp('Polypropylene G-P H'),
  realResinInputs: { meltingTempC: WB_IN.injectionTempC, moldTempC: WB_IN.moldTempC, ejectionTempC: WB_IN.ejectionTempC, specificHeatMeltJgC: WB_IN.cp, thermalConductivityMeltWMK: WB_IN.k, densityOfMeltKgM3: WB_IN.meltDensity },
  materialType: 'Polypropylene', plasticReference: realPlasticReference(), location: 'India', annualVolume: WB_IN.annualVolume, productionLifeYears: 5, cavityCountOverride: WB_IN.cavities,
  currencySymbol: '₹', usdToLocal: INR_PER_USD,
  signals: { projectedAreaMm2: WB_IN.projectedAreaMm2, undercutCount: 0, partingComplexity: 0.2, wallThicknessMinMm: 1.0 },
  ...over,
} as unknown as InjectionMoldingCostInput) as unknown as {
  materialCost: number; grossWeightKg: number; totalCost: number; totalProcessCost: number; warnings: string[];
  processLines: Array<{ setupCost: number; runCost: number; totalCost: number; machineCostPerPart?: number; laborCostPerPart?: number; calculationTrace?: Array<{ fieldName: string; value: number | string | null }> }>;
  injectionMolding: { runnerScrapKg: number; cycleTimeSec: number; clampRequiredT: number; flowClass: string; cavityPressureMpa: number };
  tooling: { moldCostUsd: number; moldsRequired: number };
};
const trace = (r: ReturnType<typeof replay>, name: string): number => Number(r.processLines[0]!.calculationTrace!.find((t) => t.fieldName === name)!.value);

describe('Part B1: what must be equal, with identical inputs', () => {
  const r = replay();

  it('thermal diffusivity is the workbook\'s (E105)', () => {
    expect(trace(r, 'Thermal Diffusivity')).toBeCloseTo(WB_OUT.thermalDiffusivity, 3);
  });

  it('cooling time is the workbook\'s formula with pi squared, as the cell evidently intends (E110 corrected), to the 0.1 s the calculator rounds to', () => {
    const intended = oracle('pi squared').cooling;
    expect(trace(r, 'Cooling Time')).toBeCloseTo(intended, 0);
    expect(Math.abs(trace(r, 'Cooling Time') - intended)).toBeLessThanOrEqual(0.05 + 1e-9);
    // and not the workbook's stated 2.47 s, which is its typo
    expect(Math.abs(trace(r, 'Cooling Time') - WB_OUT.coolingS)).toBeGreaterThan(0.8);
  });

  it('machine, labor and setup per part are the workbook\'s formulas (E170-E172) applied to our cycle, the press yield and the cavities', () => {
    const line = r.processLines[0]!;
    const perPartS = r.injectionMolding.cycleTimeSec / WB_IN.cavities / WB_IN.yieldFraction;       // our cycle, per good part
    expect(Math.abs(line.machineCostPerPart! - (WB_IN.machineRate / 3600) * perPartS)).toBeLessThanOrEqual(0.005 + 1e-9);
    expect(Math.abs(line.laborCostPerPart! - (WB_IN.directLaborRate / 3600) * perPartS)).toBeLessThanOrEqual(0.005 + 1e-9);
    // setup: (machine rate + labor rate) x setup hours / lot size: the workbook's E171
    expect(Math.abs(line.setupCost - ((WB_IN.machineRate + WB_IN.directLaborRate) * (WB_IN.toolLoadingMin / 60)) / WB_IN.lotSize)).toBeLessThanOrEqual(0.005 + 1e-9);
  });

  it('the fill is the shot volume over the press rate, as the workbook\'s injection time is the shot weight over the rate (E99): the same quantity, with a different efficiency', () => {
    const shotVolumeMm3 = trace(r, 'Shot Melt Volume');
    const fill = trace(r, 'Fill Time');
    // ours: volume / rate x the staged fill factor of the gates (0.6 for one gate per cavity); the workbook: weight / (rate x 75 %)
    expect(fill).toBeCloseTo((shotVolumeMm3 / injectionRateMm3PerS) * trace(r, 'Fill Factor for Cavities') * trace(r, 'Fill Factor for Gates'), 2);
  });
});

describe('Part B2: the clamp tonnage depends on the grade\'s flow class, which the library lacks for this grade', () => {
  it('with the plain PP stand-in (easy flow, 12 %) the required clamp is 35 t: not comparable with the workbook\'s 86 t', () => {
    const r = replay();
    expect(r.injectionMolding.flowClass).toBe('easy');
    expect(r.injectionMolding.clampRequiredT).toBeCloseTo(34.8, 0);
  });

  it('with a medium-flow grade (34 %, what a glass-filled grade is) it is 98.6 t: within 4 % of the workbook\'s recommendation of 95 t (E152)', () => {
    const r = replay({ materialClamp: { injectionPressureMaxMpa: 130, flowLengthRatio: 150, referenceMaterial: 'a medium-flow grade' } });
    expect(r.injectionMolding.flowClass).toBe('medium');
    expect(r.injectionMolding.clampRequiredT).toBeCloseTo(98.6, 0);
    expect(Math.abs(r.injectionMolding.clampRequiredT - 95) / 95).toBeLessThan(0.04);
  });
});

describe('Part B3: the differences that remain, pinned, each with its cause', () => {
  const r = replay();
  const wb = oracle('workbook (2 x 3.142)');

  it('CYCLE TIME (method): ours is fill + pack + cooling + the press dry cycle = 9.3 s; the workbook adds a 5 s hold, 4 s slide, 1 s ejection and 5 s insert handling and divides the fill by 75 % = 26.2 s', () => {
    expect(r.injectionMolding.cycleTimeSec).toBeCloseTo(9.29, 1);
    expect(trace(r, 'Pack Time')).toBe(2);                         // the staged minimum; the workbook's holding time is a fixed 5 s
    const fixedExtras = WB_IN.slideLifterS + WB_IN.ejectionS + WB_IN.insertPickPlaceS;
    expect(fixedExtras).toBe(10);                                   // 38 % of the workbook's cycle: slides, ejection and inserts are not in our calculator (G-03, G-07 are UNSUPPORTED)
    expect(r.injectionMolding.cycleTimeSec / WB_OUT.cycleS).toBeLessThan(0.4);
    expect(wb.cycle).toBeCloseTo(WB_OUT.cycleS, 9);
  });

  it('RUNNER (method): ours takes the runner from the staged runner coefficients (12 g per shot); the workbook sizes sprue, runner and gates from the tool (4 g)', () => {
    expect(r.injectionMolding.runnerScrapKg * 1000).toBeCloseTo(12, 0);
    expect(WB_OUT.runnerWeightG).toBe(4);
  });

  it('MATERIAL (method): ours charges the shot over the good-part yield with no credit for the runner scrap; the workbook credits the scrap and charges the yield on material and process', () => {
    expect(r.materialCost).toBeCloseTo((r.grossWeightKg * WB_IN.pricePerKg) / WB_IN.yieldFraction, 1);
    expect(WB_OUT.scrapCreditPerPart).toBeGreaterThan(0);
    expect(r.materialCost).toBeGreaterThan(WB_OUT.materialCost);
  });

  it('PERIOD COSTS (not modelled): ours has no overhead or profit (formula G-10 is UNSUPPORTED); the workbook adds 5 % / 3 % / 2 % of its lines and 8 % profit = 11 % of its part cost', () => {
    expect(wb.overheads / wb.total).toBeCloseTo(0.1116, 3);
    expect(r.warnings.join(' ')).not.toMatch(/profit|overhead/i);
  });

  it('INSPECTION (not modelled): ours names visual and dimensional inspection as required and not costed; the workbook costs a sampled QA inspector (0.096 per part)', () => {
    expect(r.warnings.join(' ')).toMatch(/Inspection required .* not costed/);
    expect(WB_OUT.inspectionCost).toBeCloseTo(0.0958, 3);
  });

  it('TOOLING (scope): ours prices the purchased mold components only (about 4,300 USD, and says the mold-base steel and the toolroom hours are not priced); the workbook\'s mold estimate is 13.06 lakh rupees (about 20,200 USD)', () => {
    expect(r.tooling.moldCostUsd).toBeCloseTo(4280, 0);
    expect(r.warnings.join(' ')).toMatch(/does NOT include mold-base steel/);
    expect(r.warnings.join(' ')).toMatch(/toolmaker hours .* NOT priced/);
    const workbookUsd = WB_OUT.moldCostInr / INR_PER_USD;
    expect(workbookUsd).toBeGreaterThan(20000);
    expect(r.tooling.moldCostUsd / workbookUsd).toBeLessThan(0.25);
  });
});

describe('Part B4: the precision the engine keeps', () => {
  it('a line is the arithmetic to the millionth (this was a defect found by this validation: every line was rounded to 0.01, up to 17 % of a 0.03 labor line; fixed, see plastic-line-precision.spec.ts)', () => {
    // a Back-cover-sized part in dollars: one cavity, 0.5 operator at 34.48 USD/h, machine 19.84 USD/h
    const r = replay({
      currencySymbol: '$', usdToLocal: 1, materialCostPerKg: 5, batchSize: 250, cavityCountOverride: 1, goodPartYield: 1,
      mhrRate: { rate: 19.84, labourRate: 34.48, operators: 0.5, source: 'mhr_database', machineClass: 'injection_molding', machineName: 'Press', commodityCode: null, setupTimeHr: 2 },
      volume: 18844.74, wallThicknessNominalMm: 1.5, signals: { projectedAreaMm2: 8000, undercutCount: 0, partingComplexity: 0.2 },
    } as never);
    const line = r.processLines[0]!;
    const sec = r.injectionMolding.cycleTimeSec;
    expect(line.laborCostPerPart).toBeCloseTo((34.48 * 0.5 / 3600) * sec, 5);
    expect(line.machineCostPerPart).toBeCloseTo((19.84 / 3600) * sec, 5);
    expect(line.machineCostPerPart! + line.laborCostPerPart!).toBeCloseTo(line.runCost, 5);
  });
});

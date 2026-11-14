import { plasticMoldingCalculatorsByName } from '../../../../../modules/bom-items/costing/plastic-molding/calculators/plastic-molding-calculator-spec';
import { computeInjectionMoldedCostSummary, type InjectionMoldingCostInput } from '../../../../../modules/bom-items/costing/plastic-molding/process/cost-injection-molding-engine';
import { realMaterialClamp, realPlasticReference } from './real-plastic-reference';

// A line is priced to the precision the database keeps (six decimals), not to the cent. Found by replaying an independent reference: every line was rounded to 0.01, which is
// up to half a cent on each, 17 % of a 0.03 labor line, and the line's cycle was cut to 0.6 s steps (a 6.22 s cycle was saved as 6.0 s). Sized like a small molded cover in dollars.

const YIELD = 0.95;
const MACHINE_RATE = 19.84;
const LABOUR_RATE = 34.48;
const OPERATORS = 0.5;
const SETUP_HR = 2;
const BATCH = 250;

const cover = (over: Partial<InjectionMoldingCostInput> = {}) => computeInjectionMoldedCostSummary({
  volume: 18844.74, surfaceArea: 25696, wallThicknessNominalMm: 1.5, materialGrade: 'PP', materialCostPerKg: 11.486, materialDensityKgM3: 1040, materialSource: 'db',
  batchSize: BATCH, family: 'plastic_molded',
  mhrRate: { rate: MACHINE_RATE, labourRate: LABOUR_RATE, operators: OPERATORS, source: 'mhr_database', machineClass: 'injection_molding', machineName: 'Press', commodityCode: null, setupTimeHr: SETUP_HR },
  deburrRate: { rate: 0, labourRate: 0, operators: 0, source: 'mhr_database', machineClass: 'deburring', machineName: null, commodityCode: null },
  inspectionRate: { rate: 0, labourRate: 0, operators: 0, source: 'mhr_database', machineClass: 'cmm', machineName: null, commodityCode: null },
  machineClampTonnes: 100, machineShotCapacityG: 400, pressTiming: { injectionRateMm3PerS: 64000, dryCycleTimeS: 1.1 }, goodPartYield: YIELD,
  calculators: plasticMoldingCalculatorsByName(), materialClamp: realMaterialClamp('Polypropylene G-P H'), materialType: 'Polypropylene', plasticReference: realPlasticReference(),
  realResinInputs: { meltingTempC: 291, moldTempC: 91, ejectionTempC: 129, specificHeatMeltJgC: 1.7, thermalConductivityMeltWMK: 0.3, densityOfMeltKgM3: 1200 },
  location: 'USA', annualVolume: 1000, productionLifeYears: 5, cavityCountOverride: 1, currencySymbol: '$', usdToLocal: 1,
  signals: { projectedAreaMm2: 8000, undercutCount: 0, partingComplexity: 0.2 },
  ...over,
} as unknown as InjectionMoldingCostInput);

describe('a molding line keeps the precision of the database, not of a cent', () => {
  const r = cover();
  const line = r.processLines[0]!;
  const perPartMin = r.injectionMolding!.cycleTimeSec / 1 / YIELD / 60;          // the line's cycle: per part, per good part
  const exactMachine = perPartMin * (MACHINE_RATE / 60);
  const exactLabor = perPartMin * ((LABOUR_RATE * OPERATORS) / 60);
  const exactSetup = (SETUP_HR * (MACHINE_RATE + LABOUR_RATE * OPERATORS)) / BATCH;

  it('the machine and labor of the cycle and the setup are the arithmetic, to the millionth', () => {
    expect(line.machineCostPerPart).toBeCloseTo(exactMachine, 5);
    expect(line.laborCostPerPart).toBeCloseTo(exactLabor, 5);
    expect(line.setupCost).toBeCloseTo(exactSetup, 5);
    // and they are not cents: this line's labor is 0.0311, which a cent rounding made 0.03
    expect(line.laborCostPerPart).not.toBe(Math.round(line.laborCostPerPart! * 100) / 100);
  });

  it('the parts of the line add up to the line (setup + run = total; machine + labor = run), which cents never did: 0.30 + 0.07 was shown as 0.36', () => {
    expect(line.setupCost + line.runCost).toBeCloseTo(line.totalCost, 5);
    expect(line.machineCostPerPart! + line.laborCostPerPart!).toBeCloseTo(line.runCost, 5);
    expect(r.totalProcessCost).toBeCloseTo(r.processLines.reduce((s, l) => s + l.totalCost, 0), 5);
    expect(r.totalCost).toBeCloseTo(r.materialCost + r.totalProcessCost, 5);
  });

  it('the line\'s cycle is the machine\'s cycle per good part to 0.01 s, not a multiple of 0.6 s', () => {
    expect(line.cycleTimeMin * 60).toBeCloseTo(r.injectionMolding!.cycleTimeSec / YIELD, 1);
    expect(Math.abs(line.cycleTimeMin * 60 - Math.round(line.cycleTimeMin * 100) * 0.6)).toBeGreaterThan(0.01);
  });

  it('the material is the shot over the yield, to the millionth', () => {
    expect(r.materialCost).toBeCloseTo((r.grossWeightKg * 11.486) / YIELD, 5);
  });

  it('a cheap high-volume part is no longer off by the rounding: the line is within a millionth of the sum of its exact parts', () => {
    expect(Math.abs(line.totalCost - (exactMachine + exactLabor + exactSetup))).toBeLessThan(1e-5);
  });
});

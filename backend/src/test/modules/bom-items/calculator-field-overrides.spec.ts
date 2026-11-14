import { plasticMoldingCalculatorsByName } from '../../../modules/bom-items/costing/plastic-molding/calculators/plastic-molding-calculator-spec';
import { computeInjectionMoldedCostSummary, type InjectionMoldingCostInput } from '../../../modules/bom-items/costing/plastic-molding/process/cost-injection-molding-engine';
import { overridesByCalculator } from '../../../modules/bom-items/services/calculator-field-overrides.service';
import { realMaterialClamp, realPlasticReference, realPress, realResinInputs } from './costing/plastic-molding/real-plastic-reference';

// A part's own calculator field values (migration 1011): the stored rows, as the engines read them, and their effect on a molding line.
describe('overridesByCalculator', () => {
  it('groups the rows by calculator and field, numeric, and drops a value that is not a positive number', () => {
    expect(overridesByCalculator([
      { calculator_name: 'Injection Molding - Cycle Time', field_name: 'Cooling Time', value: '2.5', reason: 'measured', set_by: 'u', set_at: 't' },
      { calculator_name: 'Injection Molding - Cycle Time', field_name: 'Press Dry Cycle Time', value: 2, reason: 'slow press', set_by: 'u', set_at: 't' },
      { calculator_name: 'Injection Molding - Cycle Time', field_name: 'Bad', value: '0', reason: 'x', set_by: 'u', set_at: 't' },
    ])).toEqual({ 'Injection Molding - Cycle Time': { 'Cooling Time': { value: 2.5, reason: 'measured' }, 'Press Dry Cycle Time': { value: 2, reason: 'slow press' } } });
  });
});

const PRESS = realPress('Arburg Allrounder 420 C 1300 - 350');
const rate = (machineClass: string, usd: number, name: string | null) => ({ rate: usd, labourRate: 34.48, operators: 1, source: 'mhr_database' as const, machineClass, machineName: name, commodityCode: null });
const part = (over: Partial<InjectionMoldingCostInput> = {}): InjectionMoldingCostInput => ({
  volume: 50_000, surfaceArea: 40_000, wallThicknessNominalMm: 2, materialGrade: 'ABS', materialCostPerKg: 3.046, materialDensityKgM3: 1040, materialSource: 'db',
  batchSize: 250, family: 'plastic_molded', mhrRate: { ...rate('injection_molding', PRESS.mhrUsd, 'Arburg Allrounder 420 C 1300 - 350'), setupTimeHr: 2 },
  deburrRate: rate('deburring', 0, null), inspectionRate: rate('cmm', 0, null), machineClampTonnes: PRESS.maxTonnage, machineShotCapacityG: PRESS.shotCapacityGrams,
  pressTiming: PRESS.timing, goodPartYield: PRESS.goodPartYield, calculators: plasticMoldingCalculatorsByName(), materialClamp: realMaterialClamp('ABS'),
  realResinInputs: realResinInputs('ABS'), materialType: 'ABS', plasticReference: realPlasticReference(), location: 'USA', signals: { projectedAreaMm2: 10_000, undercutCount: 0 },
  ...over,
});
const molding = (over: Partial<InjectionMoldingCostInput> = {}) => computeInjectionMoldedCostSummary(part(over)).processLines.find((l) => l.calculationSnapshot !== undefined)!;
const cycleSec = (l: ReturnType<typeof molding>) => l.calculationTrace!.find((t) => t.fieldName === 'Cycle Time')!.value as number;

describe('a molding line with a part\'s own cooling time', () => {
  it('uses it in the cycle, shows what the calculator gave, and keeps it in the saved calculation\'s inputs', () => {
    const base = molding();
    const cooling = base.calculationTrace!.find((t) => t.fieldName === 'Cooling Time')!.value as number;
    const overrides = { 'Injection Molding - Cycle Time': { 'Cooling Time': { value: cooling + 5, reason: 'measured on the tool' } } };
    const own = molding({ calculatorOverrides: overrides });
    expect(cycleSec(own)).toBeGreaterThan(cycleSec(base) + 4.9);
    expect(own.calculationTrace!.find((t) => t.fieldName === 'Cooling Time')).toMatchObject({ value: cooling + 5, override: { original: cooling, reason: 'measured on the tool' } });
    expect((own.calculationSnapshot as { inputs: Record<string, unknown> }).inputs.calculatorOverrides).toEqual(overrides);
  });
});

describe('a molding line names its calculator', () => {
  it('so the Cost panel can set a field of it for the part (overrides are keyed by the calculator name)', () => {
    expect(molding().calculatorName).toBe('Injection Molding - Cycle Time');
  });
});

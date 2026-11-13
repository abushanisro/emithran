import { Logger } from '@nestjs/common';

import { buildPlasticCalculatorReport } from '../../../../../modules/bom-items/costing/plastic-molding/calculators/plastic-calculator-report';
import {
  PLASTIC_CALCULATOR_MIGRATIONS, requirePlasticCalculator, runCompressionCycleTime, runInjectionCycleTime, runRimCycleTime,
} from '../../../../../modules/bom-items/costing/plastic-molding/calculators/plastic-cycle-time';
import { plasticMoldingCalculatorsByName } from '../../../../../modules/bom-items/costing/plastic-molding/calculators/plastic-molding-calculator-spec';
import { computeCompressionMoldingCost } from '../../../../../modules/bom-items/costing/plastic-molding/process/cost-compression-molding-engine';
import { computeInjectionMoldedCostSummary, type InjectionMoldingCostInput } from '../../../../../modules/bom-items/costing/plastic-molding/process/cost-injection-molding-engine';
import { computeReactionInjectionMoldingCost } from '../../../../../modules/bom-items/costing/plastic-molding/process/cost-reaction-injection-molding-engine';
import { CalculatorCatalogService } from '../../../../../modules/bom-items/services/calculator-catalog.service';
import type { DomainCalculatorSpec } from '../../../../../modules/bom-items/costing/shared/calculators/domain-calculator-spec';
import type { MHRRateInput } from '../../../../../modules/bom-items/costing/shared/core/cost-engine';
import { realMaterialClamp, realPlasticReference, realPress, realResinInputs } from './real-plastic-reference';

const CALCULATORS = plasticMoldingCalculatorsByName();
const INJECTION = 'Injection Molding - Cycle Time';
const RIM = 'Reaction Injection Molding - Cycle Time';

describe('the written report escapes a table cell completely (CodeQL js/incomplete-sanitization)', () => {
  const spec: DomainCalculatorSpec = {
    domain: 'plastic_molding', processGroup: 'Plastic Molding',
    calculators: [{
      key: 'injection', name: 'Injection Molding - Cycle Time', description: 'd', operations: ['Injection Molding'],
      fields: [{ name: 'Wall', unit: 'mm', source: { cad: 'a|b\\c' } }, { name: 'Cycle Time', unit: 's', formula: '{Wall} + 1' }],
    }, {
      // the report shows the LSR variant after the injection calculator
      key: 'injection_lsr', name: 'Injection Molding - LSR Cycle Time', description: 'd', operations: [], helper: true,
      fields: [{ name: 'Wall', unit: 'mm', source: { cad: 'w' } }, { name: 'Cycle Time', unit: 's', formula: '{Wall} + 2' }],
    }],
  };
  const report = (operation: string) => buildPlasticCalculatorReport({ spec, catalog: { 'Injection Molding': [`Injection Molding:${operation}//SimpleHole`] }, fillFactorRows: [] });

  it('escapes a pipe, so it cannot split the cell', () => {
    expect(report('As Molded|Extra')).toContain('As Molded\\|Extra');
  });

  it('escapes a backslash, so it cannot cancel the escape of a pipe after it', () => {
    // a backslash then a pipe: the backslash is doubled and the pipe escaped, three backslashes before the pipe in all
    expect(report('a\\|b')).toContain('a\\\\\\|b');
    // a backslash alone is doubled
    expect(report('x\\y')).toContain('x\\\\y');
  });

  it('applies to the source text of an input too', () => {
    expect(report('As Molded')).toContain('CAD: a\\|b\\\\c');
  });
});

describe('a stored calculator must be in the database and be the version the engine was written for', () => {
  it('names the migrations to apply when it is absent, never "an engineering task"', () => {
    for (const calculators of [null, undefined, {}]) {
      const r = requirePlasticCalculator(calculators, INJECTION);
      expect('problem' in r && r.problem).toContain(`migrations ${PLASTIC_CALCULATOR_MIGRATIONS}`);
      expect('problem' in r && r.problem).toContain('npm run db:migrate');
      expect('problem' in r && r.problem).toContain('is not in this database');
    }
  });

  it('refuses a calculator older than the engine expects: the reaction injection one at version 1 has no fill time', () => {
    const old = { ...CALCULATORS, [RIM]: { ...CALCULATORS[RIM]!, version: 1 } };
    const r = requirePlasticCalculator(old, RIM);
    expect('problem' in r && r.problem).toContain('is version 1, and this engine needs version 2');
    // a current one is accepted, and so is every other calculator at version 1
    expect('def' in requirePlasticCalculator(CALCULATORS, RIM)).toBe(true);
    expect('def' in requirePlasticCalculator(CALCULATORS, INJECTION)).toBe(true);
  });

  it('every runner says it was the calculator that was missing, with the same text, and gives no cycle', () => {
    const inj = runInjectionCycleTime({ wallMm: 2, isLsr: false, real: realResinInputs('ABS'), model: realPlasticReference().cycleModel, press: realPress('Arburg Allrounder 420 C 1300 - 350').timing, shotMeltVolumeMm3: 50_000, cavityCount: 1, gatesPerCavity: 1 }, {}, 'injection');
    const cm = runCompressionCycleTime({ pressCycleTimeS: 20, cureTimeMin: 3 }, {});
    const rim = runRimCycleTime({ machineCycleTimeS: 10, partVolumeMm3: 50_000, injectionRateMm3PerS: 100_000, cureTimeMin: 3 }, {});
    for (const r of [inj, cm, rim]) {
      expect(r.derivable).toBe(false);
      expect(!r.derivable && r.calculatorProblem).toContain(`migrations ${PLASTIC_CALCULATOR_MIGRATIONS}`);
    }
  });

  it('a missing INPUT is still reported as an input, not as a calculator problem', () => {
    const r = runInjectionCycleTime({ wallMm: null, isLsr: false, real: realResinInputs('ABS'), model: realPlasticReference().cycleModel, press: realPress('Arburg Allrounder 420 C 1300 - 350').timing, shotMeltVolumeMm3: 50_000, cavityCount: 1, gatesPerCavity: 1 }, CALCULATORS, 'injection');
    expect(r.derivable).toBe(false);
    expect(!r.derivable && r.calculatorProblem).toBeUndefined();
    expect(!r.derivable && r.missing.join(' ')).toContain('nominal wall thickness');
  });
});

describe('what the cost line tells the engineer', () => {
  const PRESS = realPress('Arburg Allrounder 420 C 1300 - 350');
  const rate = (machineClass: string, usd: number, name: string | null) => ({ rate: usd, labourRate: 34.48, operators: 0.5, source: 'mhr_database' as const, machineClass, machineName: name, commodityCode: null });
  const part = (over: Partial<InjectionMoldingCostInput> = {}): InjectionMoldingCostInput => ({
    volume: 50_000, surfaceArea: 40_000, wallThicknessNominalMm: 2, materialGrade: 'ABS', materialCostPerKg: 3.046, materialDensityKgM3: 1040, materialSource: 'db',
    batchSize: 250, family: 'plastic_molded', mhrRate: { ...rate('injection_molding', PRESS.mhrUsd, 'Arburg Allrounder 420 C 1300 - 350'), setupTimeHr: 2 },
    deburrRate: rate('deburring', 0, null), inspectionRate: rate('cmm', 0, null), machineClampTonnes: PRESS.maxTonnage, machineShotCapacityG: PRESS.shotCapacityGrams,
    pressTiming: PRESS.timing, goodPartYield: PRESS.goodPartYield, calculators: CALCULATORS, materialClamp: realMaterialClamp('ABS'), realResinInputs: realResinInputs('ABS'), materialType: 'ABS',
    plasticReference: realPlasticReference(), location: 'USA', annualVolume: 100_000, productionLifeYears: 3, signals: { projectedAreaMm2: 10_000, undercutCount: 0 },
    ...over,
  });
  const line = (r: ReturnType<typeof computeInjectionMoldedCostSummary>) => r.processLines.find((l) => l.physicsGap)!;

  it('a database without the calculators: the gap says to apply the migrations, with the reason, and is not an engineering task', () => {
    const gap = line(computeInjectionMoldedCostSummary(part({ calculators: {} }))).physicsGap!;
    expect(gap.gapType).toBe('unsupported_operation');
    if (gap.gapType !== 'unsupported_operation') return;
    expect(gap.reason).toContain('is not in this database');
    expect(gap.requiredAction).toContain('Apply migrations 975 and 976');
    expect(gap.requiredAction).toContain('npm run db:migrate');
  });

  it('a gap that is not the calculator carries no migration instruction', () => {
    const gap = line(computeInjectionMoldedCostSummary(part({ wallThicknessNominalMm: 0 }))).physicsGap!;
    expect(gap.gapType === 'unsupported_operation' && gap.requiredAction).toBeUndefined();
    expect(gap.gapType === 'unsupported_operation' && gap.reason).toContain('nominal wall thickness');
  });

  it('compression and reaction injection say it too, and do not blame the machine for a missing calculator', () => {
    const rateOf = ({ rate: 60, source: 'mhr_database', machineClass: 'x', machineName: 'M', commodityCode: null, pressCycleTimeS: 20, setupTimeHr: 0.5 }) as unknown as MHRRateInput;
    const base = { batchSize: 100, partWeightKg: 0.2, rate: rateOf, cureTimeMinFromMaterial: 3, calculators: {} };
    const cm = computeCompressionMoldingCost(base);
    const rim = computeReactionInjectionMoldingCost({ ...base, partVolumeMm3: 50_000, injectionRateMm3PerS: 100_000 });
    for (const r of [cm, rim]) {
      expect(r.warnings.join(' ')).toContain(`migrations ${PLASTIC_CALCULATOR_MIGRATIONS}`);
      expect(r.warnings.join(' ')).not.toContain('no real press_cycle_time_s on file');
    }
  });
});

describe('the loader says once when the calculators are not in the database', () => {
  function service(calculators: Array<{ id: string; name: string; version: number }>) {
    const chain: any = {
      select: () => chain, in: () => chain, is: () => chain, order: () => chain,
      then: (resolve: (v: unknown) => unknown) => resolve({ data: calculators, error: null }),
    };
    const client = { from: (table: string) => (table === 'calculators' ? chain : { ...chain, then: (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null }) }) };
    return new CalculatorCatalogService({ getClient: () => client } as never);
  }

  it('logs which calculators are missing and what to do, one time however often it is asked', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const svc = service([]);
    expect(await svc.loadPlasticMoldingCalculators('t')).toEqual({});
    await svc.loadPlasticMoldingCalculators('t');
    await svc.loadPlasticMoldingCalculators('t');
    const said = warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('Plastic molding calculators missing'));
    expect(said).toHaveLength(1);
    expect(said[0]).toContain(INJECTION);
    expect(said[0]).toContain('npm run db:migrate');
    warn.mockRestore();
  });
});

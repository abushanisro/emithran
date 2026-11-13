import { readFileSync } from 'fs';
import { join } from 'path';

import { MOLD_TOOLING_CALCULATOR, runMoldTooling, type MoldToolingFacts } from '../../../../../modules/bom-items/costing/plastic-molding/calculators/mold-tooling-calculator';
import { loadPlasticMoldingCalculatorSpec, plasticMoldingCalculatorsByName } from '../../../../../modules/bom-items/costing/plastic-molding/calculators/plastic-molding-calculator-spec';
import { buildPlasticMoldingCalculatorsMigrationSql } from '../../../../../modules/bom-items/costing/plastic-molding/calculators/plastic-molding-calculators-migration';
import { withFieldOverrides } from '../../../../../modules/bom-items/costing/shared/calculators/reference-calculator';
import { realPlasticReference } from './real-plastic-reference';

// The mold tooling cost by its stored calculator (migration 1012): the staged lookups in, every price, hour and amortization step a formula.
const REF = realPlasticReference();
const CALCS = plasticMoldingCalculatorsByName();
// The worked ABS mold (plastic-molding-accuracy.spec): BOM 2,140; design 3.24 h; assembly 23.18 h; window 10,000 mm2; one cavity; ABS 144,000 shots.
const facts = (over: Partial<MoldToolingFacts> = {}): MoldToolingFacts => ({
  components: [{ componentName: 'Guide Pin', qty: 4, unitCostUsd: 100 }], componentsSubtotalUsd: 2140, moldBaseAreaMm2: 10_000,
  designHours: 3.24, assemblyHours: 23.18, tables: REF.tooling, toolroomRates: REF.toolroomRatesUsa, location: 'USA',
  annualVolume: 10_000, productionLifeYears: 3, cavityCount: 1, toolLifeShots: 144_000, toolLifeSource: 'tblToolLife: ABS', ...over,
});

describe('the mold tooling calculator', () => {
  it('is a helper whose result is the tooling cost per part, written by migration 1012', () => {
    const c = loadPlasticMoldingCalculatorSpec().calculators.find((x) => x.name === MOLD_TOOLING_CALCULATOR)!;
    expect(c).toMatchObject({ helper: true, operations: [], migration: 1012, output: 'Tooling Cost Per Part' });
    expect(c.description).toMatch(/G-01 to G-08/);
    expect(readFileSync(join(__dirname, '../../../../../../migrations/1012_plastic_mold_tooling_calculator.sql'), 'utf8')).toBe(buildPlasticMoldingCalculatorsMigrationSql(1012));
  });

  it('gives the worked ABS mold to the cent: labour 2,398.67, mold 4,538.67, one mold, 0.1513 per part', () => {
    const r = runMoldTooling(facts(), CALCS);
    if (!r.derivable) throw new Error(r.missing.join());
    expect(r.outputs['Machining Hours']).toBeCloseTo(4.0625, 6);
    expect(Math.round(r.outputs['Toolroom Labour Cost']! * 100) / 100).toBe(2398.67);
    expect(r.outputs['Molds Required']).toBe(1);
    expect(r.outputs['Tooling Investment']).toBe(4538.67);
    expect(r.perPartUsd).toBe(0.1513);
    expect(r.trace.find((t) => t.fieldName === 'Purchased Components Cost')?.source).toMatch(/cmStandardToolingComponents: Guide Pin 4 x 100/);
    expect(r.trace.find((t) => t.fieldName === 'Design Rate')?.source).toMatch(/designRateUsdPerHr/);
  });

  it('wears out ceil(lifetime shots / tool life) molds', () => {
    const r = runMoldTooling(facts({ annualVolume: 1_000_000 }), CALCS);
    if (!r.derivable) throw new Error(r.missing.join());
    expect(r.outputs['Molds Required']).toBe(21);
  });

  it('a location without toolroom rates is a named gap, never components only', () => {
    const r = runMoldTooling(facts({ toolroomRates: null, location: 'India' }), CALCS);
    expect(r.derivable).toBe(false);
    if (!r.derivable) expect(r.missing.join(' ')).toMatch(/toolroom rates for India/);
  });

  it('a part\'s own design hours change the cost, and the trace says what the reference gave', () => {
    const own = withFieldOverrides(CALCS, { [MOLD_TOOLING_CALCULATOR]: { 'Design Hours': { value: 10, reason: 'complex parting' } } });
    const r = runMoldTooling(facts(), own);
    if (!r.derivable) throw new Error(r.missing.join());
    expect(r.trace.find((t) => t.fieldName === 'Design Hours')).toMatchObject({ value: 10, override: { original: 3.24, reason: 'complex parting' } });
    expect(r.outputs['Tooling Investment']).toBeCloseTo(4538.67 + (10 - 3.24) * 64.73, 1);
  });
});

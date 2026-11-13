import { readFileSync } from 'fs';
import { join } from 'path';

import { MOLD_TOOLING_CALCULATOR, runMoldTooling, type MoldToolingFacts } from '../../../../../modules/bom-items/costing/plastic-molding/calculators/mold-tooling-calculator';
import { loadPlasticMoldingCalculatorSpec, plasticMoldingCalculatorsByName } from '../../../../../modules/bom-items/costing/plastic-molding/calculators/plastic-molding-calculator-spec';
import { buildPlasticMoldingCalculatorsMigrationSql } from '../../../../../modules/bom-items/costing/plastic-molding/calculators/plastic-molding-calculators-migration';
import { withFieldOverrides } from '../../../../../modules/bom-items/costing/shared/calculators/reference-calculator';
import { selectMoldBase } from '../../../../../modules/bom-items/costing/plastic-molding/process/mold-base';
import { realPlasticReference } from './real-plastic-reference';

// The mold tooling cost by its stored calculator (migration 1012): the staged lookups in, every price, hour and amortization step a formula.
const REF = realPlasticReference();
const CALCS = plasticMoldingCalculatorsByName();
// The worked ABS mold (plastic-molding-accuracy.spec): BOM 2,140; design 3.24 h; assembly 23.18 h; window 10,000 mm2; one cavity; ABS 144,000 shots;
// a 100 x 100 x 30 mm part on a 1,000 kN press.
const BASE = selectMoldBase({ partLengthMm: 100, partWidthMm: 100, cavities: 1, clampKn: 1000, ref: REF.moldBase });
const facts = (over: Partial<MoldToolingFacts> = {}): MoldToolingFacts => ({
  components: [{ componentName: 'Guide Pin', qty: 4, unitCostUsd: 100 }], componentsSubtotalUsd: 2140, moldBaseAreaMm2: 10_000,
  designHours: 3.24, assemblyHours: 23.18, tables: REF.tooling, toolroomRates: REF.toolroomRatesUsa, location: 'USA',
  annualVolume: 10_000, productionLifeYears: 3, cavityCount: 1, toolLifeShots: 144_000, toolLifeSource: 'tblToolLife: ABS',
  moldBase: BASE, moldBaseRef: REF.moldBase, partHeightMm: 30, ...over,
});
/** The plate steel by the formula, from the chosen base and the reference: what the calculator must give. */
function expectedSteelUsd(): number {
  if ('missing' in BASE) throw new Error(BASE.missing.join());
  const mb = REF.moldBase;
  const a = Math.max(mb.aPlateMinMm, mb.aPlateCavityRatio * 30 + BASE.cavityDepthBorderMm);
  const b = Math.max(mb.bPlateMinMm, (1 - mb.aPlateCavityRatio) * 30 + BASE.coreDepthBorderMm);
  const stack = mb.topClampMm + a + b + mb.supportPlateMm + mb.bottomClampMm;
  return BASE.base.widthMm * BASE.base.lengthMm * stack / 1e9 * mb.steel.densityKgM3 * mb.steel.priceUsdPerKg * mb.steel.moldBaseCostFactor;
}

describe('the mold tooling calculator', () => {
  it('is a helper whose result is the tooling cost per part, at version 2 written by migration 1013 (1012 is history)', () => {
    const c = loadPlasticMoldingCalculatorSpec().calculators.find((x) => x.name === MOLD_TOOLING_CALCULATOR)!;
    expect(c).toMatchObject({ helper: true, operations: [], migration: 1013, version: 2, output: 'Tooling Cost Per Part' });
    expect(c.description).toMatch(/G-02 to G-08/);
    expect(readFileSync(join(__dirname, '../../../../../../migrations/1013_plastic_mold_base_steel.sql'), 'utf8')).toBe(buildPlasticMoldingCalculatorsMigrationSql(1013));
    expect(readFileSync(join(__dirname, '../../../../../../migrations/1012_plastic_mold_tooling_calculator.sql'), 'utf8')).toContain(MOLD_TOOLING_CALCULATOR);
  });

  it('gives the worked ABS mold: labour 2,398.67 as before, plus the plate steel of its standard base, one mold', () => {
    const r = runMoldTooling(facts(), CALCS);
    if (!r.derivable) throw new Error(r.missing.join());
    expect(r.outputs['Machining Hours']).toBeCloseTo(4.0625, 6);
    expect(Math.round(r.outputs['Toolroom Labour Cost']! * 100) / 100).toBe(2398.67);
    expect(r.outputs['Mold Base Steel Cost']).toBeCloseTo(expectedSteelUsd(), 6);
    expect(r.outputs['Mold Base Steel Cost']).toBeGreaterThan(0);
    expect(r.outputs['Molds Required']).toBe(1);
    expect(r.outputs['Tooling Investment']).toBe(Math.floor((2140 + r.outputs['Toolroom Labour Cost']! + expectedSteelUsd()) * 100 + 0.5) / 100);
    expect(r.perPartUsd).toBe(Math.floor(r.outputs['Tooling Investment']! / 30_000 * 10000 + 0.5) / 10000);
    expect(r.trace.find((t) => t.fieldName === 'Mold Base Width')?.source).toMatch(/tblStandardMoldBaseSizes: .*layoutNumCav/);
    expect(r.trace.find((t) => t.fieldName === 'Tool Steel Price')?.source).toMatch(/AISI P20/);
    expect(r.trace.find((t) => t.fieldName === 'Purchased Components Cost')?.source).toMatch(/cmStandardToolingComponents: Guide Pin 4 x 100/);
    expect(r.trace.find((t) => t.fieldName === 'Design Rate')?.source).toMatch(/designRateUsdPerHr/);
  });

  it('wears out ceil(lifetime shots / tool life) molds', () => {
    const r = runMoldTooling(facts({ annualVolume: 1_000_000 }), CALCS);
    if (!r.derivable) throw new Error(r.missing.join());
    expect(r.outputs['Molds Required']).toBe(21);
  });

  it('a part no standard base holds is a named gap, never a guessed base', () => {
    const big = selectMoldBase({ partLengthMm: 5000, partWidthMm: 3000, cavities: 1, clampKn: 1000, ref: REF.moldBase });
    const r = runMoldTooling(facts({ moldBase: big }), CALCS);
    expect(r.derivable).toBe(false);
    if (!r.derivable) expect(r.missing.join(' ')).toMatch(/mold base: no standard mold base/);
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
    const base = runMoldTooling(facts(), CALCS);
    if (!base.derivable) throw new Error(base.missing.join());
    expect(r.outputs['Tooling Investment']).toBeCloseTo(base.outputs['Tooling Investment']! + (10 - 3.24) * 64.73, 1);
  });
});

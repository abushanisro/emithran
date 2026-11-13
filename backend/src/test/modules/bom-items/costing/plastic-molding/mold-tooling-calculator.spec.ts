import { readFileSync } from 'fs';
import { join } from 'path';

import { MOLD_TOOLING_CALCULATOR, runMoldTooling, type MoldToolingFacts } from '../../../../../modules/bom-items/costing/plastic-molding/calculators/mold-tooling-calculator';
import { loadPlasticMoldingCalculatorSpec, plasticMoldingCalculatorsByName } from '../../../../../modules/bom-items/costing/plastic-molding/calculators/plastic-molding-calculator-spec';
import { buildPlasticMoldingCalculatorsMigrationSql } from '../../../../../modules/bom-items/costing/plastic-molding/calculators/plastic-molding-calculators-migration';
import { withFieldOverrides } from '../../../../../modules/bom-items/costing/shared/calculators/reference-calculator';
import { selectMoldBase } from '../../../../../modules/bom-items/costing/plastic-molding/process/mold-base';
import { moldCavityLookup } from '../../../../../modules/bom-items/costing/plastic-molding/process/mold-cavity';
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
  moldBase: BASE, moldBaseRef: REF.moldBase, partHeightMm: 30,
  cavity: moldCavityLookup({ faceCount: 900, surfaceAreaMm2: 40_000, ref: REF.moldBase }), partSurfaceAreaMm2: 40_000,
  extras: REF.moldExtras, pressClampTonnes: 102, sideActionBlocks: null, ...over,
});
const NONE = { small: 0, medium: 0, large: 0 };
/** The mold assembly extras of the worked mold (F-27): 2 ejector pins (10,000 / 7,903.21 mm2), the sprue and ring, 3 try-outs of 12 h on a 102 t press. */
const EXTRAS_USD = 2 * (5 + 0.25 * 76.81) + (70 + 85) + 12 * 1 * 3 * 76.81;
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
  it('is a helper whose result is the tooling cost per part, at version 5 written by migration 1017 (1012 to 1016 are history)', () => {
    const c = loadPlasticMoldingCalculatorSpec().calculators.find((x) => x.name === MOLD_TOOLING_CALCULATOR)!;
    expect(c).toMatchObject({ helper: true, operations: [], migration: 1017, version: 5, output: 'Tooling Cost Per Part' });
    expect(c.description).toMatch(/G-03 to G-08/);
    expect(readFileSync(join(__dirname, '../../../../../../migrations/1017_plastic_mold_slides_lifters.sql'), 'utf8')).toBe(buildPlasticMoldingCalculatorsMigrationSql(1017));
    expect(readFileSync(join(__dirname, '../../../../../../migrations/1016_plastic_mold_assembly_extras.sql'), 'utf8')).toContain('version 4');
    expect(readFileSync(join(__dirname, '../../../../../../migrations/1014_plastic_mold_cavity_machining_polish.sql'), 'utf8')).toContain('version 3');
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
    // cavity: 40,000 mm2 = 62.0 in2 x 0.18 h/in2 (average, 900 faces) = 11.16 h x 100.55; polish: 0.04 m2 x 600 h/m2 = 24 h x 76.81
    expect(r.outputs['Cavity Machining Cost']).toBeCloseTo((40_000 / 645.16) * 0.18 * 100.55, 6);
    expect(r.outputs['Polish Cost']).toBeCloseTo(0.04 * 600 * 76.81, 6);
    expect(r.outputs['Ejector Pins']).toBe(2);
    expect(r.outputs['Ejector System Cost']).toBeCloseTo(2 * (5 + 0.25 * 76.81), 6);
    expect(r.outputs['Sprue and Locating Ring Cost']).toBe(155);
    expect(r.outputs['Tryout Hours']).toBe(36);
    expect(r.outputs['Tryout Cost']).toBeCloseTo(36 * 76.81, 6);
    expect(r.outputs['Tooling Investment']).toBe(Math.floor((2140 + r.outputs['Toolroom Labour Cost']! + expectedSteelUsd() + r.outputs['Cavity Machining Cost']! + r.outputs['Polish Cost']! + EXTRAS_USD) * 100 + 0.5) / 100);
    expect(r.trace.find((t) => t.fieldName === 'Ejector Pin Cost')?.source).toMatch(/cmStandardToolingComponents: Ejector Pin/);
    expect(r.trace.find((t) => t.fieldName === 'Tryout Press Multiplier')?.source).toMatch(/<500T \(x2 for bigger\)": the press is 102 t/);
    expect(r.trace.find((t) => t.fieldName === 'Tryout Rate')?.source).toMatch(/tryoutRateUsdPerHr/);
    expect(r.perPartUsd).toBe(Math.floor(r.outputs['Tooling Investment']! / 30_000 * 10000 + 0.5) / 10000);
    expect(r.trace.find((t) => t.fieldName === 'Mold Base Width')?.source).toMatch(/tblStandardMoldBaseSizes: .*layoutNumCav/);
    expect(r.trace.find((t) => t.fieldName === 'Tool Steel Price')?.source).toMatch(/AISI P20/);
    expect(r.trace.find((t) => t.fieldName === 'Purchased Components Cost')?.source).toMatch(/cmStandardToolingComponents: Guide Pin 4 x 100/);
    expect(r.trace.find((t) => t.fieldName === 'Design Rate')?.source).toMatch(/designRateUsdPerHr/);
  });

  it('prices the slide and lifter blocks the CAD engine sized: steel by volume, a cube of each machined at the cavity rate, CMM inspection', () => {
    // 2 small lifters (75 in3 each) + 1 medium slide (1,100 in3); the cavity rate is 0.18 h/in2 (average, 900 faces)
    const r = runMoldTooling(facts({ sideActionBlocks: { slide: { ...NONE, medium: 1 }, lifter: { ...NONE, small: 2 }, unsized: 0 } }), CALCS);
    if (!r.derivable) throw new Error(r.missing.join());
    const steel = REF.moldBase.steel;
    expect(r.outputs['Side Action Steel Mass']).toBeCloseTo(1250 * 16387.064 / 1e9 * steel.densityKgM3, 9);
    expect(r.outputs['Side Action Steel Cost']).toBeCloseTo(1250 * 16387.064 / 1e9 * steel.densityKgM3 * steel.priceUsdPerKg, 6);
    const surface = 2 * 6 * 75 ** (2 / 3) + 6 * 1100 ** (2 / 3);
    expect(r.outputs['Side Action Machining Hours']).toBeCloseTo(surface * 0.18, 6);
    expect(r.outputs['Side Action Machining Cost']).toBeCloseTo(surface * 0.18 * 100.55, 6);
    expect(r.outputs['Side Action CMM Hours']).toBeCloseTo(1.52 * 3 + 5, 9);
    expect(r.outputs['Side Action Cost']).toBeCloseTo(r.outputs['Side Action Steel Cost']! + surface * 0.18 * 100.55 + (1.52 * 3 + 5) * 100.55, 6);
    expect(r.trace.find((t) => t.fieldName === 'Lifter Block Volume')?.source).toMatch(/2 small x 75 in³ \(smallLifterVolume\)/);
    expect(r.trace.find((t) => t.fieldName === 'Slide Block Volume')?.source).toMatch(/1 medium x 1100 in³ \(mediumSlideVolume\)/);
    // and it is in the mold cost
    const without = runMoldTooling(facts(), CALCS);
    if (!without.derivable) throw new Error(without.missing.join());
    expect(r.outputs['Mold Cost']! - without.outputs['Mold Cost']!).toBeCloseTo(r.outputs['Side Action Cost']!, 6);
  });

  it('adds no side-action cost, and no CMM base hours, when no bundle was recognised', () => {
    const r = runMoldTooling(facts({ sideActionBlocks: { slide: NONE, lifter: NONE, unsized: 0 } }), CALCS);
    if (!r.derivable) throw new Error(r.missing.join());
    expect(r.outputs['Side Action CMM Hours']).toBe(0);
    expect(r.outputs['Side Action Cost']).toBe(0);
  });

  it('doubles the try-out hours on a press over 500 t, and needs a press to know them', () => {
    const big = runMoldTooling(facts({ pressClampTonnes: 650 }), CALCS);
    if (!big.derivable) throw new Error(big.missing.join());
    expect(big.outputs['Tryout Hours']).toBe(72);
    const none = runMoldTooling(facts({ pressClampTonnes: null }), CALCS);
    expect(none.derivable).toBe(false);
    if (!none.derivable) expect(none.missing.join(' ')).toMatch(/the press force \(the try-out hours depend on it\)/);
  });

  it('counts one ejector pin per areaCoveredPerEjectorPin of the mold window, rounded up', () => {
    const r = runMoldTooling(facts({ moldBaseAreaMm2: 40_000 }), CALCS);
    if (!r.derivable) throw new Error(r.missing.join());
    expect(r.outputs['Ejector Pins']).toBe(Math.ceil(40_000 / 7903.21));
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

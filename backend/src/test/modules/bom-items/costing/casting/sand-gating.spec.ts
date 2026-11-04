import {
  designGating,
  pouringCoefficient,
  selectGatingRatio,
  solidificationShrinkage,
  type GatingInput,
} from '../../../../../modules/bom-items/costing/casting/sand/sand-gating';
import { resolveSandReference } from '../../../../../modules/bom-items/costing/casting/sand/sand-reference';
import { loadSandCastingCalculatorSpec, sandCastingCalculatorsByName } from '../../../../../modules/bom-items/costing/casting/sand/calculators/sand-casting-calculator-spec';
import { realSandReference, sandMaterials, stagedLookups, stagedVariables } from './sand-test-data';

const ref = realSandReference();
const spec = loadSandCastingCalculatorSpec();
const calculators = sandCastingCalculatorsByName();

describe('selectGatingRatio (the plant\'s multipliers name a tblGatingRatios row)', () => {
  it('the staged multipliers 1:2:2 select the non-pressurized row with its efficiency', () => {
    const { ratio, missing } = selectGatingRatio(ref);
    expect(missing).toEqual([]);
    expect(ratio).toMatchObject({ sprue: 1, runner: 2, ingate: 2, description: '1:2:2', systemType: 'Non-pressurized', efficiency: 0.9 });
  });

  it('a ratio the table has no row for is named, and so is a missing variable or table', () => {
    const variables = stagedVariables.map((v) => (v.key === 'ingateMultiplier' ? { ...v, value: '7' } : v));
    expect(selectGatingRatio(resolveSandReference({ variables, lookups: stagedLookups })).missing).toEqual(['tblGatingRatios has no row for the plant\'s ratio 1:2:7']);
    expect(selectGatingRatio(resolveSandReference({ variables: stagedVariables.filter((v) => v.key !== 'sprueMultiplier'), lookups: stagedLookups })).missing).toEqual(['sand variable sprueMultiplier']);
    expect(selectGatingRatio(resolveSandReference({ variables: stagedVariables, lookups: [] })).missing).toEqual([expect.stringContaining('tblGatingRatios')]);
  });
});

describe('solidificationShrinkage (the material family is the whole part of its cut code)', () => {
  const materials = sandMaterials();
  const byName = (n: string) => materials.find((m) => m['Name'] === n)!;

  it('reads the real percentages: gray iron 1.8, ductile iron 5.5, aluminum 6.6, bronze 4.5', () => {
    expect(solidificationShrinkage(ref, Number(byName('ASTM Grade 20 Gray Iron')['Cut Code']))?.pct).toBe(1.8);
    expect(solidificationShrinkage(ref, Number(materials.find((m) => m['Material Type'] === 'Ductile Iron')!['Cut Code']))?.pct).toBe(5.5);
    expect(solidificationShrinkage(ref, Number(byName('Aluminum Bronze')['Cut Code']))?.pct).toBe(4.5);
    expect(solidificationShrinkage(ref, 30.11)?.pct).toBe(6.6);
  });

  it('every sand material with a cut code has a family in the table; the ones without a cut code are the ones that do not', () => {
    const [withCode, without] = [materials.filter((m) => Number(m['Cut Code']) > 0), materials.filter((m) => !(Number(m['Cut Code']) > 0))];
    expect(withCode.filter((m) => solidificationShrinkage(ref, Number(m['Cut Code'])) === null).map((m) => m['Name'])).toEqual([]);
    expect(without.every((m) => solidificationShrinkage(ref, Number(m['Cut Code'])) === null)).toBe(true);
    expect(without.length).toBeLessThan(5);
  });

  it('says where the value came from, and is null without a cut code', () => {
    expect(solidificationShrinkage(ref, 8.1)?.source).toMatch(/material family 8 \(cut code 8\.1\)/);
    expect(solidificationShrinkage(ref, null)).toBeNull();
  });
});

describe('pouringCoefficient (by the section in inches or the pounds poured, per the material\'s rows)', () => {
  it('aluminum is read by section: 0.1 in 0.68, 0.3 in 0.80, 0.5 in 1.43', () => {
    expect(pouringCoefficient(ref, 'Aluminum', 20, 0.1)).toMatchObject({ value: 0.68 });
    expect(pouringCoefficient(ref, 'Aluminum', 20, 0.3)).toMatchObject({ value: 0.8 });
    expect(pouringCoefficient(ref, 'Aluminum', 20, 0.5)).toMatchObject({ value: 1.43, source: expect.stringContaining('0.50 in section') });
  });
  it('gray iron and steel are read by the pounds poured, whatever the section', () => {
    expect(pouringCoefficient(ref, 'Gray Iron', 18, null)).toMatchObject({ value: 0.5, source: expect.stringContaining('18.0 lb') });
    expect(pouringCoefficient(ref, 'Gray Iron', 1500, null)).toMatchObject({ value: 0.33 });
    expect(pouringCoefficient(ref, 'Steel', 99.9, null)).toMatchObject({ value: 1.2 });
    expect(pouringCoefficient(ref, 'Steel', 100, null)).toMatchObject({ value: 0.4 });
  });
  it('names what is missing: no section for a section-based material, a material with no rows, no material type', () => {
    expect(pouringCoefficient(ref, 'Aluminum', 20, null)).toEqual({ missing: expect.stringContaining('section thickness is not measured') });
    expect(pouringCoefficient(ref, 'Brass', 20, 0.3)).toEqual({ missing: 'tblPouringCoefficients has no rows for Brass' });
    expect(pouringCoefficient(ref, null, 20, 0.3)).toEqual({ missing: expect.stringContaining('no Material Type') });
  });
});

describe('designGating on a gray iron casting (real sand data, the calculators of the spec)', () => {
  const grayIron = sandMaterials().find((m) => m['Name'] === 'ASTM Grade 20 Gray Iron')!;
  const input: GatingInput = {
    netKg: 8, volumeMm3: 8 / 7100 * 1e9, modulusMm: 10, densityKgM3: Number(grayIron['Density (kg / m^3)']),
    materialName: 'ASTM Grade 20 Gray Iron', materialType: 'Gray Iron', cutCode: Number(grayIron['Cut Code']), wallNominalMm: 12,
    mould: {
      cavities: 1, ingates: 2,
      partLengthMm: { value: 300, source: 'longest side across the draw direction' },
      copeHeightMm: { value: 250, source: 'flask height' },
      abovePartingMm: { value: 100, source: 'measured above the parting plane' },
    },
    ref, spec, calculators,
  };
  const { system, missing } = designGating(input);

  it('designs a system', () => {
    expect(missing).toEqual([]);
    expect(system).not.toBeNull();
  });

  it('the effective head is the cope less half the casting above the parting plane: 250 - 100 / 2 = 200 mm', () => {
    expect(system!.effectiveHeadMm).toBe(200);
  });

  it('pours in the time the coefficient gives, and the choke area is what that time and head let through (Bernoulli)', () => {
    const s = system!;
    const pounds = (8 + s.risersKg + s.gatingKg) / 0.45359237; // one cavity: the metal per mould is the casting + its risers + its gating
    expect(s.pourTimeS).toBeCloseTo(0.5 * Math.sqrt(pounds), 9); // gray iron below 1000 lb: coefficient 0.50
    const poured = 8 + s.risersKg + s.gatingKg;
    const expectedChoke = (poured / (7100 * s.pourTimeS * 0.9 * Math.sqrt((2 * 9.81 * 200) / 1000))) * 1e6; // efficiency 0.90 (1:2:2)
    expect(s.chokeAreaMm2).toBeCloseTo(expectedChoke, 6);
  });

  it('the areas follow the 1:2:2 ratio: the ingates together are twice the choke area, and one ingate is half of that', () => {
    const s = system!;
    expect(s.ingateAreaMm2).toBeCloseTo(2 * s.chokeAreaMm2, 6);
    expect(s.ingateHeightMm * s.ingateWidthMm).toBeCloseTo(s.ingateAreaMm2 / 2, 6);
  });

  // At the choke the metal moves at the efficiency times sqrt(2 g H) (Bernoulli, by construction of the choke area): 0.90 x sqrt(2 x 9.81 x 0.200) = 1.7828 m/s.
  // The 1:2:2 ratio makes the runner and the ingates twice the choke area (one cavity), so the metal is half as fast there: 0.8914 m/s.
  it('the metal moves at 0.90 sqrt(2 g H) = 1.7828 m/s at the choke and half that through the 1:2:2 runner and ingates', () => {
    const s = system!;
    expect(s.chokeVelocityMs).toBeCloseTo(0.9 * Math.sqrt(2 * 9.81 * 0.2), 9);
    expect(s.chokeVelocityMs).toBeCloseTo(1.7828, 4);
    expect(s.ingateVelocityMs).toBeCloseTo(s.chokeVelocityMs / 2, 9);
    expect(s.runs.gating.outputs['Runner Velocity']).toBeCloseTo(s.chokeVelocityMs / 2, 9);
  });

  it('the velocity is the flow over the area: the mould\'s metal over its pouring time, through the ingates together', () => {
    const s = system!;
    const poured = 8 + s.risersKg + s.gatingKg;
    const flow = poured / (7100 * s.pourTimeS); // m3/s
    expect(s.runs.gating.outputs['Flow Rate']).toBeCloseTo(flow, 12);
    expect(s.ingateVelocityMs).toBeCloseTo(flow / (s.ingateAreaMm2 * 1e-6), 9);
  });

  it('two cavities share the flow: each casting has its own ingates, so the velocity through them follows the same ratio', () => {
    const two = designGating({ ...input, mould: { ...input.mould, cavities: 2 } }).system!;
    expect(two.ingateVelocityMs).toBeCloseTo(two.chokeVelocityMs / 2, 9);
  });

  it('the gating weight has settled: it is the weight of the system designed for the metal it itself adds', () => {
    const again = designGating({ ...input, netKg: 8 }); // the design is deterministic
    expect(again.system!.gatingKg).toBeCloseTo(system!.gatingKg, 12);
    expect(system!.gatingKg).toBeGreaterThan(0);
    expect(system!.risersKg).toBeGreaterThan(0);
    expect(system!.risers).toBe(2);
  });

  it('the riser contact is two circles of the riser diameter', () => {
    expect(system!.riserContactMm2).toBeCloseTo(2 * Math.PI / 4 * system!.riserDiameterMm ** 2, 9);
  });

  it('keeps both calculator runs for the trace, with where each input came from', () => {
    const sources = system!.runs.gating.trace.filter((t) => t.kind === 'input').map((t) => t.source);
    expect(sources).toEqual(expect.arrayContaining([expect.stringContaining('tblPouringCoefficients Gray Iron'), expect.stringContaining('tblGatingRatios 1:2:2'), expect.stringContaining('Sand casting variable sprueMultiplier')]));
    expect(system!.runs.risers.trace.some((t) => t.source?.includes('material family 8'))).toBe(true);
  });

  it('more cavities pour more metal per mould and take a bigger choke area', () => {
    const two = designGating({ ...input, mould: { ...input.mould, cavities: 2 } }).system!;
    expect(two.chokeAreaMm2).toBeGreaterThan(system!.chokeAreaMm2);
  });

  it('refuses instead of guessing: no cut code, a casting taller than its cope allows, an aluminum casting with no section', () => {
    expect(designGating({ ...input, cutCode: null })).toEqual({ system: null, missing: [expect.stringContaining('tblSolidificationShrinkage')] });
    expect(designGating({ ...input, mould: { ...input.mould, abovePartingMm: { value: 600, source: 'x' } } }).missing[0]).toMatch(/more than twice the cope/);
    const aluminum = sandMaterials().find((m) => m['Material Type'] === 'Aluminum')!;
    const noSection = designGating({ ...input, materialType: 'Aluminum', cutCode: Number(aluminum['Cut Code']), wallNominalMm: null });
    expect(noSection.system).toBeNull();
    expect(noSection.missing[0]).toMatch(/section thickness is not measured/);
  });

  it('names a calculator input nobody can supply', () => {
    const broken = designGating({ ...input, ref: resolveSandReference({ variables: stagedVariables.filter((v) => v.key !== 'runnerAspectRatio'), lookups: stagedLookups }) });
    expect(broken.system).toBeNull();
    expect(broken.missing.join(' ')).toMatch(/Runner Aspect Ratio \(variable: runnerAspectRatio\)/);
  });
});

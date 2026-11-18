import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { normalizeFieldName } from '../../../../../modules/calculators/calculator-formula-evaluator';
import { additiveCalculatorsByName, loadAdditiveCalculatorSpec } from '../../../../../modules/bom-items/costing/additive/calculators/additive-calculator-spec';
import { buildAdditiveCalculatorsMigrationSql } from '../../../../../modules/bom-items/costing/additive/calculators/additive-calculators-migration';
import { runReferenceCalculator, type CalcSeed } from '../../../../../modules/bom-items/costing/shared/calculators/reference-calculator';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { readCsv, specKey } = require('../../../../../../migrations/scripts/lib/memory-machine-seed.js');
const MIGRATIONS = join(__dirname, '../../../../../../migrations');
const DIR = join(__dirname, '../../../../../../../memory/Additive Manufacturing');
const all = loadAdditiveCalculatorSpec().calculators;
const byName = additiveCalculatorsByName();

const variables: Record<string, number> = Object.fromEntries(
  readCsv(join(DIR, 'variables.csv')).rows.map((r: Record<string, string>) => [r['Variable Name'], Number(r['String Value'])]),
);
/** Runs a calculator on `values` (by field name); every variable input is seeded from memory/Additive Manufacturing/variables.csv. */
function run(name: string, values: Record<string, number>, output?: string) {
  const def = byName[name]!;
  const spec = all.find((c) => c.name === name)!;
  const seeds: Record<string, CalcSeed> = {};
  for (const f of spec.fields) {
    if (f.formula) continue;
    const v = f.source && 'variable' in f.source ? variables[f.source.variable] : values[f.name];
    if (v === undefined) throw new Error(`${name}: no value for ${f.name}`);
    seeds[f.name] = { value: v, source: 'test' };
  }
  return runReferenceCalculator({ [name]: def }, name, seeds, output ?? spec.output ?? 'Cycle Time');
}

describe('additive calculator spec', () => {
  it('is what migration 1073 creates (regenerate the migration after editing the spec)', () => {
    expect(readFileSync(join(MIGRATIONS, '1073_additive_calculators.sql'), 'utf8')).toBe(buildAdditiveCalculatorsMigrationSql());
  });

  it('every operation it computes is a process of memory/Additive Manufacturing, each costed process has one, none twice', () => {
    const catalog = new Set(readCsv(join(DIR, 'processes.csv')).rows.map((r: Record<string, string>) => r['Process Name']));
    const ops = all.flatMap((c) => c.operations);
    expect(ops.filter((o) => !catalog.has(o))).toEqual([]);
    expect(new Set(ops).size).toBe(ops.length);
    expect([...catalog].filter((p) => !ops.includes(p as string) && p !== 'No Cost Feature' && p !== 'User-Defined Process')).toEqual([]);
  });

  it('field names never collide once normalized', () => {
    for (const c of all) {
      const names = c.fields.map((f) => normalizeFieldName(f.name));
      expect({ calc: c.name, dup: names.filter((n, i) => names.indexOf(n) !== i) }).toEqual({ calc: c.name, dup: [] });
    }
  });

  describe('every source resolves to real data', () => {
    const sources = all.flatMap((c) => c.fields.flatMap((f) => (f.source ? [{ at: `${c.name}/${f.name}`, source: f.source as Record<string, string> }] : [])));
    const of = (kind: string) => sources.filter((s) => kind in s.source).map((s) => ({ at: s.at, key: s.source[kind]! }));

    it('variables are in variables.csv', () => {
      expect(of('variable').filter((s) => !(s.key in variables))).toEqual([]);
    });

    it('lookups are a table and header of memory/Additive Manufacturing/Lookup, or of the materials table migration 1072 stages', () => {
      const headers = new Map<string, string[]>(readdirSync(join(DIR, 'Lookup')).filter((f) => f.endsWith('.csv')).map((f) => [f.replace(/\.csv$/, ''), readCsv(join(DIR, 'Lookup', f)).columns as string[]]));
      headers.set('additive_tblMaterialBuild', ['Tapped Density (kg / m^3)', 'Max Powder Cycles', 'Recycle Percentage']);
      expect(of('lookup').filter((s) => !headers.get(s.key.slice(0, s.key.indexOf('.')))?.includes(s.key.slice(s.key.indexOf('.') + 1)))).toEqual([]);
    });

    it('machine columns are specs of the additive machines (migration 793 keys their file headers with specKey; 1070 adds the cleaning rate)', () => {
      const keys = new Set(readdirSync(join(DIR, 'Machine')).flatMap((f) => (readCsv(join(DIR, 'Machine', f)).columns as string[]).map((h) => specKey(h) as string)));
      keys.add('metal_cleaning_rate');
      expect(of('machine').filter((s) => !keys.has(s.key))).toEqual([]);
    });

    it('material columns are the density and the price of the material', () => {
      expect(of('material').filter((s) => !['density_kg_m3', 'cost'].includes(s.key))).toEqual([]);
    });
  });
});

// Hand-worked: a 50 x 30 mm part 20 mm tall, 10,000 mm³, on the Concept Laser M Line Factory (bed 425 x 400 x 400 mm, 4 lasers at 4,500 mm/s,
// 0.5 mm beam, 10 s layer delay), memory/Additive Manufacturing variables (nesting allowance 5 mm).
describe('additive calculators, worked by hand', () => {
  const bed = { 'Bed Length': 425, 'Bed Width': 400, 'Bed Height': 400 };

  it('parts per build: 7 x 10 footprints of 60 x 40 mm on the plate (better than 10 x 6 turned), one layer when supported', () => {
    const r = run('Additive - Parts per build', { ...bed, 'Part Length': 50, 'Part Width': 30, 'Build Height': 20, Stacks: 0, 'Base Height': 0, 'Batch Size': 250 });
    expect(r.outputs['Parts per Layer']).toBe(70);
    expect(r.value).toBe(70);
  });

  it('parts per build: a laser sintered bed stacks 12 layers of 30 mm in the 385 mm above its 15 mm base, capped by the batch', () => {
    const r = run('Additive - Parts per build', { ...bed, 'Part Length': 50, 'Part Width': 30, 'Build Height': 20, Stacks: 1, 'Base Height': 15, 'Batch Size': 250 });
    expect(r.outputs['Parts Stacked']).toBe(12);
    expect(r.value).toBe(250);
  });

  it('metal sintering: 1,500 layers of 0.02 mm (20 mm + the 10 mm base), each recoated over 425 mm, 70 parts sharing the build and its 11,100 s of fixed steps', () => {
    const r = run('Additive - Metal sintering', {
      'Build Height': 20, 'Layer Thickness': 0.02, 'Bed Length': 425, 'Layer Delay': 10, 'Melted Volume': 10000,
      'Scanning Speed': 4500, 'Beam Diameter': 0.5, Lasers: 4, 'Complexity Factor': 1, 'Parts per Build': 70,
    });
    const recoat = 425 / 76 + 425 / 200 + 10;
    const scan = 10000 / (4500 * 0.5 * 0.02 * 4);
    expect(r.outputs.Layers).toBe(1500);
    expect(r.outputs['Scan Time']).toBeCloseTo(scan, 9);
    expect(r.sec).toBeCloseTo((1500 * recoat + 70 * scan + (3600 + 1800 + 1200 + 0.25 * 3600 + 3600)) / 70, 6);
  });

  it('material jetting: 1,250 layers of 0.016 mm, two 152.4 mm strips of the 200 mm nested width, twice each, over 250 mm at 0.33 m/s', () => {
    const r = run('Additive - Material jetting', {
      'Build Height': 20, 'Layer Thickness': 0.016, 'Nested Length': 250, 'Nested Width': 200, 'Scanning Width': 152.4, 'Layer Speed': 0.33, 'Parts per Build': 20,
    });
    expect(r.outputs.Layers).toBe(1250);
    expect(r.sec).toBeCloseTo((1250 * ((2 * 2 * 250) / 330) + 1200) / 20, 6);
  });

  it('support breakoff: two regions reached and broken (3 + 5 s each) and 400 mm² of contact at 10 mm²/s', () => {
    expect(run('Additive - Support breakoff', { 'Support Regions': 2, 'Contact Area': 400, 'Breakoff Rate': 10 }).sec).toBeCloseTo(56, 9);
  });

  it('metal powder: the part and its supports as a 40 % lattice, 40 % lost to the process, a quarter of the support volume trapped', () => {
    const r = run('Additive - Metal powder', { 'Part Volume': 10000, 'Support Volume': 12000, Density: 8000, 'Unit Cost': 100 });
    expect(r.outputs['Melted Volume']).toBeCloseTo(14800, 9);
    expect(r.outputs['Powder Mass']).toBeCloseTo(((14800 * 1.4 + 12000 * 0.25) * 8000) / 1e9, 12);
    expect(r.value).toBeCloseTo(r.outputs['Powder Mass']! * 100, 9);
  });

  it('polymer powder: the part, and its share of the bed spent (55 % not recycled, the recycled 45 % once every 5 builds)', () => {
    const r = run('Additive - Polymer powder', {
      'Part Volume': 10000, Density: 1010, 'Tapped Density': 593.88, 'Recycle Fraction': 0.45, 'Max Powder Cycles': 5,
      'Bed Length': 381, 'Bed Width': 330, 'Bed Fill Height': 100, 'Parts per Build': 100, 'Unit Cost': 109,
    });
    const bedKg = (381 * 330 * 100 * 593.88) / 1e9;
    expect(r.outputs['Spent Powder Mass']).toBeCloseTo((bedKg * (0.55 + 0.45 / 5)) / 100, 12);
    expect(r.value).toBeCloseTo(((10000 * 1010) / 1e9 + (bedKg * 0.64) / 100) * 109, 9);
  });

  it('cleaning: 10,000 mm² at 0.03 m²/min takes 20 s, under the 60 s minimum', () => {
    expect(run('Additive - Cleaning', { 'Surface Area': 10000, 'Cleaning Rate': 0.03 }).sec).toBeCloseTo(60, 9);
    expect(run('Additive - Cleaning', { 'Surface Area': 60000, 'Cleaning Rate': 0.03 }).sec).toBeCloseTo(120, 9);
  });

  it('melt complexity: a thin-walled part (surface over volume above 0.667 per mm) scans 10 % slower, a compact one 10 % faster', () => {
    expect(run('Additive - Melt complexity', { 'Surface Area': 5000, 'Part Volume': 10000 }).value).toBe(1);
    expect(run('Additive - Melt complexity', { 'Surface Area': 9000, 'Part Volume': 10000 }).value).toBe(1.1);
    expect(run('Additive - Melt complexity', { 'Surface Area': 1000, 'Part Volume': 10000 }).value).toBe(0.9);
  });
});

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { normalizeFieldName } from '../../../../../modules/calculators/calculator-formula-evaluator';
import { compositesCalculatorsByName, loadCompositesCalculatorSpec } from '../../../../../modules/bom-items/costing/composites/calculators/composites-calculator-spec';
import { buildCompositesCalculatorsMigrationSql } from '../../../../../modules/bom-items/costing/composites/calculators/composites-calculators-migration';
import { runReferenceCalculator, type CalcSeed } from '../../../../../modules/bom-items/costing/shared/calculators/reference-calculator';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { readCsv, specKey } = require('../../../../../../migrations/scripts/lib/memory-machine-seed.js');
const MIGRATIONS = join(__dirname, '../../../../../../migrations');
const DIR = join(__dirname, '../../../../../../../memory/Composites');
const all = loadCompositesCalculatorSpec().calculators;
const byName = compositesCalculatorsByName();

const variables: Record<string, number> = Object.fromEntries(
  readCsv(join(DIR, 'composite_variables.csv')).rows.map((r: Record<string, string>) => [r['Variable Name'], Number(r['String Value'])]),
);
/** Runs a calculator on `values` (by field name); every variable input is seeded from composite_variables.csv. */
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

describe('composites calculator spec', () => {
  it('is what migration 1065 creates (regenerate the migration after editing the spec)', () => {
    expect(readFileSync(join(MIGRATIONS, '1065_composites_calculators.sql'), 'utf8')).toBe(buildCompositesCalculatorsMigrationSql());
  });

  it('every operation it computes is a process of memory/Composites and none is computed twice', () => {
    const catalog = new Set(readCsv(join(DIR, 'processes.csv')).rows.map((r: Record<string, string>) => r['Process Name']));
    const ops = all.flatMap((c) => c.operations);
    expect(ops.filter((o) => !catalog.has(o))).toEqual([]);
    expect(new Set(ops).size).toBe(ops.length);
    // Every costed process of the catalog has its calculator (No Cost Feature and User-Defined Process cost nothing).
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

    it('variables are in composite_variables.csv', () => {
      expect(of('variable').filter((s) => !(s.key in variables))).toEqual([]);
    });

    it('lookups are an existing table and header of memory/Composites/Lookup', () => {
      const headers = new Map<string, string[]>(readdirSync(join(DIR, 'Lookup')).filter((f) => f.endsWith('.csv')).map((f) => [f.replace(/\.csv$/, ''), readCsv(join(DIR, 'Lookup', f)).columns as string[]]));
      expect(of('lookup').filter((s) => !headers.get(s.key.slice(0, s.key.indexOf('.')))?.includes(s.key.slice(s.key.indexOf('.') + 1)))).toEqual([]);
    });

    it('machine columns are specs of the composites machines (migration 796 keys their file headers with specKey)', () => {
      const keys = new Set(readdirSync(join(DIR, 'Machine')).flatMap((f) => (readCsv(join(DIR, 'Machine', f)).columns as string[]).map((h) => specKey(h) as string)));
      expect(of('machine').filter((s) => !keys.has(s.key))).toEqual([]);
    });

    it('material columns are properties migration 855 gave the composites materials, or their price per square metre', () => {
      const props = new Set(['areal_weight', 'cured_thickness', 'material_utilization', 'cure_hold_temperature', 'cure_dwell_time', 'cure_temperature_ramp_up_rate',
        'cure_temperature_ramp_down_rate', 'deformation_average_angle', 'deformation_warning_angle', 'deformation_limit_angle', 'cost_per_m2']);
      expect(of('material').filter((s) => !props.has(s.key))).toEqual([]);
    });
  });
});

// Hand-worked on a 300 x 200 mm laminate, 3 mm thick (tool side 60,000 mm², trim length 1,000 mm), memory/Composites variables.
describe('composites calculators, worked by hand', () => {
  const plate = { 'Tool Side Area': 60000, 'Trim Length': 1000 };

  it('tool clean: the tool (the part plus 150 mm all round: 60,000 + 1,000 x 150 + 4 x 150² = 300,000 mm²) at the laser cell\'s 3,330 mm²/s', () => {
    const r = run('Composites - Tool clean', { ...plate, 'Clean Rate': 3330 });
    expect(r.outputs['Tool Area']).toBeCloseTo(300000, 6);
    expect(r.sec).toBeCloseTo(300000 / 3330, 6);
  });

  it('mold preparation: 3 coats of release at 26,000 mm²/s, tool tack at 24,000 mm²/s and its 35 s cure', () => {
    const r = run('Composites - Mold preparation', plate);
    expect(r.sec).toBeCloseTo((3 * 300000) / 26000 + 300000 / 24000 + 35, 6);
  });

  it('ply complexity: a flat ply with a 2,000 mm² cutout, 300 x 200 (aspect 0.67, under the 0.75 square ratio), hand layup weightings', () => {
    const r = run('Composites - Ply complexity', {
      'Ply Length': 300, 'Ply Width': 200, 'Average Curvature': 0, 'Deformation Average Angle': 25, 'Deformation Warning Angle': 17, 'Deformation Limit Angle': 33,
      'Cutout Area': 2000, 'Ply Outer Area': 60000, 'Weight Flexibility': 0.5, 'Weight Cutout': 0.1, 'Weight Deformation': 0.4, 'Weight Aspect': 0,
    });
    expect(r.value).toBeCloseTo(0.1 * (2000 / 60000), 9);
    expect(r.outputs['Aspect Rating (unverified rule)']).toBeCloseTo(1 - 200 / 300 / 0.75, 9);
  });

  it('ply complexity: draped over a 5 per m curvature along 300 mm the ply turns 86 deg, past the material\'s limit', () => {
    const r = run('Composites - Ply complexity', {
      'Ply Length': 300, 'Ply Width': 300, 'Average Curvature': 5, 'Deformation Average Angle': 25, 'Deformation Warning Angle': 17, 'Deformation Limit Angle': 33,
      'Cutout Area': 0, 'Ply Outer Area': 90000, 'Weight Flexibility': 0.5, 'Weight Cutout': 0.1, 'Weight Deformation': 0.4, 'Weight Aspect': 0,
    });
    expect(r.outputs['Drape Angle']).toBeCloseTo((0.3 * 5 * 180) / Math.PI, 6);
    expect(r.value).toBeCloseTo(0.9, 9);
  });

  it('hand ply placement: a 0.06 m² ply (tblPlyHandLayupTimes 5 to 15 min), complexity 0.2, no laser projection (x 1.1)', () => {
    const r = run('Composites - Hand ply placement', { 'Ply Area': 60000, 'Layup Time Min': 5, 'Layup Time Max': 15, Complexity: 0.2, 'Guide Multiplier': 1.1 });
    expect(r.value).toBeCloseTo((5 + 0.2 * 10) * 60 * 1.1, 9);
  });

  it('automated ply placement: 200 mm wide in one 203.2 mm AFP band at 1,000 mm/s, plus a 5 s traverse', () => {
    const r = run('Composites - Automated ply placement', {
      'Ply Area': 60000, 'Ply Width': 200, 'Band Width': 203.2, 'Max Deposition Rate': 1000, 'Min Rate Factor': 0.16, Complexity: 0, 'Traverse Time': 5,
    });
    expect(r.outputs['Courses']).toBe(1);
    expect(r.value).toBeCloseTo(60000 / 203.2 / 1000 + 5, 9);
  });

  it('ply cutting: 1,000 mm of outline at 800 mm/min, 300 mm unrolled at 1,400 mm/s, a small ply\'s 3 s unload, 8 s ident', () => {
    const r = run('Composites - Ply cutting', { 'Ply Area': 60000, 'Ply Perimeter': 1000, 'Ply Length': 300, 'Cut Rate': 800 });
    expect(r.value).toBeCloseTo(1000 / (800 / 60) + 300 / 1400 + 3 + 8, 9);
  });

  it('core placement: template (120 s), a 500 mm perimeter at 100 mm/s, no splice, 2 potted holes at 40 s', () => {
    const r = run('Composites - Core placement', { 'Core Perimeter': 500, 'Splice Length': 0, 'Potted Holes': 2 });
    expect(r.value).toBeCloseTo(120 + 5 + 80, 9);
  });

  it('ply material: the ply with 25.4 mm trim x 0.85 round it, at 80 % utilization and 243.33 USD/m²; its mass at 279 g/m²', () => {
    const r = run('Composites - Ply material', { 'Ply Area': 60000, 'Ply Perimeter': 1000, Utilization: 80, 'Price per m²': 243.33, 'Areal Weight': 279 });
    const blank = 60000 + 1000 * 25.4 * 0.85;
    expect(r.outputs['Blank Area']).toBeCloseTo(blank, 6);
    expect(r.value).toBeCloseTo((blank / 0.8 / 1e6) * 243.33, 9);
    expect(r.outputs['Ply Mass']).toBeCloseTo(0.06 * 0.279, 9);
  });

  it('core material: a 15 mm core is two layers of 12.7 mm stock, 25.4 mm trimmed round it', () => {
    const r = run('Composites - Core material', { 'Core Area': 15000, 'Core Perimeter': 500, 'Core Depth': 15, 'Stock Thickness': 12.7, Utilization: 100, 'Price per m²': 188.01 });
    expect(r.outputs['Layers']).toBe(2);
    expect(r.value).toBeCloseTo(((15000 + 500 * 25.4 + 4 * 25.4 ** 2) * 2 / 1e6) * 188.01, 9);
  });

  it('autoclave load: a 600 x 500 tool, 503 mm high, fits the 0.9 x 1.5 m autoclave at 80 %; shared it takes 600 of its 1,219 mm', () => {
    const base = { 'Footprint Length': 300, 'Footprint Width': 200, 'Part Height': 3, 'Usable Length': 1524, 'Usable Diameter': 914 };
    expect(run('Composites - Autoclave load', { ...base, Shared: 1 }).value).toBeCloseTo((1524 * 0.8) / 600, 9);
    expect(run('Composites - Autoclave load', { ...base, Shared: 0 }).value).toBe(2);
    expect(run('Composites - Autoclave load', { ...base, 'Footprint Width': 600, Shared: 1 }).value).toBe(0);
  });

  it('autoclave cure: 300 s in, 30 to 180 C at 2 C/min, 210 min dwell, 180 to 40 C at 2 C/min, shared by 2 parts', () => {
    const r = run('Composites - Autoclave cure', {
      'Hold Temperature': 180, 'Ramp Up Rate': 2, 'Ramp Down Rate': 2, 'Dwell Time': 210, 'Parts per Load': 2,
    });
    expect(r.outputs['Load Cycle']).toBeCloseTo(300 + 75 * 60 + 210 * 60 + 70 * 60, 9);
    expect(r.sec).toBeCloseTo(21600 / 2, 9);
  });

  it('hand layup: 12 plies (debulks after ply 1 and every 3rd: 4), one thermocouple, the drop test and unbagging', () => {
    const r = run('Composites - Hand layup', { ...plate, 'Ply Placement Time': 12 * 462, 'Core Placement Time': 0, Plies: 12 });
    const bag = 1000 + 8 * 150;
    const debulk = 20 * 60 + bag / 30 + 300 + bag / 300;
    expect(r.outputs['Debulks']).toBe(4);
    expect(r.outputs['Thermocouples']).toBe(1);
    expect(r.sec).toBeCloseTo(12 * 462 + 4 * debulk + (30 + 20) + 20 * 60 + bag / 300, 6);
  });

  it('vacuum bag: peel ply, release film and breather over the 300,000 mm² tool, the bag unrolled, sealant round it, a port', () => {
    const r = run('Composites - Vacuum bag', { ...plate, 'Footprint Length': 300 });
    expect(r.sec).toBeCloseTo((3 * 300000) / 7000 + 600 / 300 + 2200 / 30 + 300, 6);
  });

  it('bench operation: breaking out (tblHandlingTimes) and inspecting both skins at 28,000 mm²/s', () => {
    const r = run('Composites - Bench operation', { 'Tool Handling Time': 120, 'Part Handling Time': 60, 'Surface Area': 120000 });
    expect(r.sec).toBeCloseTo(120 + 60 + 120000 / 28000, 9);
  });
});

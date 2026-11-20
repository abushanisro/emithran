// The Multi-Spindle Machining data: its calculators (migration 1095), its machines' limits and slide layout (migration 1093) and its catalog
// (migration 1094), from memory/.
import { execFileSync } from 'child_process';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import { normalizeFieldName } from '../../../../../modules/calculators/calculator-formula-evaluator';
import {
  loadMultiSpindleCalculatorSpec, multiSpindleCalculatorsByName,
} from '../../../../../modules/bom-items/costing/multi-spindle/calculators/multi-spindle-calculator-spec';
import { buildMultiSpindleCalculatorsMigrationSql } from '../../../../../modules/bom-items/costing/multi-spindle/calculators/multi-spindle-calculators-migration';
import { runReferenceCalculator, type CalcSeed } from '../../../../../modules/bom-items/costing/shared/calculators/reference-calculator';

interface Csv { columns: string[]; rows: Record<string, string | undefined>[] }
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { readCsv } = require('../../../../../../migrations/scripts/lib/memory-machine-seed.js') as { readCsv: (path: string) => Csv };

const BACKEND = join(__dirname, '../../../../../..');
const MIGRATIONS = join(BACKEND, 'migrations');
const MEMORY = join(BACKEND, '../memory');
const DIR = join(MEMORY, 'Multi-Spindle Maching');
const MACHINES = join(MEMORY, 'machining/machine/simultaneous_turning_usa.csv');
const all = loadMultiSpindleCalculatorSpec().calculators;
const byName = multiSpindleCalculatorsByName();

const variables: Record<string, number> = Object.fromEntries(
  readCsv(join(DIR, 'variables.csv')).rows.map((r) => [r['variableName']!, Number(r['stringValue'])]),
);

/** Runs a calculator on `values` (by field name); every variable input is seeded from memory/Multi-Spindle Maching/variables.csv. */
function run(name: string, values: Record<string, number>) {
  const spec = all.find((c) => c.name === name)!;
  const seeds: Record<string, CalcSeed> = {};
  for (const f of spec.fields) {
    if (f.formula) continue;
    const v = f.source && 'variable' in f.source ? variables[f.source.variable] : values[f.name];
    if (v === undefined) throw new Error(`${name}: no value for ${f.name}`);
    seeds[f.name] = { value: v, source: 'test' };
  }
  return runReferenceCalculator({ [name]: byName[name]! }, name, seeds, spec.output ?? 'Cycle Time');
}

describe('the Multi-Spindle Machining calculators (migration 1095)', () => {
  it('are what migration 1095 creates (regenerate the migration after editing the spec)', () => {
    expect(readFileSync(join(MIGRATIONS, '1095_multi_spindle_calculators.sql'), 'utf8')).toBe(buildMultiSpindleCalculatorsMigrationSql());
  });

  it('compute the catalog row migration 1094 adds, and field names never collide once normalized', () => {
    expect(all.flatMap((c) => c.operations)).toEqual(['Simultaneous Turning']);
    for (const c of all) {
      const names = c.fields.map((f) => normalizeFieldName(f.name));
      expect({ calc: c.name, dup: names.filter((n, i) => names.indexOf(n) !== i) }).toEqual({ calc: c.name, dup: [] });
    }
  });

  describe('every source resolves to real data', () => {
    const sources = all.flatMap((c) => c.fields.flatMap((f) => (f.source ? [{ at: `${c.name}/${f.name}`, source: f.source as Record<string, string> }] : [])));
    const of = (kind: string) => sources.filter((s) => kind in s.source).map((s) => ({ at: s.at, key: s.source[kind]! }));

    it('variables are in memory/Multi-Spindle Maching/variables.csv', () => {
      expect(of('variable').filter((s) => !(s.key in variables))).toEqual([]);
    });

    it('lookups are a table and header of memory/Multi-Spindle Maching/lookup', () => {
      const headers = new Map(readdirSync(join(DIR, 'lookup')).filter((f) => f.endsWith('.csv')).map((f) => [f.replace(/\.csv$/, ''), readCsv(join(DIR, 'lookup', f)).columns]));
      expect(of('lookup').filter((s) => !headers.get(s.key.slice(0, s.key.indexOf('.')))?.includes(s.key.slice(s.key.indexOf('.') + 1)))).toEqual([]);
    });

    it('machine columns are the multi-spindle machine times of memory/Machining (HR Rates columns of migration 788)', () => {
      const keys = new Set(readCsv(MACHINES).columns.map((h) => h.split('.').at(-1)!));
      expect(of('machine').filter((s) => !keys.has(s.key))).toEqual([]);
    });

    it('material columns are raw_materials columns', () => {
      expect(of('material').filter((s) => s.key !== 'density_kg_m3')).toEqual([]);
    });
  });

  // Hand-worked: a Ø14 x 32 mm steel part on 5/8 in (15.875 mm) round bar, USA (AISI 1006 round bar 1.473 USD/kg, density 7850).
  it('bar stock: (32 + 2.5 parting + 0.79375 facing) mm per part, floor((4500 - 152.4) / 35.29375) = 123 parts per bar, each a 123rd of the bar', () => {
    const area = (Math.PI / 4) * 15.875 ** 2;
    const r = run('Multi-Spindle Machining - Bar Stock', {
      'Part Length': 32, 'Bar Section Area': area, 'Parting Width': 2.5, 'Bar Remnant': 152.4, Density: 7850, 'Price per kg': 1.473,
    });
    expect(r.outputs['Length per Part']).toBeCloseTo(35.29375, 9);
    expect(r.outputs['Parts per Bar']).toBe(123);
    const mass = (4500 * area * 7850) / 1e9 / 123;
    expect(r.outputs['Mass per Part']).toBeCloseTo(mass, 9);
    expect(r.value).toBeCloseTo(mass * 1.473, 9);
  });

  it('cycle: the slowest station plus the index (Index MS32-6: drum 0.7 + transfer 1 + stock feed 2.5 + sync 1.5 = 5.7 s)', () => {
    const r = run('Multi-Spindle Machining - Cycle', {
      'Slowest Station': 12.4, 'Drum Index Time': 0.7, 'Transfer Time': 1, 'Stock Feed Time': 2.5, 'Speed Synchronization Time': 1.5,
    });
    expect(r.outputs['Index Time']).toBeCloseTo(5.7, 9);
    expect(r.value).toBeCloseTo(18.1, 9);
  });
});

describe('the multi-spindle machines (migration 1093)', () => {
  const sql = () => readFileSync(join(MIGRATIONS, '1093_multi_spindle_machine_limits.sql'), 'utf8');

  it('is what the generator writes from memory/ (it checks every machine\'s spindles against its slide configuration)', () => {
    const committed = sql();
    execFileSync('node', [join(BACKEND, 'scripts/generate-multi-spindle-machines-migration.js')], { stdio: 'ignore' });
    expect(sql()).toBe(committed);
  });

  it('carries every machine of the memory file: its bar capacity, length and slide layout, by name, for both locations', () => {
    const names = readCsv(MACHINES).rows.map((r) => r['name']!);
    expect(names).toHaveLength(15);
    for (const n of names) expect(sql()).toContain(`($str$${n}$str$,`);
    expect(sql()).not.toMatch(/WHERE m\.machine_class = 'simultaneous_turning' AND m\.location/);
    // a 6-spindle (back work on its 6th spindle), an 8-spindle (7 and 8) and a twin-spindle center (two turrets per spindle)
    expect(sql()).toContain("($str$Index MS32-6$str$, $str$CNC Multi-Spindle$str$, 32, 100, '[1,2,3,4,5,6]'::jsonb, '[1,2,3,4,5,6]'::jsonb, '[1,2,3,4,5,6]'::jsonb, '[6]'::jsonb,");
    expect(sql()).toContain("'[7,8]'::jsonb, 7000, 24,");
    expect(sql()).toContain("($str$HAAS DS-30Y$str$, $str$CNC Turning Center with Sub Spindle$str$, 76, 584, '[1,1,2,2]'::jsonb, '[1,2]'::jsonb, '[1,2]'::jsonb, '[2]'::jsonb,");
  });
});

describe('the Multi-Spindle Machining catalog (migration 1094)', () => {
  const sql = readFileSync(join(MIGRATIONS, '1094_multi_spindle_catalog_and_material_groups.sql'), 'utf8');

  it('adds the Simultaneous Turning row the cycle calculator links to, and shares Machining\'s material groups', () => {
    expect(sql).toContain("SELECT 'Multi-Spindle Machining', 'Simultaneous Turning', 'Simultaneous Turning', 'simultaneous_turning', v_process, false, 4210");
    expect(sql).toContain("WHERE g.process_group = 'Machining'");
  });
});

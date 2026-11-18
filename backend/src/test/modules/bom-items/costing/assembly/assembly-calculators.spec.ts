import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import { assemblyCalculatorsByName, loadAssemblyCalculatorSpec } from '../../../../../modules/bom-items/costing/assembly/calculators/assembly-calculator-spec';
import { buildAssemblyCalculatorsMigrationSql } from '../../../../../modules/bom-items/costing/assembly/calculators/assembly-calculators-migration';
import { runReferenceCalculator, type CalcSeed } from '../../../../../modules/bom-items/costing/shared/calculators/reference-calculator';
import { normalizeFieldName } from '../../../../../modules/calculators/calculator-formula-evaluator';

interface Csv { columns: string[]; rows: Record<string, string | undefined>[] }
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { readCsv, specKey } = require('../../../../../../migrations/scripts/lib/memory-machine-seed.js') as { readCsv: (path: string) => Csv; specKey: (header: string) => string };

const MIGRATIONS = join(__dirname, '../../../../../../migrations');
const DIR = join(__dirname, '../../../../../../../memory/Assembly');
const all = loadAssemblyCalculatorSpec().calculators;
const byName = assemblyCalculatorsByName();
const clean = (h: string) => h.replace(/^\uFEFF/, '');

const variables: Record<string, number> = Object.fromEntries(
  readCsv(join(DIR, 'digital_factory_variables.csv')).rows.map((r) => [clean(r['Variable Name'] ?? r['\uFEFFVariable Name'] ?? ''), Number(r['String Value'])]),
);
/** Runs a calculator on `values` (by field name); every variable input is seeded from memory/Assembly/digital_factory_variables.csv. */
function run(name: string, values: Record<string, number>) {
  const def = byName[name];
  const spec = all.find((c) => c.name === name);
  if (!spec) throw new Error(`no calculator ${name}`);
  const seeds: Record<string, CalcSeed> = {};
  for (const f of spec.fields) {
    if (f.formula) continue;
    const pool = f.source && 'variable' in f.source ? variables : values;
    const key = f.source && 'variable' in f.source ? f.source.variable : f.name;
    if (!(key in pool)) throw new Error(`${name}: no value for ${f.name}`);
    seeds[f.name] = { value: pool[key], source: 'test' };
  }
  return runReferenceCalculator({ [name]: def }, name, seeds, spec.output ?? 'Cycle Time');
}

describe('assembly calculator spec', () => {
  it('is what migration 1078 creates (regenerate the migration after editing the spec)', () => {
    expect(readFileSync(join(MIGRATIONS, '1078_assembly_calculators.sql'), 'utf8')).toBe(buildAssemblyCalculatorsMigrationSql());
  });

  it('every operation it computes is a process of memory/Assembly, each costed process has one, none twice', () => {
    const catalog = new Set(readCsv(join(DIR, 'processes (1).csv')).rows.map((r) => clean(r['Process Name'] ?? r['\uFEFFProcess Name'] ?? '')));
    const ops = all.flatMap((c) => c.operations);
    expect(ops.filter((o) => !catalog.has(o))).toEqual([]);
    expect(new Set(ops).size).toBe(ops.length);
    expect([...catalog].filter((p) => !ops.includes(p) && p !== 'No Cost Feature' && p !== 'User-Defined Process')).toEqual([]);
  });

  it('field names never collide once normalized', () => {
    for (const c of all) {
      const names = c.fields.map((f) => normalizeFieldName(f.name));
      expect({ calc: c.name, dup: names.filter((n, i) => names.indexOf(n) !== i) }).toEqual({ calc: c.name, dup: [] });
    }
  });

  describe('every source resolves to real data', () => {
    const sources = all.flatMap((c) => c.fields.flatMap((f) => (f.source ? [{ at: `${c.name}/${f.name}`, source: Object.entries(f.source) }] : [])));
    const of = (kind: string) => sources.flatMap((s) => s.source.filter(([k]) => k === kind).map(([, key]) => ({ at: s.at, key })));

    it('variables are in digital_factory_variables.csv', () => {
      expect(of('variable').filter((s) => !(s.key in variables))).toEqual([]);
    });

    it('lookups are a table and header of memory/Assembly/lookup, or of the DFA table migration 1077 stages', () => {
      const headers = new Map<string, string[]>(readdirSync(join(DIR, 'lookup')).filter((f) => f.endsWith('.csv'))
        .map((f) => [f.replace(/\.csv$/, '').replace(/_part1$/, ''), readCsv(join(DIR, 'lookup', f)).columns.map(clean)]));
      headers.set('assembly_tblDfaOperationTimes', ['Operation', 'Handling Code', 'Handling Time (s)', 'Insertion Code', 'Insertion Time (s)', 'Total Time (s)']);
      expect(of('lookup').filter((s) => !headers.get(s.key.slice(0, s.key.indexOf('.')))?.includes(s.key.slice(s.key.indexOf('.') + 1)))).toEqual([]);
    });

    it('machine columns are specs of the assembly machines (794 keys their headers, or the Field rows of a one-machine file, with specKey)', () => {
      const keys = new Set<string>();
      for (const f of readdirSync(join(DIR, 'Machines')).filter((x) => x.endsWith('.csv'))) {
        const t = readCsv(join(DIR, 'Machines', f));
        const cols = t.columns.map(clean);
        if (cols[0] === 'Field') for (const r of t.rows) keys.add(specKey(clean(r.Field ?? r['\uFEFFField'] ?? '')));
        else for (const h of cols) keys.add(specKey(h));
      }
      keys.add('wire_cost_usd_per_kg'); // migration 864 backfilled the welders' wire cost into their specs
      expect(of('machine').filter((s) => !keys.has(s.key))).toEqual([]);
    });
  });
});

describe('assembly calculators, worked by hand', () => {
  it('pick and place: two instances loaded at 10 s (no equipment, up to 5 kg) x handlingMultiplier 1.15', () => {
    expect(run('Assembly - Pick and place', { Quantity: 2, 'Load Time': 10, 'Unload Time': 0 }).sec).toBeCloseTo(2 * 10 * 1.15, 9);
  });

  it('mechanical assembly: four screws at the DFA 9.80 s (handling 11 + insertion 39)', () => {
    expect(run('Assembly - Mechanical assembly', { Joints: 4, 'Operation Time': 9.8 }).sec).toBeCloseTo(39.2, 9);
  });

  it('manual MIG: a 500 mm weld in one pass at 6 mm/s, arc time standard 1.32, tacks every 100 mm, over the 0.45 welding efficiency', () => {
    const r = run('Assembly - Manual MIG welding', {
      'Weld Length': 500, Welds: 1, Passes: 1, 'Travel Speed': 6, 'Arc Time Standard': 1.32, 'Gun Placement Time': 10, 'Gun Clean Per Arc': 0.05,
      'Tack Pitch': 100, 'Tack Length': 6, Efficiency: 0.45,
    });
    const arc = (500 / 6) * 1.32;
    expect(r.outputs['Arc Time']).toBeCloseTo(arc, 9);
    expect(r.sec).toBeCloseTo((arc + (500 / 100) * 6 / 6) / 0.45 + 10 + arc * 0.05, 9);
  });

  it('robotic spot welding: ten spots over one head, its 300 s programming per spot spread over a batch of 250', () => {
    const r = run('Assembly - Robotic spot welding', { Spots: 10, 'Spot Weld Time': 0.96, 'Gun Placement Time': 2, 'Programming Time Per Weld': 300, 'Weld Heads': 1, 'Batch Size': 250 });
    expect(r.sec).toBeCloseTo(10 * (0.96 + 2) + (10 * 300) / 250, 9);
  });

  it('fillet sealing at 0.05 s/mm; adhesive bonding of 10,000 mm² degreased at 0.03 and applied at 0.02 m²/min', () => {
    expect(run('Assembly - Fillet sealing', { 'Bead Length': 1000, 'Application Rate': 0.05 }).sec).toBeCloseTo(50, 9);
    expect(run('Assembly - Adhesive bonding', { 'Bond Area': 10000, 'Application Rate': 0.02 }).sec).toBeCloseTo((0.01 / 0.03) * 60 + (0.01 / 0.02) * 60, 9);
  });

  it('weld consumables: 1.2 mm wire fed at 100 mm/s for a 60 s arc, at the weld metal\'s 7803 kg/m³ and 1.85 USD/kg', () => {
    const r = run('Assembly - Weld consumables', {
      'Arc Time': 60, 'Weld Length': 500, 'Wire Feed Speed': 100, 'Wire Diameter': 1.2, 'Weld Density': 7803, 'Wire Cost Per kg': 1.85, 'Gas Cost Per Hour': 13.91,
      'Spray On': 0, 'Spray Cost Per Can': 6, 'Spray Volume': 400, 'Spray Discharge': 0.9, 'Spray Density': 1.03, 'Spray Time Per Length': 0.05,
    });
    const mass = (Math.PI / 4) * 1.2 * 1.2 * 100 * 60 * 7803 / 1e9;
    expect(r.outputs['Wire Mass']).toBeCloseTo(mass, 12);
    expect(r.outputs['Gas Cost']).toBeCloseTo(13.91 * 60 / 3600, 12);
    expect(r.value).toBeCloseTo(mass * 1.85 + 13.91 * 60 / 3600 + mass / 9 * 0.32 + mass / 18 * 13.57, 12);
  });

  it('electron beam: the speed is capped by the machine\'s maximum', () => {
    const r = run('Assembly - Electron beam welding', { 'Weld Length': 200, 'Weld Depth': 1, 'Beam Power': 4, 'Max Speed': 50, 'Part Placement Time': 2, 'Pump Time': 60, 'Vent Time': 6 });
    expect(r.outputs['Weld Speed']).toBe(50);
    expect(r.sec).toBeCloseTo(200 / 50 + 2 + 60 + 6, 9);
  });
});

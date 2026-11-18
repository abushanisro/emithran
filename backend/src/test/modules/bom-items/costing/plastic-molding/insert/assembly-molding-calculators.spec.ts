import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import {
  assemblyMoldingCalculatorsByName, loadAssemblyMoldingCalculatorSpec,
} from '../../../../../../modules/bom-items/costing/plastic-molding/insert/calculators/assembly-molding-calculator-spec';
import { buildAssemblyMoldingCalculatorsMigrationSql } from '../../../../../../modules/bom-items/costing/plastic-molding/insert/calculators/assembly-molding-calculators-migration';
import { runReferenceCalculator, type CalcSeed } from '../../../../../../modules/bom-items/costing/shared/calculators/reference-calculator';

interface Csv { columns: string[]; rows: Record<string, string | undefined>[] }
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { readCsv } = require('../../../../../../../migrations/scripts/lib/memory-machine-seed.js') as { readCsv: (path: string) => Csv };

const MIGRATIONS = join(__dirname, '../../../../../../../migrations');
const DIR = join(__dirname, '../../../../../../../../memory/Assembly molding');
const all = loadAssemblyMoldingCalculatorSpec().calculators;
const byName = assemblyMoldingCalculatorsByName();
const clean = (h: string) => h.replace(/^\uFEFF/, '');
const variables: Record<string, number> = Object.fromEntries(
  readCsv(join(DIR, 'variables_extract.csv')).rows.map((r) => [clean(r['Variable Name'] ?? r['\uFEFFVariable Name'] ?? ''), Number(r['String Value'])]),
);

/** Runs a calculator on `values` (by field name); every variable input is seeded from memory/Assembly molding/variables_extract.csv. */
function run(name: string, values: Record<string, number>) {
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
  return runReferenceCalculator({ [name]: byName[name] }, name, seeds, spec.output ?? 'Cycle Time');
}

describe('assembly molding calculator spec', () => {
  it('is what migration 1081 creates (regenerate the migration after editing the spec)', () => {
    expect(readFileSync(join(MIGRATIONS, '1081_assembly_molding_calculators.sql'), 'utf8')).toBe(buildAssemblyMoldingCalculatorsMigrationSql());
  });

  it('computes Insert Pick and Place, a process of memory/Assembly molding (Insert Injection Molding is the injection calculator, migration 1080)', () => {
    const catalog = new Set(readCsv(join(DIR, 'Processes/processes.csv')).rows.map((r) => clean(r['Process Name'] ?? r['\uFEFFProcess Name'] ?? '')));
    const ops = all.flatMap((c) => c.operations);
    expect(ops).toEqual(['Insert Pick and Place']);
    expect(ops.filter((o) => !catalog.has(o))).toEqual([]);
  });

  it('every variable is in variables_extract.csv; the load times it is fed are componentLoadTime\'s', () => {
    const used = all.flatMap((c) => c.fields.flatMap((f) => (f.source && 'variable' in f.source ? [f.source.variable] : [])));
    expect(used.filter((v) => !(v in variables))).toEqual([]);
    expect(readdirSync(join(DIR, 'Lookup'))).toContain('componentLoadTime.csv');
    expect(readCsv(join(DIR, 'Lookup/componentLoadTime.csv')).columns.map(clean)).toEqual(['Load Time (s)', 'Weight (kg)', 'Load Method']);
  });
});

describe('assembly molding calculators, worked by hand', () => {
  it('a manual load is slowed by handlingMultiplier 1.15 and insertionMultiplier 1.2; a robot is not', () => {
    // Two 0.1 kg inserts: componentLoadTime Manual 8 s each (the 0.2 kg row), Robotic 6 s each (the 0.5 kg row).
    expect(run('Assembly Molding - Insert loading', { 'Load Time': 16, 'Manual Load': 1 }).sec).toBeCloseTo(16 * 1.15 * 1.2, 9);
    expect(run('Assembly Molding - Insert loading', { 'Load Time': 12, 'Manual Load': 0 }).sec).toBeCloseTo(12, 9);
  });

  it('a rotary or shuttle table loads during molding (the longer of the two); a press with no table adds them', () => {
    const shot = (table: number, mold: number, load: number) => run('Assembly Molding - Shot cycle', { 'Molding Cycle': mold, 'Load Time': load, 'Table Press': table }).value;
    expect(shot(1, 20, 22.08)).toBeCloseTo(22.08, 9);
    expect(shot(1, 30, 22.08)).toBeCloseTo(30, 9);
    expect(shot(0, 20, 22.08)).toBeCloseTo(42.08, 9);
  });
});

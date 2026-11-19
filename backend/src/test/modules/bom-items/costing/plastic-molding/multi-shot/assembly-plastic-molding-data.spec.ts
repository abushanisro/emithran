// The Assembly Plastic Molding (multi-shot) data: its calculators (migration 1086) and its machines (migration 1085), from memory/.
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

import {
  assemblyPlasticMoldingCalculatorsByName, loadAssemblyPlasticMoldingCalculatorSpec,
} from '../../../../../../modules/bom-items/costing/plastic-molding/multi-shot/calculators/assembly-plastic-molding-calculator-spec';
import { buildAssemblyPlasticMoldingCalculatorsMigrationSql } from '../../../../../../modules/bom-items/costing/plastic-molding/multi-shot/calculators/assembly-plastic-molding-calculators-migration';
import { runReferenceCalculator, type CalcSeed } from '../../../../../../modules/bom-items/costing/shared/calculators/reference-calculator';

interface Csv { columns: string[]; rows: Record<string, string | undefined>[] }
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { readCsv } = require('../../../../../../../migrations/scripts/lib/memory-machine-seed.js') as { readCsv: (path: string) => Csv };

const BACKEND = join(__dirname, '../../../../../../..');
const MIGRATIONS = join(BACKEND, 'migrations');
const DIR = join(BACKEND, '../memory/Assembly plastic molding');
const all = loadAssemblyPlasticMoldingCalculatorSpec().calculators;
const byName = assemblyPlasticMoldingCalculatorsByName();
const clean = (h: string) => h.replace(/^﻿/, '');
const variables: Record<string, number> = Object.fromEntries(
  readCsv(join(DIR, 'plastic_molding_variables.csv')).rows.map((r) => [clean(r['Variable Name'] ?? r['﻿Variable Name'] ?? ''), Number(r['String Value'])]),
);

function run(name: string, values: Record<string, number>) {
  const spec = all.find((c) => c.name === name)!;
  const seeds: Record<string, CalcSeed> = {};
  for (const f of spec.fields) {
    if (f.formula) continue;
    const isVar = f.source && 'variable' in f.source;
    const key = isVar ? (f.source as { variable: string }).variable : f.name;
    const v = isVar ? variables[key] : values[key];
    if (v == null) throw new Error(`${name}: no value for ${f.name}`);
    seeds[f.name] = { value: v, source: 'test' };
  }
  return runReferenceCalculator({ [name]: byName[name]! }, name, seeds, spec.output ?? 'Cycle Time');
}

describe('assembly plastic molding calculators', () => {
  it('are what migration 1086 creates (regenerate it after editing the spec)', () => {
    expect(readFileSync(join(MIGRATIONS, '1086_assembly_plastic_molding_calculators.sql'), 'utf8')).toBe(buildAssemblyPlasticMoldingCalculatorsMigrationSql());
  });

  it('compute Pick and Place, a process of memory/Assembly plastic molding; every variable is in its variables file', () => {
    const catalog = new Set(readCsv(join(DIR, 'Processes/processes.csv')).rows.map((r) => clean(r['Process Name'] ?? r['﻿Process Name'] ?? '')));
    expect(all.flatMap((c) => c.operations)).toEqual(['Pick and Place']);
    expect(catalog.has('Pick and Place')).toBe(true);
    const used = all.flatMap((c) => c.fields.flatMap((f) => (f.source && 'variable' in f.source ? [f.source.variable] : [])));
    expect(used.filter((v) => !(v in variables))).toEqual([]);
  });

  it('time a manual component load with handlingMultiplier 1.15 x insertionMultiplier 1.2; a robot without', () => {
    const manual = run('Assembly Plastic Molding - Component loading', { 'Load Time': 16, 'Manual Load': 1 });
    expect(manual.value).toBeCloseTo(16 * 1.15 * 1.2, 6);
    expect(run('Assembly Plastic Molding - Component loading', { 'Load Time': 12, 'Manual Load': 0 }).value).toBeCloseTo(12, 6);
  });

  it('a multi-shot press waits for the longest shot (or the loading), then indexes', () => {
    const cycle = (longest: number, load: number, index: number) =>
      run('Assembly Plastic Molding - Multi-shot cycle', { 'Longest Shot Cycle': longest, 'Load Time': load, 'Tool Index Time': index }).value;
    expect(cycle(24.5, 0, 3.5)).toBeCloseTo(28, 6);
    expect(cycle(12, 18, 2.5)).toBeCloseTo(20.5, 6);
  });
});

describe('the assembly plastic molding machines (migration 1085)', () => {
  it('is what the generator writes from memory/ (it checks every press name against the India columns)', () => {
    const committed = readFileSync(join(MIGRATIONS, '1085_assembly_plastic_molding_machines.sql'), 'utf8');
    execFileSync('node', [join(BACKEND, 'scripts/generate-assembly-plastic-molding-machines-migration.js')], { stdio: 'ignore' });
    expect(readFileSync(join(MIGRATIONS, '1085_assembly_plastic_molding_machines.sql'), 'utf8')).toBe(committed);
  });

  it('twins all 78 presses and 19 loaders, fixes the 1860 g typo, and carries the multi-shot attributes', () => {
    const sql = readFileSync(join(MIGRATIONS, '1085_assembly_plastic_molding_machines.sql'), 'utf8');
    expect(sql).toContain('Multi-Shot Molding  78 press(es)');
    expect(sql).toContain('Pick and Place      19 loader(s)');
    expect(sql).toContain('1060g | 4 Station | Rotary Stack$str$');
    // the 2900kN rotary stack press: 2 units, 4 stations, rotating stack, 2.5 s index, 1860 g per unit
    expect(sql).toMatch(/2900kN \| 2K \| 1860g \| 4 Station \| Rotary Stack\$str\$, 2900, 1860, [\d.]+, [\d.]+, [\d.]+, [\dNUL.]+, [\dNUL.]+, 2, 4, true, \$str\$Horizontal\$str\$, 2\.5,/);
  });
});

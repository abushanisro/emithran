// The Part Assembly data: its machines' specs, crew and India twins (migration 1098), its catalog's machine classes (migration 1099) and its
// calculators (migration 1100), from memory/Part Assembly and memory/Countries data.
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

import {
  loadPartAssemblyCalculatorSpec, partAssemblyCalculatorsByName,
} from '../../../../../modules/bom-items/costing/part-assembly/calculators/part-assembly-calculator-spec';
import { buildPartAssemblyCalculatorsMigrationSql } from '../../../../../modules/bom-items/costing/part-assembly/calculators/part-assembly-calculators-migration';
import { runReferenceCalculator, type CalcSeed } from '../../../../../modules/bom-items/costing/shared/calculators/reference-calculator';
import { normalizeFieldName } from '../../../../../modules/calculators/calculator-formula-evaluator';

interface Csv { columns: string[]; rows: Record<string, string | undefined>[] }
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { readCsv } = require('../../../../../../migrations/scripts/lib/memory-machine-seed.js') as { readCsv: (path: string) => Csv };

const BACKEND = join(__dirname, '../../../../../..');
const MIGRATIONS = join(BACKEND, 'migrations');
const MEMORY = join(BACKEND, '../memory');
const DIR = join(MEMORY, 'Part Assembly');
const all = loadPartAssemblyCalculatorSpec().calculators;
const byName = partAssemblyCalculatorsByName();
const machinesSql = () => readFileSync(join(MIGRATIONS, '1098_part_assembly_machines.sql'), 'utf8');
const catalogSql = () => readFileSync(join(MIGRATIONS, '1099_part_assembly_catalog_machine_class.sql'), 'utf8');

const variables: Partial<Record<string, number>> = Object.fromEntries(
  readCsv(join(DIR, 'variables_welding_group.csv')).rows.map((r) => [String(r['Variable Name']), Number(r['String Value'])]),
);

/** Runs a calculator on `values` (by field name); every variable input is seeded from memory/Part Assembly/variables_welding_group.csv. */
function run(name: string, values: Partial<Record<string, number>>) {
  const spec = all.find((c) => c.name === name);
  if (!spec) throw new Error(`no calculator ${name}`);
  const seeds: Record<string, CalcSeed> = {};
  for (const f of spec.fields) {
    if (f.formula) continue;
    const v = f.source && 'variable' in f.source ? variables[f.source.variable] : values[f.name];
    if (v === undefined) throw new Error(`${name}: no value for ${f.name}`);
    seeds[f.name] = { value: v, source: 'test' };
  }
  return runReferenceCalculator(byName, name, seeds, spec.output ?? 'Cycle Time');
}

/** The spec keys migration 1098 writes, and those migration 864 wrote on the Part Assembly machines it did match. */
function machineKeys(): Set<string> {
  const keys = new Set<string>();
  for (const json of machinesSql().match(/\$jsonb\$(\{.*?\})\$jsonb\$/g) ?? []) {
    for (const k of Object.keys(JSON.parse(json.slice('$jsonb$'.length, -'$jsonb$'.length)) as object)) keys.add(k);
  }
  const m864 = readFileSync(join(MIGRATIONS, '864_backfill_machine_specs.sql'), 'utf8');
  for (const line of m864.split('\n').filter((l) => /memory\/Part Assembly\/Machine\/(laser_seam|machine_default_(finish_)?grinding)/.test(l))) {
    const json = /\$jsonb\$(\{.*\})\$jsonb\$/.exec(line)?.[1];
    if (json) for (const k of Object.keys(JSON.parse(json) as object)) keys.add(k);
  }
  return keys;
}

describe('the Part Assembly calculators (migration 1100)', () => {
  it('are what migration 1100 creates (regenerate the migration after editing the spec)', () => {
    expect(readFileSync(join(MIGRATIONS, '1100_part_assembly_calculators.sql'), 'utf8')).toBe(buildPartAssemblyCalculatorsMigrationSql());
  });

  it('compute exactly the 9 catalog processes migration 1099 classes, and field names never collide once normalized', () => {
    const operations = all.flatMap((c) => c.operations).sort();
    const classed = [...(catalogSql().split('UPDATE process_calculator_mappings')[1] ?? '').matchAll(/\(\$str\$([^$]+)\$str\$, \$str\$[^$]+\$str\$\)/g)].map((m) => m[1]).sort();
    expect(operations).toEqual(classed);
    expect(operations).toHaveLength(9);
    for (const c of all) {
      const names = c.fields.map((f) => normalizeFieldName(f.name));
      expect(new Set(names).size).toBe(names.length);
    }
  });

  describe('every source resolves to real data', () => {
    const sources = all.flatMap((c) => c.fields.flatMap((f) => (f.source ? [f.source] : [])));

    it('variables are in memory/Part Assembly/variables_welding_group.csv', () => {
      for (const s of sources) if ('variable' in s) expect(Number.isFinite(variables[s.variable])).toBe(true);
    });

    it('lookups are a table and header of memory/Part Assembly/Lookup', () => {
      for (const s of sources) {
        if (!('lookup' in s)) continue;
        const dot = s.lookup.indexOf('.');
        const table = s.lookup.slice(0, dot);
        const column = s.lookup.slice(dot + 1);
        expect(readCsv(join(DIR, 'Lookup', `${table}.csv`)).columns).toContain(column);
      }
    });

    it('machine keys are specs migration 1098 writes (or migration 864 wrote on the machines it matched)', () => {
      const keys = machineKeys();
      for (const s of sources) if ('machine' in s) expect([s.machine, keys.has(s.machine)]).toEqual([s.machine, true]);
    });
  });

  // The Default Robotic Mig of memory: 1.14 mm wire, fed at 212 mm/s (the export), arc time standard 1.05, 6 mm tacks every 100 mm, gun placement
  // 2 s and clean 0.05 s per arc second, 300 s of programming per weld; arcEfficency 0.5. A 5 mm fillet (12.5 mm²) 300 mm long, in a batch of 25,
  // two components of 1-5 kg loaded (11 s each) and the weldment (1-5 kg) unloaded (15 s).
  it('robotic MIG: the weld metal at the wire\'s deposition, tacks, gun time, load, unload and the program per part', () => {
    const r = run('Part Assembly - Robotic MIG welding', {
      'Weld Length': 300, 'Weld Metal Area': 12.5, Welds: 1, Tacked: 1, 'Wire Feed Rate': 212, 'Wire Diameter': 1.14, 'Arc Time Standard': 1.05,
      'Tack Length': 6, 'Tack Pitch': 100, 'Gun Placement Time': 2, 'Gun Clean Per Arc': 0.05, 'Weld Density': 7803, 'Weld Heads': 1,
      'Programming Time Per Weld': 300, 'Batch Size': 25, 'Load Time': 22, 'Unload Allowance': 15,
    });
    const deposition = 212 * (Math.PI * 1.14 ** 2 / 4) * 0.5;
    const arc = (300 * 12.5 / deposition) * 1.05;
    const tack = (300 / 100) * 6 * 12.5 / deposition;
    const gun = 2 + arc * 0.05;
    expect(r.outputs['Arc Time']).toBeCloseTo(arc, 9);
    expect(arc).toBeCloseTo(36.39, 2);
    expect(r.outputs['Tack Time']).toBeCloseTo(tack, 9);
    expect(r.outputs['Programming Per Part']).toBeCloseTo(12, 9);
    expect(r.value).toBeCloseTo(arc + tack + gun + 22 + 15 + 12, 9);
    // The wire it uses: the weld and tack metal over arcEfficency, at the wire's density.
    expect(r.outputs['Wire Mass']).toBeCloseTo((300 * 1.06 * 12.5 / 0.5) * 7803 / 1e9, 12);
  });

  it('a plug or a tack weld is not tacked again', () => {
    const base = {
      'Weld Length': 60, 'Weld Metal Area': 12.5, Welds: 10, 'Wire Feed Rate': 148, 'Wire Diameter': 1.143, 'Arc Time Standard': 1.32,
      'Tack Length': 6, 'Tack Pitch': 100, 'Gun Placement Time': 2, 'Gun Clean Per Arc': 0.05, 'Weld Density': 7803, 'Load Time': 0, 'Unload Allowance': 10,
    };
    expect(run('Part Assembly - Manual MIG welding', { ...base, Tacked: 0 }).outputs['Tack Time']).toBe(0);
    expect(run('Part Assembly - Manual MIG welding', { ...base, Tacked: 1 }).outputs['Tack Time']).toBeGreaterThan(0);
  });

  it('spot: each spot\'s weld time and gun placement, then load and unload', () => {
    expect(run('Part Assembly - Manual spot welding', { Spots: 8, 'Spot Weld Time': 0.96, 'Gun Placement Time': 2, 'Load Time': 22, 'Unload Allowance': 15 }).value)
      .toBeCloseTo(8 * 2.96 + 37, 9);
  });

  it('laser seam: the seam at the table speed read as cm/s (2500 W, 2 mm deep: 12.70), plus load, unload and index', () => {
    const table = readCsv(join(DIR, 'Lookup/laserSeamWeldTravelSpeed.csv')).rows;
    const row = table.find((r) => Number(r['Material Cut Code Family']) === 1 && Number(r.Power) === 2500 && Number(r['Weld Depth']) === 2);
    expect(Number(row?.['Travel Speed'])).toBe(12.7);
    const r = run('Part Assembly - Laser seam welding', { 'Weld Length': 200, 'Travel Speed': 12.7, 'Load Time': 30, 'Unload Time': 15, 'Index Time': 15 });
    expect(r.outputs['Weld Time']).toBeCloseTo(200 / 127, 9);
    expect(r.value).toBeCloseTo(200 / 127 + 60, 9);
  });

  it('bevel cutting, grinding, finish grinding and wire brushing along the welds', () => {
    expect(run('Part Assembly - Bevel cutting', { 'Bevel Length': 300, Bevels: 2, 'Cut Speed': 400, 'Pierce Time': 13 }).value).toBeCloseTo(45 + 26, 9);
    expect(run('Part Assembly - Grinding', { 'Ground Length': 300, 'Grinding Speed': 10 }).value).toBeCloseTo(30, 9);
    expect(run('Part Assembly - Finish grinding', { 'Ground Length': 300, 'Grinding Speed': 10 }).value).toBeCloseTo(30, 9);
    expect(run('Part Assembly - Wire brushing', { 'Brushed Length': 300, 'Brushing Speed': 5 }).value).toBeCloseTo(60, 9);
  });
});

describe('the Part Assembly machines (migration 1098)', () => {
  it('is what the generator writes from memory/', () => {
    const committed = machinesSql();
    execFileSync('node', [join(BACKEND, 'scripts/generate-part-assembly-machines-migration.js')], { stdio: 'ignore' });
    expect(machinesSql()).toBe(committed);
  });

  it('gives every welder of memory the specs its calculator reads, by name', () => {
    for (const file of ['manual_mig_weld_machines', 'robotic_mig_weld_machines', 'manual_spot_weld_machines', 'robotic_spot_weld_machines']) {
      const source = `"source":"memory/Part Assembly/Machine/${file}.csv"`;
      for (const r of readCsv(join(DIR, `Machine/${file}.csv`)).rows) expect(machinesSql()).toContain(`$str$${r.name ?? ''}$str$, $jsonb$` + `{${source}`);
    }
  });

  it('takes from the export what the USA file lacks: manual MIG wire and tacks, robotic MIG wire feed', () => {
    const line = (name: string) => machinesSql().split('\n').find((l) => l.includes(`$str$${name}$str$, $jsonb$`)) ?? '';
    expect(line('C420 (ESAB- 50A to 420A)')).toContain('"wire_feed_rate_mm_s":190');
    expect(line('C420 (ESAB- 50A to 420A)')).toContain('"wire_diameter_mm":0.889,"weld_density_kg_per_m3":7803,"tack_pitch_mm":100');
    expect(line('Default Robotic Mig')).toContain('"wire_diameter_mm":1.14');
    expect(line('Default Robotic Mig')).toContain('"wire_feed_rate_mm_s":212');
  });

  it('restores the robotic spot welders\' 0.10 crew', () => {
    const spot = machinesSql().split('\n').filter((l) => l.includes('$str$part_assembly_robotic_spot_welding$str$') && l.includes('$jsonb$'));
    expect(spot).toHaveLength(5);
    for (const l of spot) expect(l).toMatch(/, 0\.1::numeric\)/);
  });

  it('adds the 25 India twins at the export\'s overheads and the India rate of each wage grade', () => {
    const twins = machinesSql().split('\n').filter((l) => l.startsWith('    ($str$India$str$'));
    expect(twins).toHaveLength(25);
    expect(twins.join('\n')).toContain('$str$laser_seam_welding$str$, $str$Default$str$, 3.52, 17.04, 4.92,');
    expect(twins.join('\n')).toContain('$str$part_assembly_robotic_spot_welding$str$, $str$PerformArc 52 (Panasonic)$str$, 2.75,');
    expect(twins.join('\n')).toContain('$str$bevel_cutting$str$, $str$default$str$, 1.65, 0.3, 1.27,');
  });
});

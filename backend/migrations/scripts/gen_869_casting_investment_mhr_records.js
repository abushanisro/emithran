// Generates migration 869: Casting Investment machines in HR Rates, USA rows.
// Source: memory/Casting Investment/Machine/*.csv, with the process and wage grade of each
// file from memory/Casting Investment/Processes/processes.csv and wage_grade_associations.csv.
// Excluded, and listed in the output so the exclusion is visible:
//   - cooling_machine.csv, drying_machine.csv, bench_operation_machine.csv: the "Default
//     Machine" / "Default Bench" template values, not real equipment.
//   (secondary_sand_coating_machine.csv is NOT excluded: memory/Countries data/India_XML_Data_.csv
//   confirms "Secondary Sand Coating" is its own real process with its own rate row, the same
//   machine model as Primary but a distinct category -- same pattern as Pacific Kiln PBF-60/80
//   rating three different processes. Corrected 2026-10-04; it was wrongly excluded at first.)
// Field,Value files (one machine each) are converted to one row before they are read.
// India rates are not in this migration; they follow as their own step.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseCsv, readCsv, buildMachineRows, insertSql } = require('./lib/memory-machine-seed');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const SRC = path.join(ROOT, 'memory', 'Casting Investment');
const OUT = path.join(__dirname, '..', '869_casting_investment_mhr_records.sql');
const GROUP = 'Casting Investment';

// file -> process name in memory's Processes/processes.csv (the HR Rates category).
const FILES = [
  ['band_saw_machine.csv', 'Band Saw'],
  ['belt_sand_machine.csv', 'Belt Sand'],
  ['ceramic_core_extrusion_machines.csv', 'Ceramic Core Extrusion'],
  ['ceramic_core_firing_machines.csv', 'Ceramic Core Firing'],
  ['ceramic_core_making_machines.csv', 'Ceramic Core Making'],
  ['ceramic_leaching_machines.csv', 'Ceramic Leaching'],
  ['chemical_etching_machines.csv', 'Chemical Etching'],
  ['flash_fire_dewaxing_machines.csv', 'Flash Fire De-Waxing'],
  ['knockout_machine.csv', 'Knockout'],
  ['metal_pouring_machines.csv', 'Metal Pouring'],
  ['mold_burnout_machines.csv', 'Mold Burnout'],
  ['mold_preheating_machines.csv', 'Mold Preheating'],
  ['primary_sand_coating_machine.csv', 'Primary Sand Coating'],
  ['secondary_sand_coating_machine.csv', 'Secondary Sand Coating'],
  ['primary_slurry_dipping_machines.csv', 'Primary Slurry Dipping'],
  ['robotic_assist_machines.csv', 'Robotic Assist'],
  ['secondary_slurry_dipping_machines.csv', 'Secondary Slurry Dipping'],
  ['soluble_wax_core_making_machines.csv', 'Soluble Wax Core Making'],
  ['soluble_wax_leaching_machines.csv', 'Soluble Wax Leaching'],
  ['steam_autoclave_dewaxing_machines.csv', 'Steam Autoclave De-Waxing'],
  ['wax_pattern_molding_machines.csv', 'Wax Pattern Molding'],
];
const EXCLUDED = [
  ['cooling_machine.csv', 'template "Default Machine"'],
  ['drying_machine.csv', 'template "Default Machine"'],
  ['bench_operation_machine.csv', 'template "Default Bench"'],
];

const processes = readCsv(path.join(SRC, 'Processes', 'processes.csv')).rows.map((r) => String(r['Process Name']));
const wage = readCsv(path.join(SRC, 'wage_grade_associations.csv')).rows;

const classOf = (category) => 'casting_investment_' + category.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const onDisk = fs.readdirSync(path.join(SRC, 'Machine')).filter((f) => f.endsWith('.csv')).sort();
const accounted = [...FILES.map(([f]) => f), ...EXCLUDED.map(([f]) => f)];
const unmapped = onDisk.filter((f) => !accounted.includes(f));
if (unmapped.length) throw new Error(`unmapped machine files: ${unmapped.join(', ')}`);

// A "Field,Value" file is one machine: rewrite it as a one-row table the shared builder reads.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ci869-'));
const toTable = (file) => {
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  const pairs = parseCsv(text).filter((r) => r.length >= 2);
  if (pairs[0][0] !== 'Field') return file;
  const q = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const out = path.join(tmp, path.basename(file));
  fs.writeFileSync(out, `${pairs.slice(1).map((r) => r[0]).map(q).join(',')}\n${pairs.slice(1).map((r) => q(r[1])).join(',')}\n`);
  return out;
};

// Work envelope from the real columns a file has, per axis; a missing axis is NULL, never guessed.
const pick = (cols, names) => names.find((n) => cols.includes(n)) ?? null;
const envelopeOf = (file) => {
  const cols = readCsv(file).columns;
  return [
    pick(cols, ['Bed Length (mm)', 'Max Length (mm)', 'Max Corebox Length (mm)', 'Tie Bar Distance Hor (mm)']),
    pick(cols, ['Bed Width (mm)', 'Max Width (mm)', 'Max Corebox Width (mm)', 'Tie Bar Distance Vert (mm)']),
    pick(cols, ['Bed Height (mm)', 'Max Height (mm)', 'Max Corebox Height (mm)', 'Max Mold Height (mm)']),
    pick(cols, ['Weight Capacity (kg)', 'Max Weight (kg)']),
  ];
};

const specs = FILES.map(([file, category]) => {
  if (!processes.includes(category)) throw new Error(`${file}: ${category} is not a process in processes.csv`);
  const src = path.join(SRC, 'Machine', file);
  const grade = wage.find((w) => w['Process Name'] === category)?.['Wage Grade Name'] ?? null;
  return { file: toTable(src), rel: `Casting Investment/Machine/${file}`, category, machineClass: classOf(category), grade, envelope: envelopeOf(toTable(src)) };
});

const { columns, rows, report } = buildMachineRows(specs, GROUP);

const header = `-- ============================================================================
-- Migration 869: Casting Investment machines in HR Rates (USA)
-- ============================================================================
-- Generated by scripts/gen_869_casting_investment_mhr_records.js -- do not
-- hand-edit, re-run the generator and diff instead.
--
-- Source: memory/Casting Investment/Machine (USA reference export). ${rows.length} machines:
${report.map((r) => `--   ${r.category.padEnd(28)} ${r.machineClass.padEnd(44)} ${String(r.n).padStart(2)} machine(s)  wage ${r.grade ?? '-'}`).join('\n')}
--
-- Not inserted, with the reason:
${EXCLUDED.map(([f, why]) => `--   ${f}: ${why}`).join('\n')}
-- India rates (memory/Casting Investment/Indian data) are a separate step.
--
-- Idempotent: existing rows are never overwritten (insert ... on conflict do nothing, via the
-- shared builder). Verify: SELECT count(*) FROM mhr_records WHERE process_group = '${GROUP}' AND location = 'USA';
-- expect ${rows.length}.
-- ============================================================================
`;
const sql = `${header}
${insertSql(columns, rows)}

NOTIFY pgrst, 'reload schema';
`;
fs.writeFileSync(OUT, sql, 'utf8');
console.log(`Wrote ${path.basename(OUT)}: ${rows.length} USA machines`);
for (const r of report) console.log(`  ${r.machineClass}: ${r.n} | wage ${r.grade}`);

#!/usr/bin/env node
// Generates migration 841: the Sand Casting catalog and its machines, from
// memory/Sand casting (USA reference export).
//
//   process_taxonomy             one row per Processes/processes.csv process
//   process_taxonomy_operations  one row per Processes/operations.csv entry
//   process_calculator_mappings  one row per process, inactive (no cost engine)
//   mhr_records                  every real machine in Machine/machines_*.csv
//
// Design rules (same as gen_790 / gen_826):
//   * Source of truth is the staged CSV under memory/, never a hand-kept list.
//   * A process with no cost engine is seeded roadmap_status 'not_modeled'
//     with machine_class NULL. Wiring is never invented.
//   * A machine file is matched to its process by name. The only exceptions
//     are the three CO2/No Bake/Shell coremaking files, whose process names
//     differ from the file names, and are listed explicitly below.
//   * Placeholder files ("Default" rows, not machines) are not seeded, and
//     neither are processes that have no machine file. Both are disclosed in
//     the migration header, never silently dropped.
//   * 'User-Defined Process' is a UI placeholder and 'No Cost Feature' is not
//     a manufacturing process; both are skipped, same as migration 790.
//
// Run: node backend/migrations/scripts/gen_851_seed_sand_casting_catalog_and_machines.js

const fs = require('fs');
const path = require('path');
const { readCsv, sqlStr, buildMachineRows, insertSql } = require('./lib/memory-machine-seed');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const SRC = path.join(ROOT, 'memory', 'Sand casting');
const OUT = path.join(__dirname, '..', '851_seed_sand_casting_catalog_and_machines.sql');
const GROUP = 'Sand Casting';
const SKIP_PROCESS = new Set(['User-Defined Process']);
const NON_MFG = new Set(['No Cost Feature']);
const classOf = (process) => 'sand_casting_' + process.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

// Machine files whose name is not their process name. Named explicitly, not
// fuzzy-matched, so a wrong pairing cannot slip in silently.
const FILE_ALIAS = {
  'machines_co2_coremaking.csv': 'CO2 Cured',
  'machines_no_bake_coremaking.csv': 'No Bake',
  'machines_shell_coremaking.csv': 'Shell',
};
// Files whose source carries no overhead-rate columns at all. Seeded with
// their overhead rates NULL (never derived), so the HR Rates page shows the
// honest gap rather than a made-up rate.
const RATES_ABSENT_FILES = new Set(['machines_melting.csv']);
// Placeholder files: a single "Default" rate row, not a machine.
const PLACEHOLDER_FILES = new Set(['machines_default_2.csv', 'machines_default_3.csv', 'machines_stock_core.csv']);

const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

const processesCsv = readCsv(path.join(SRC, 'Processes', 'processes.csv'));
const processes = processesCsv.rows
  .map((r, i) => ({
    name: String(r['Process Name']),
    tool: r['Default Tool Shop Name'] ?? null,
    machine: r['Default Machine'] ?? null,
    order: 800 + i,
  }))
  .filter((p) => !SKIP_PROCESS.has(p.name) && !NON_MFG.has(p.name));
const processNames = new Set(processes.map((p) => p.name));
const wage = readCsv(path.join(SRC, 'wage_grade_associations.csv')).rows;
const gradeOf = (p) => wage.find((w) => w['Process Name'] === p)?.['Wage Grade Name'] ?? null;

// ── Machines ────────────────────────────────────────────────────────────────
const machineDir = path.join(SRC, 'Machine');
const machineFiles = fs.readdirSync(machineDir).filter((f) => f.endsWith('.csv')).sort();
const placeholders = [];
const files = [];
const unmappedFiles = [];
for (const file of machineFiles) {
  if (PLACEHOLDER_FILES.has(file)) { placeholders.push(file); continue; }
  const proc = FILE_ALIAS[file] ?? processes.find((p) => normalize(p.name) === normalize(file.replace(/^machines_/, '').replace(/\.csv$/, '')))?.name;
  if (!proc) { unmappedFiles.push(file); continue; }
  const hasOverheadColumns = readCsv(path.join(machineDir, file)).columns.some((c) => /overhead rate/i.test(c));
  if (RATES_ABSENT_FILES.has(file) && hasOverheadColumns) throw new Error(`${file} now carries overhead rates: drop it from RATES_ABSENT_FILES`);
  files.push({
    file: path.join(machineDir, file),
    rel: `Sand casting/Machine/${file}`,
    category: proc,
    categoryColumn: null,
    classOf: () => classOf(proc),
    gradeOf: () => gradeOf(proc),
    envelope: [null, null, null, null],
    ratesAbsentInSource: RATES_ABSENT_FILES.has(file),
  });
}
if (unmappedFiles.length) throw new Error(`machine files with no matching process: ${unmappedFiles.join(', ')}`);

const { columns, rows, report } = buildMachineRows(files, GROUP);
const machinedProcesses = new Set(files.map((f) => f.category));
const noMachineProcesses = processes.map((p) => p.name).filter((n) => !machinedProcesses.has(n));

// ── Operations ──────────────────────────────────────────────────────────────
// "Process:Category//Feature[:Category//Feature...]" - the leaf pair is kept
// typed, the full string verbatim (same split as gen_790).
function parseCompound(raw) {
  const segments = raw.split(':');
  const levels = segments.slice(1).map((seg) => {
    const i = seg.indexOf('//');
    return i === -1 ? { operation: seg, feature: null } : { operation: seg.slice(0, i), feature: seg.slice(i + 2) };
  });
  const leaf = levels[levels.length - 1] || { operation: null, feature: null };
  return { process: segments[0], operationCategory: leaf.operation, featureType: leaf.feature };
}
const opsCsv = readCsv(path.join(SRC, 'Processes', 'operations.csv'));
const operations = opsCsv.rows.map((r) => ({ raw: String(r['Process Name']), ...parseCompound(String(r['Process Name'])) }));
const unknownOpProcesses = [...new Set(operations.map((o) => o.process))].filter((p) => !processNames.has(p) && !SKIP_PROCESS.has(p) && !NON_MFG.has(p));
if (unknownOpProcesses.length) throw new Error(`operations name processes not in processes.csv: ${unknownOpProcesses.join(', ')}`);
const keptOperations = operations.filter((o) => processNames.has(o.process));

// ── SQL ─────────────────────────────────────────────────────────────────────
const q = (s) => (s == null || s === '' ? 'NULL' : sqlStr(s));
const taxValues = processes.map((p) => `  (${sqlStr(GROUP)}, ${sqlStr(p.name)}, NULL, 'not_modeled', ${q(p.machine)}, ${q(p.tool)}, ${p.order})`).join(',\n');
const opValues = keptOperations.map((o) => `  (${sqlStr(GROUP)}, ${sqlStr(o.process)}, ${q(o.operationCategory)}, ${q(o.featureType)}, ${sqlStr(o.raw)})`).join(',\n');
const mapValues = processes.map((p) => `  (${sqlStr(GROUP)}, ${sqlStr(p.name)}, ${p.order})`).join(',\n');

// Machines go in chunks: each INSERT stays under the SQL editor's size limit.
const CHUNK = 60;
const machineParts = [];
for (let i = 0; i < rows.length; i += CHUNK) machineParts.push(rows.slice(i, i + CHUNK));

const header = `-- ============================================================================
-- Migration 851: Sand Casting catalog and machines
-- ============================================================================
-- Generated by scripts/gen_851_seed_sand_casting_catalog_and_machines.js --
-- do not hand-edit, re-run the generator and diff instead.
--
-- Source: memory/Sand casting (USA reference export).
--   process_taxonomy             ${processes.length} processes (process_group '${GROUP}', not_modeled)
--   process_taxonomy_operations  ${keptOperations.length} operations
--   process_calculator_mappings  ${processes.length} rows, inactive (no cost engine built)
--   mhr_records                  ${rows.length} machines (class sand_casting_<process>)
--
-- Machine files -> processes:
${report.map((r) => `--   ${path.basename(r.rel).padEnd(42)} ${String(r.n).padStart(3)} row(s)`).join('\n')}
--
-- Not seeded (disclosed):
--   placeholder files (one "Default" rate row, not a machine): ${placeholders.join(', ')}
--   processes with no machine file: ${noMachineProcesses.join(', ') || 'none'}
--
-- Run order: this file once. Every statement is idempotent (ON CONFLICT or
-- NOT EXISTS), so a part may be re-run safely. Part 1 is the catalog; parts
-- 2..n are machines, each under the SQL editor's size limit.
-- ============================================================================
`;

const catalog = `-- ── 1a. process_taxonomy
INSERT INTO process_taxonomy (process_group, process_name, machine_class, roadmap_status, default_machine_name, default_tool_shop_name, display_order)
VALUES
${taxValues}
ON CONFLICT (process_group, process_name) DO NOTHING;

-- ── 1b. process_taxonomy_operations
INSERT INTO process_taxonomy_operations (canonical_process_id, operation_category, feature_type, raw_compound_string)
SELECT pt.id, v.operation_category, v.feature_type, v.raw
FROM process_taxonomy pt
JOIN (VALUES
${opValues}
) AS v(process_group, process_name, operation_category, feature_type, raw)
  ON pt.process_group = v.process_group AND pt.process_name = v.process_name
ON CONFLICT (canonical_process_id, raw_compound_string) DO NOTHING;

-- ── 1c. process_calculator_mappings (inactive: no cost engine)
INSERT INTO process_calculator_mappings (process_group, process_route, operation, calculator_id, calculator_name, is_active, display_order, machine_class, canonical_process_id)
SELECT v.grp, v.name, v.name, NULL, NULL, false, v.display_order, NULL, pt.id
FROM process_taxonomy pt
JOIN (VALUES
${mapValues}
) AS v(grp, name, display_order)
  ON pt.process_group = v.grp AND pt.process_name = v.name
ON CONFLICT (process_group, process_route, operation) DO NOTHING;

NOTIFY pgrst, 'reload schema';
`;

// Part 1 = header + catalog; parts 2..n = machines.
const parts = [`${header}\n${catalog}`];
machineParts.forEach((chunk, i) => {
  parts.push(`-- ── 2.${i + 1} machines ${i * CHUNK + 1}-${i * CHUNK + chunk.length} of ${rows.length}\n${insertSql(columns, chunk)}\n`);
});

const BASE_NAME = path.basename(OUT, '.sql');
const OUT_DIR = path.dirname(OUT);
for (const old of fs.readdirSync(OUT_DIR).filter((n) => n.startsWith(`${BASE_NAME}_part`))) {
  fs.unlinkSync(path.join(OUT_DIR, old));
}
parts.forEach((p, i) => {
  fs.writeFileSync(path.join(OUT_DIR, `${BASE_NAME}_part${i + 1}of${parts.length}.sql`), p, 'utf8');
});
console.log(`Wrote ${parts.length} part(s): ${processes.length} processes, ${keptOperations.length} operations, ${rows.length} machines`);
console.log(`placeholders not seeded: ${placeholders.join(', ')}`);
console.log(`processes with no machine file: ${noMachineProcesses.join(', ') || 'none'}`);

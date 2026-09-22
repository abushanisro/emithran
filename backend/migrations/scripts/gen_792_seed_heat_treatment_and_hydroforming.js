// Generator: seeds the two remaining real memory/ process sources that
// gen_790 missed -- Heat Treatment and Sheet Metal - Hydroforming -- found by
// a full-tree sweep for any CSV file carrying a "Process Name" header or a
// compound "Process:Category//Feature" string, not just the 9 top-level
// operations.csv files gen_790 already covered. Writes migrations/792_*.sql.
// Same design rules as gen_790 (see that file's own header) -- reused
// verbatim here, not re-derived, since both scripts must treat the same real
// data shape identically.
//
// Run:  node backend/migrations/scripts/gen_792_seed_heat_treatment_and_hydroforming.js

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..', '..');
const MEMORY = path.join(REPO, 'memory');
const OUT_SQL = path.join(REPO, 'backend', 'migrations', '792_seed_heat_treatment_and_hydroforming.sql');
const OUT_REPORT = path.join(REPO, 'backend', 'migrations', 'scripts', '792_unresolved.json');

// Group names match migration 302's real seeded catalog vocabulary exactly
// ('Heat Treatment' position 13, 'Sheet Metal - Hydroforming' position 24).
const GROUPS = [
  { group: 'Heat Treatment', dir: 'Heat treatment', processes: 'processes.csv', operations: null },
  { group: 'Sheet Metal - Hydroforming', dir: 'Sheetmetal Hydroforming', processes: 'processes_default_machines.csv', operations: 'operations (6).csv' },
];

const SKIP_PROCESS = new Set(['User-Defined Process']);
const NON_MFG = new Set(['No Cost Feature', 'Coil Material Stock', 'Sheet Material Stock']);

function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

function readTable(dir, file) {
  const p = path.join(MEMORY, dir, file);
  if (!fs.existsSync(p)) throw new Error(`Missing source file: ${p}`);
  const rows = parseCsv(fs.readFileSync(p, 'utf8'));
  const header = rows[0].map((h) => h.trim());
  return { header, rows: rows.slice(1).map((r) => r.map((x) => x.trim())) };
}

function parseCompound(raw) {
  const segments = raw.split(':');
  const levels = segments.slice(1).map((seg) => {
    const i = seg.indexOf('//');
    return i === -1 ? { operation: seg, feature: null } : { operation: seg.slice(0, i), feature: seg.slice(i + 2) };
  });
  const leaf = levels[levels.length - 1] || { operation: null, feature: null };
  return { process: segments[0], operationCategory: leaf.operation, featureType: leaf.feature };
}

const q = (s) => (s == null || s === '' ? 'NULL' : `$str$${s}$str$`);

const report = { skippedProcesses: [], unresolvedOperations: [] };
const processRows = [];
const operationRows = [];
const counts = {};

GROUPS.forEach((g, gi) => {
  const proc = readTable(g.dir, g.processes);
  const nameIdx = proc.header.findIndex((h) => h.toLowerCase().startsWith('process name'));
  const shopIdx = proc.header.findIndex((h) => h.toLowerCase() === 'default tool shop name');
  const machIdx = proc.header.findIndex((h) => h.toLowerCase() === 'default machine');
  if (nameIdx === -1) throw new Error(`${g.dir}/${g.processes}: no "Process Name" column`);

  const seen = new Set();
  let order = 1600 + gi * 100;
  for (const r of proc.rows) {
    const name = r[nameIdx];
    if (!name) continue;
    if (SKIP_PROCESS.has(name)) { report.skippedProcesses.push({ group: g.group, name, reason: 'UI placeholder, no data' }); continue; }
    if (seen.has(name)) continue;
    seen.add(name);
    processRows.push({
      group: g.group,
      name,
      machine: machIdx === -1 ? '' : r[machIdx],
      shop: shopIdx === -1 ? '' : r[shopIdx],
      order: order++,
      roadmap: NON_MFG.has(name) ? 'non_mfg' : 'not_modeled',
    });
  }

  let opCount = 0;
  if (g.operations) {
    const ops = readTable(g.dir, g.operations);
    const opIdx = ops.header.findIndex((h) => h.toLowerCase().startsWith('process name'));
    if (opIdx === -1) throw new Error(`${g.dir}/${g.operations}: no "Process Name" column`);
    const seenRaw = new Set();
    for (const r of ops.rows) {
      const raw = r[opIdx];
      if (!raw || seenRaw.has(raw)) continue;
      seenRaw.add(raw);
      const p = parseCompound(raw);
      if (!seen.has(p.process)) {
        report.unresolvedOperations.push({ group: g.group, raw, reason: `process "${p.process}" is not in ${g.processes}` });
        continue;
      }
      operationRows.push({ group: g.group, process: p.process, category: p.operationCategory, feature: p.featureType, raw });
      opCount++;
    }
  }
  counts[g.group] = { processes: seen.size, operations: opCount };
});

const totalProc = processRows.length;
const totalOps = operationRows.length;
const groupLines = GROUPS.map((g) => `--   ${g.group.padEnd(28)} <- memory/${g.dir}  (${counts[g.group].processes} processes, ${counts[g.group].operations} operations)`).join('\n');

let sql = `-- ============================================================================
-- Migration 792: Seed Heat Treatment and Sheet Metal - Hydroforming -- the
-- two remaining real memory/ process sources gen_790 missed
-- ============================================================================
-- Generated by scripts/gen_792_seed_heat_treatment_and_hydroforming.js -- do
-- not hand-edit, re-run the generator and diff instead.
--
-- gen_790 scanned only the top-level operations.csv/processes.csv per source
-- folder. A full-tree sweep (grep every CSV in memory/ for a "Process Name"
-- header or a compound Process:Category//Feature string) found two real
-- sources it never reached, both matching a catalog group name migration 302
-- already seeded as an empty placeholder:
--
${groupLines}
--
-- ${totalProc} processes and ${totalOps} operation rows. Same discipline as 790: no
-- machine_class or calculator is guessed (roadmap_status not_modeled,
-- machine_class NULL); No Cost Feature and the two bare Material Stock rows
-- (Coil/Sheet -- staging markers, not a manufacturing step, same real pattern
-- already used for Material Stock/No Cost Feature everywhere else) are non_mfg;
-- User-Defined Process is skipped (a UI placeholder with no data behind it).
-- Mapping rows are inserted INACTIVE for the same reason 790's own header
-- documents: chk_machine_class_required (migrations 369/617/756) rejects an
-- ACTIVE row with NULL machine_class, and an inactive row is the established
-- way this catalog already shows a real, disclosed, not-yet-costed process.
--
-- Heat Treatment has 0 operation rows on file (only a process + default
-- machine list exists in memory/Heat treatment) -- a real, disclosed gap,
-- same shape as Forging in migration 790, not something this migration can
-- fabricate. Sheet Metal - Hydroforming has real, rich, multi-level feature
-- detail (e.g. "Hydroform:Hydroform Deep Draw:Clean Tooling//ComplexHole").
--
-- Does not touch the frozen Sheet Metal cutting/forming domain or its
-- registered engines -- 'Sheet Metal - Hydroforming' is its own catalog
-- group (migration 302, a distinct row from plain 'Sheet Metal'), and this
-- migration only adds catalog/taxonomy rows, the same additive-only class of
-- change as every other group 790 already seeded.
-- ============================================================================

BEGIN;

INSERT INTO process_taxonomy (process_group, process_name, machine_class, roadmap_status, default_machine_name, default_tool_shop_name, display_order)
VALUES
${processRows.map((r) => `(${q(r.group)}, ${q(r.name)}, NULL, '${r.roadmap}', ${q(r.machine)}, ${q(r.shop)}, ${r.order})`).join(',\n')}
ON CONFLICT (process_group, process_name) DO UPDATE
SET default_machine_name = COALESCE(process_taxonomy.default_machine_name, EXCLUDED.default_machine_name),
    default_tool_shop_name = COALESCE(process_taxonomy.default_tool_shop_name, EXCLUDED.default_tool_shop_name);

INSERT INTO process_taxonomy_operations (canonical_process_id, operation_category, feature_type, raw_compound_string)
SELECT pt.id, v.operation_category, v.feature_type, v.raw
FROM process_taxonomy pt
JOIN (VALUES
${operationRows.map((o) => `(${q(o.group)}, ${q(o.process)}, ${q(o.category)}, ${q(o.feature)}, ${q(o.raw)})`).join(',\n')}
) AS v(grp, proc, operation_category, feature_type, raw)
  ON pt.process_group = v.grp AND pt.process_name = v.proc
ON CONFLICT (canonical_process_id, raw_compound_string) DO NOTHING;

INSERT INTO process_calculator_mappings (process_group, process_route, operation, calculator_id, calculator_name, is_active, display_order, machine_class, canonical_process_id)
SELECT v.grp, v.name, v.name, NULL, NULL, false, v.display_order, NULL, pt.id
FROM process_taxonomy pt
JOIN (VALUES
${processRows.map((r) => `(${q(r.group)}, ${q(r.name)}, ${r.order})`).join(',\n')}
) AS v(grp, name, display_order)
  ON pt.process_group = v.grp AND pt.process_name = v.name
WHERE NOT EXISTS (
  SELECT 1 FROM process_calculator_mappings m WHERE m.process_group = v.grp AND m.operation = v.name
)
ON CONFLICT (process_group, process_route, operation) DO NOTHING;

COMMIT;

-- Verification (run manually after):
-- SELECT process_group, count(*) FROM process_calculator_mappings
--   WHERE process_group IN ('Heat Treatment', 'Sheet Metal - Hydroforming') GROUP BY 1;
-- SELECT operation, array_length(array_agg(o.id), 1) AS ops FROM process_calculator_mappings m
--   JOIN process_taxonomy pt ON pt.id = m.canonical_process_id
--   LEFT JOIN process_taxonomy_operations o ON o.canonical_process_id = pt.id
--   WHERE m.process_group = 'Sheet Metal - Hydroforming' GROUP BY 1 ORDER BY 1;
`;

fs.writeFileSync(OUT_SQL, sql, 'utf8');
fs.writeFileSync(OUT_REPORT, JSON.stringify({ counts, ...report }, null, 2) + '\n', 'utf8');
console.log(`wrote ${path.relative(REPO, OUT_SQL)}`);
console.log(`processes=${totalProc} operations=${totalOps}`);
console.log(counts);
console.log('skipped:', report.skippedProcesses.length, '| unresolved ops:', report.unresolvedOperations.length);

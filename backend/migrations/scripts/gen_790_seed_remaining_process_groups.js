// Generator: seeds every remaining memory/ process + operation source into the
// live Process Calculator Mappings catalog (process_taxonomy +
// process_taxonomy_operations + process_calculator_mappings), and re-homes the
// two Post Processing rows that live costing is wired to, then removes the
// now-empty Post Processing group. Writes migrations/790_*.sql and a JSON
// report of anything that could not be resolved -- nothing is dropped silently.
//
// Run:  node backend/migrations/scripts/gen_790_seed_remaining_process_groups.js
//
// Design rules (same discipline as gen_609 / gen_691):
//   * Source of truth is the staged CSV under memory/, never a hand-kept list.
//   * A group with no real cost engine is seeded as roadmap_status
//     'not_modeled' with machine_class NULL. Wiring is never invented; a
//     capability gap is disclosed, not filled.
//   * Existing wired rows are never downgraded: ON CONFLICT keeps the live
//     machine_class / roadmap_status and only fills missing defaults.
//   * 'User-Defined Process' is a UI placeholder with no data behind it and is
//     absent from every already-seeded group, so it is not seeded here either.

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..', '..');
const MEMORY = path.join(REPO, 'memory');
const OUT_SQL = path.join(REPO, 'backend', 'migrations', '790_seed_remaining_memory_process_groups.sql');
const OUT_REPORT = path.join(REPO, 'backend', 'migrations', 'scripts', '790_unresolved.json');

// catalog group  <-  memory folder. Group names follow the catalog vocabulary
// already seeded by migration 302 (PCB, Part Assembly, Other Secondary
// Processes, ...), not the folder spelling.
const GROUPS = [
  { group: 'Additive Manufacturing',    dir: 'Additive Manufacturing', processes: 'processes.csv',                          operations: 'operations.csv' },
  { group: 'Assembly',                  dir: 'Assembly',               processes: 'processes (1).csv',                      operations: 'operations.csv' },
  { group: 'Part Assembly',             dir: 'Part Assembly',          processes: 'processes_welding_group.csv',            operations: 'operations_welding_group.csv' },
  { group: 'Composites',                dir: 'Composites',             processes: 'processes.csv',                          operations: 'operations.csv' },
  { group: 'PCB',                       dir: 'PCBA',                   processes: 'processes.csv',                          operations: 'operations.csv' },
  { group: 'Surface Treatment',         dir: 'SurfaceTreatment',       processes: 'surface_treatment_processes.csv',        operations: 'surface_treatment_operations.csv' },
  { group: 'Forging',                   dir: 'Forging',                processes: 'forging_processes.csv',                  operations: null },
  { group: 'Other Secondary Processes', dir: 'secondary process',      processes: 'processes.csv',                          operations: null },
  { group: 'Stock Machining',           dir: 'Stock Maching',          processes: 'processes.csv',                          operations: 'operations.csv' },
];

const SKIP_PROCESS = new Set(['User-Defined Process']);
const NON_MFG = new Set(['No Cost Feature', 'Material Stock']);

// Minimal RFC-4180 CSV parser (quotes, embedded commas/newlines, BOM, CRLF).
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

// Same split gen_609 uses: "Process:Category//Feature[:Category//Feature...]",
// leaf pair kept typed, full string preserved verbatim.
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

const report = { skippedProcesses: [], unresolvedOperations: [], notSeeded: [] };
const processRows = [];   // { group, name, machine, shop, order, roadmap }
const operationRows = []; // { group, process, category, feature, raw }
const counts = {};

GROUPS.forEach((g, gi) => {
  const proc = readTable(g.dir, g.processes);
  const nameIdx = proc.header.findIndex((h) => h.toLowerCase() === 'process name');
  const shopIdx = proc.header.findIndex((h) => h.toLowerCase() === 'default tool shop name');
  const machIdx = proc.header.findIndex((h) => h.toLowerCase() === 'default machine');
  if (nameIdx === -1) throw new Error(`${g.dir}/${g.processes}: no "Process Name" column`);

  const seen = new Set();
  let order = 700 + gi * 100;
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
    // First column holds the compound string; Assembly names it "Process Name (raw)".
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

report.notSeeded.push(
  { source: '2 Mold Molding', reason: 'Only 3 operation rows (Source Component:As Supplied//...) and no process list, so there is no process to attach them to and no confirmed catalog group. Needs a decision.' },
  { source: 'Multi-Spindle Maching', reason: 'multi_spindle_processes.csv and multi_spindle_operations.csv contain only a header and one placeholder row; nothing real to seed.' },
);

// ── SQL ────────────────────────────────────────────────────────────────────
const totalProc = processRows.length;
const totalOps = operationRows.length;
const groupLines = GROUPS.map((g) => `--   ${g.group.padEnd(26)} <- memory/${g.dir}  (${counts[g.group].processes} processes, ${counts[g.group].operations} operations)`).join('\n');

let sql = `-- ============================================================================
-- Migration 790: Seed every remaining memory/ process + operation source into
-- the Process Calculator Mappings catalog, and retire the Post Processing group
-- ============================================================================
-- Generated by scripts/gen_790_seed_remaining_process_groups.js -- do not
-- hand-edit, re-run the generator and diff instead.
--
-- WHY
--
-- The catalog is scoped to named source folders (migrations 731 and 736).
-- Nine source folders under memory/ were never seeded, so their processes and
-- operations were absent from the Process page. Each is added under the group
-- name the catalog already uses (migration 302):
--
${groupLines}
--
-- ${totalProc} processes and ${totalOps} operation rows in total. Machines are NOT seeded here;
-- that is separate work against mhr_records.
--
-- NEW ROWS ARE NOT WIRED TO A COST ENGINE, SO THEY ARE SEEDED INACTIVE
--
-- None of these groups has a registered costing engine, so every process is
-- seeded roadmap_status not_modeled with machine_class NULL. No machine class or
-- calculator is guessed. No Cost Feature and Material Stock are non_mfg markers,
-- as in migration 609. User-Defined Process is a placeholder with no data behind
-- it and is not present in any already-seeded group, so it is skipped.
--
-- The mapping rows are inserted with is_active = false. The table CHECK
-- chk_machine_class_required (migrations 369, 617, 756) rejects any ACTIVE row
-- with a NULL machine_class unless it is a named non-machine exemption. A first
-- draft of this migration inserted them active, the check rejected the insert,
-- and the whole transaction rolled back, leaving the page unchanged. Inactive is
-- also the established convention (migration 756): a real process with no
-- machine class yet stays visible on the Process page as inactive, an honest
-- view of what is built versus not. The two re-homed rows below stay active
-- because they carry a real machine_class. Activating a marker such as No Cost
-- Feature would need its own named exemption in that check, as 617 and 756 did,
-- and is deliberately not done here.
--
-- THE TWO POST PROCESSING ROWS WERE NOT DISPOSABLE
--
-- Post Processing held exactly two rows, and migration 731 established both are
-- wired to real registered engines:
--   Surface Treatment  -> surface_treatment  (real surface-treatment calculator)
--   CMM Inspection     -> cmm
-- Deleting them would break the Add Operation picker and workflow validation.
-- Their real homes are the groups seeded below (Surface Treatment, and Other
-- Secondary Processes where memory/secondary process lists CMM Inspection), so
-- they are MOVED, keeping id, machine_class and calculator link, and only then
-- is the empty Post Processing group removed. A guard aborts the migration if
-- anything wired or referenced by mhr_records would be lost.
--
-- NOT SEEDED (see scripts/790_unresolved.json)
--   2 Mold Molding        operation rows only, no process list, no confirmed group.
--   Multi-Spindle Maching source files hold only a header row; nothing real.
-- ============================================================================

BEGIN;

-- ── Step 1: re-home the two wired Post Processing rows ─────────────────────
-- Taxonomy first (its id is what mappings and mhr_records point at, so moving
-- the row keeps every link intact). The NOT EXISTS guard keeps a re-run safe.
--
-- Labour is not moved with the group: every line is billed at its own
-- machine labour rate (memory/-backed mhr_records), so lhr_process_group is
-- left as it is (migration 839 cleared the old Post Processing tier).
UPDATE process_taxonomy pt
SET process_group = 'Surface Treatment'
WHERE pt.process_group = 'Post Processing' AND pt.process_name = 'Surface Treatment'
  AND NOT EXISTS (SELECT 1 FROM process_taxonomy x WHERE x.process_group = 'Surface Treatment' AND x.process_name = 'Surface Treatment');

UPDATE process_taxonomy pt
SET process_group = 'Other Secondary Processes'
WHERE pt.process_group = 'Post Processing' AND pt.process_name = 'CMM Inspection'
  AND NOT EXISTS (SELECT 1 FROM process_taxonomy x WHERE x.process_group = 'Other Secondary Processes' AND x.process_name = 'CMM Inspection');

UPDATE process_calculator_mappings m
SET process_group = 'Surface Treatment'
WHERE m.process_group = 'Post Processing' AND m.operation = 'Surface Treatment'
  AND NOT EXISTS (SELECT 1 FROM process_calculator_mappings x
                  WHERE x.process_group = 'Surface Treatment' AND x.process_route = m.process_route AND x.operation = m.operation);

UPDATE process_calculator_mappings m
SET process_group = 'Other Secondary Processes'
WHERE m.process_group = 'Post Processing' AND m.operation = 'CMM Inspection'
  AND NOT EXISTS (SELECT 1 FROM process_calculator_mappings x
                  WHERE x.process_group = 'Other Secondary Processes' AND x.process_route = m.process_route AND x.operation = m.operation);

-- ── Step 2: process_taxonomy ───────────────────────────────────────────────
-- ON CONFLICT only fills MISSING defaults. It never touches machine_class or
-- roadmap_status, so a row that is already wired (the two re-homed above)
-- keeps its live wiring.
INSERT INTO process_taxonomy (process_group, process_name, machine_class, roadmap_status, default_machine_name, default_tool_shop_name, display_order)
VALUES
${processRows.map((r) => `(${q(r.group)}, ${q(r.name)}, NULL, '${r.roadmap}', ${q(r.machine)}, ${q(r.shop)}, ${r.order})`).join(',\n')}
ON CONFLICT (process_group, process_name) DO UPDATE
SET default_machine_name = COALESCE(process_taxonomy.default_machine_name, EXCLUDED.default_machine_name),
    default_tool_shop_name = COALESCE(process_taxonomy.default_tool_shop_name, EXCLUDED.default_tool_shop_name);

-- ── Step 3: process_taxonomy_operations ────────────────────────────────────
INSERT INTO process_taxonomy_operations (canonical_process_id, operation_category, feature_type, raw_compound_string)
SELECT pt.id, v.operation_category, v.feature_type, v.raw
FROM process_taxonomy pt
JOIN (VALUES
${operationRows.map((o) => `(${q(o.group)}, ${q(o.process)}, ${q(o.category)}, ${q(o.feature)}, ${q(o.raw)})`).join(',\n')}
) AS v(grp, proc, operation_category, feature_type, raw)
  ON pt.process_group = v.grp AND pt.process_name = v.proc
ON CONFLICT (canonical_process_id, raw_compound_string) DO NOTHING;

-- ── Step 4: process_calculator_mappings (what the Process page lists) ──────
-- Inserted inactive so they satisfy chk_machine_class_required (see header).
-- The WHERE NOT EXISTS skips any operation that already has a mapping in its
-- group, so the re-homed CMM Inspection row (route Inspection) is not
-- duplicated under a second route.
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

-- ── Step 5: guard, then retire the empty Post Processing group ─────────────
DO $guard$
DECLARE
  wired integer;
  referenced integer;
BEGIN
  SELECT count(*) INTO wired
  FROM process_calculator_mappings
  WHERE process_group = 'Post Processing' AND machine_class IS NOT NULL;

  SELECT count(*) INTO referenced
  FROM mhr_records mr
  JOIN process_taxonomy pt ON pt.id = mr.canonical_process_id
  WHERE pt.process_group = 'Post Processing';

  IF wired > 0 OR referenced > 0 THEN
    RAISE EXCEPTION 'Post Processing still has % wired mapping row(s) and % mhr_records reference(s) after the re-home; refusing to delete. Inspect and re-home them first.', wired, referenced;
  END IF;
END
$guard$;

DELETE FROM process_calculator_mappings WHERE process_group = 'Post Processing';
DELETE FROM process_taxonomy WHERE process_group = 'Post Processing';

COMMIT;

-- Verification (run manually after):
-- SELECT process_group, count(*) FROM process_calculator_mappings GROUP BY 1 ORDER BY 1;
-- SELECT count(*) FROM process_calculator_mappings WHERE process_group = $pp$Post Processing$pp$;  -- expect 0
-- SELECT process_group, operation, machine_class, lhr_process_group FROM process_calculator_mappings
--   WHERE operation IN ($pp$Surface Treatment$pp$, $pp$CMM Inspection$pp$);  -- machine_class must still be set
`;

fs.writeFileSync(OUT_SQL, sql, 'utf8');
fs.writeFileSync(OUT_REPORT, JSON.stringify({ counts, ...report }, null, 2) + '\n', 'utf8');
console.log(`wrote ${path.relative(REPO, OUT_SQL)}`);
console.log(`processes=${totalProc} operations=${totalOps}`);
console.log(counts);
console.log('skipped:', report.skippedProcesses.length, '| unresolved ops:', report.unresolvedOperations.length);

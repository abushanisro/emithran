#!/usr/bin/env node
// Generates migration 864: the HR Rates "Machine & Process Lookup" record
// (mhr_records.specs) for the machines seeded before specs existed.
//
// Migrations 793-797 (Additive Manufacturing, Assembly, Part Assembly,
// Composites, PCB) and 806 (CMM Inspection) ran while mhr_records had no specs
// column (dropped by 563, restored by 814a), so their machines carry the
// rates but not the rest of their source row, and the edit dialog's lookup
// shows "No machine_library reference match found". Later seeds (815-862)
// write specs at insert; this gives the earlier ones the same record.
//
// Each machine is identified by the (machine_class, machine_name) its own
// migration inserted -- read back from that migration's SQL, never re-derived
// -- and matched to its row in the memory/ csv that migration read:
//   * one csv row of that name in the folder: that row;
//   * several: the one whose file name is the machine class (pcb's
//     apply_photo_resist <- apply_photo_resist.csv), else, when every
//     candidate row is identical, that row;
//   * anything else is listed in the header, not guessed.
// specs = provenance + every column without an mhr_records column of its own
// (scripts/lib/memory-machine-seed.js specsOf, the 845/851/862 shape). The
// UPDATE matches every location, so 829's India copies get the record too,
// and only fills specs that are empty: a value set since is never overwritten.
//
// Run: node backend/migrations/scripts/gen_864_backfill_machine_specs.js

const fs = require('fs');
const path = require('path');
const { readMachineTable, specsOf, specColumns, sqlStr, sqlJsonb } = require('./lib/memory-machine-seed');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const MIG = path.join(__dirname, '..');
const OUT = path.join(MIG, '864_backfill_machine_specs.sql');

// gen_797's own file -> process map (its FILES literal), the machine class of
// each process derived exactly as gen_797 does. PCB file names do not follow
// the class names (rack_oven_machines.csv serves cure_solder_mask), so the
// map is read from that generator rather than inferred.
function classFilesOf797() {
  const src = fs.readFileSync(path.join(__dirname, 'gen_797_seed_pcb_mhr_records.js'), 'utf8');
  const snake = (n) => n.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const map = {};
  for (const m of src.matchAll(/\{ file: '([^']+)', processes: \[([^\]]*)\](?:, machineClassOverride: '([^']+)')? \}/g)) {
    for (const p of [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1])) map[m[3] || snake(p)] = m[1];
  }
  if (Object.keys(map).length < 20) throw new Error('gen_797 file map not found');
  return map;
}

const SOURCES = [
  { migration: '793_seed_additive_manufacturing_mhr_records.sql', group: 'Additive Manufacturing', dir: 'Additive Manufacturing/Machine' },
  { migration: '794_seed_assembly_mhr_records.sql', group: 'Assembly', dir: 'Assembly/Machines' },
  { migration: '795_seed_part_assembly_mhr_records.sql', group: 'Part Assembly', dir: 'Part Assembly/Machine' },
  { migration: '796_seed_composites_mhr_records.sql', group: 'Composites', dir: 'Composites/Machine' },
  { migration: '797_seed_pcb_mhr_records.sql', group: 'PCB', dir: 'PCBA/Machine', classFiles: classFilesOf797() },
  { migration: '806_seed_cmm_inspection_mhr_records.sql', group: 'CMM Inspection', dir: 'Secondary process/machines', only: 'cmm_inspection_machines.csv' },
];

const norm = (s) => String(s).toLowerCase().replace(/\(\d+\)/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const stem = (f) => norm(path.basename(f, '.csv').replace(/^machines?_(default_)?/i, '').replace(/_machines?$/i, ''));

function csvFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...csvFiles(p));
    else if (e.name.toLowerCase().endsWith('.csv')) out.push(p);
  }
  return out.sort();
}

// (machine_class, machine_name) of every row a seed migration inserted: the
// first and third $str$ literals of each VALUES tuple.
function insertedMachines(file) {
  const out = [];
  for (const line of fs.readFileSync(path.join(MIG, file), 'utf8').split(/\r?\n/)) {
    if (!/^\s*\(\$str\$/.test(line)) continue;
    const lits = [...line.matchAll(/\$str\$(.*?)\$str\$/g)].map((m) => m[1]);
    if (lits.length < 3) continue;
    out.push({ cls: lits[0], name: lits[2] });
  }
  return out;
}

const sections = [];
const summary = [];
for (const s of SOURCES) {
  const dir = path.join(ROOT, 'memory', s.dir);
  const files = csvFiles(dir).filter((f) => !s.only || path.basename(f) === s.only);
  const byName = new Map();
  for (const f of files) {
    const t = readMachineTable(f);
    if (!t.columns.includes('Name')) continue;
    const rel = path.relative(path.join(ROOT, 'memory'), f).replace(/\\/g, '/');
    const cols = specColumns(t.columns);
    for (const r of t.rows) {
      const key = String(r.Name ?? '').trim().toLowerCase();
      if (!key) continue;
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push({ file: f, specs: specsOf(r, cols, rel) });
    }
  }
  const machines = insertedMachines(s.migration);
  if (!machines.length) throw new Error(`${s.migration}: no inserted machines found`);
  const values = [];
  const unresolved = [];
  const seen = new Set();
  for (const m of machines) {
    const id = `${m.cls}|${m.name.toLowerCase()}`;
    if (seen.has(id)) continue;
    seen.add(id);
    let cands = byName.get(m.name.trim().toLowerCase()) ?? [];
    if (cands.length > 1 && s.classFiles?.[m.cls]) {
      const file = s.classFiles[m.cls];
      cands = cands.filter((c) => path.basename(c.file) === file);
    } else if (cands.length > 1) {
      // The file named for the class: exact, else the one file whose name
      // contains the class or is contained in it (laser_seam_weld_machine.csv
      // <- laser_seam_welding, machine_default_bevel_cutting.csv <- bevel_cutting).
      const exact = cands.filter((c) => stem(c.file) === norm(m.cls));
      const loose = cands.filter((c) => stem(c.file).includes(norm(m.cls)) || norm(m.cls).includes(stem(c.file)));
      if (exact.length) cands = exact;
      else if (new Set(loose.map((c) => norm(c.file))).size === 1) cands = loose;
    }
    if (cands.length > 1) {
      // "(1)" copies of one file, or one machine listed twice identically.
      const bodies = new Set(cands.map((c) => JSON.stringify({ ...c.specs, source: null })));
      if (bodies.size === 1) cands = [cands[0]];
    }
    if (cands.length !== 1) { unresolved.push(`${m.cls}: ${m.name} (${cands.length} source rows)`); continue; }
    values.push(`  (${sqlStr(m.cls)}, ${sqlStr(m.name)}, ${sqlJsonb(cands[0].specs)})`);
  }
  summary.push(`--   ${s.group.padEnd(24)} ${s.migration.padEnd(46)} ${String(values.length).padStart(3)}/${machines.length} machines  <- memory/${s.dir}${s.only ? `/${s.only}` : ''}`);
  for (const u of unresolved) summary.push(`--     not resolved: ${u}`);
  if (values.length) {
    sections.push(`-- ── ${s.group} (${s.migration})
UPDATE mhr_records m
SET specs = v.specs::jsonb, updated_at = now()
FROM (VALUES
${values.join(',\n')}
) AS v(machine_class, machine_name, specs)
WHERE m.machine_class = v.machine_class
  AND lower(trim(m.machine_name)) = lower(trim(v.machine_name))
  AND (m.specs IS NULL OR m.specs = '{}'::jsonb);
`);
  }
}

const sql = `-- ============================================================================
-- Migration 864: Machine & Process Lookup record for the pre-specs machine seeds
-- ============================================================================
-- Generated by scripts/gen_864_backfill_machine_specs.js -- do not hand-edit,
-- re-run the generator and diff instead.
--
-- 793-797 and 806 seeded their machines while mhr_records had no specs column
-- (dropped by 563, restored by 814a), so the HR Rates edit dialog's Machine &
-- Process Lookup found nothing for them. This writes each machine's own
-- memory/ source row into specs (the 845/851/862 shape), matched by the
-- (machine_class, machine_name) its migration inserted. Every location is
-- matched (829's India copies included); a specs value already set is never
-- overwritten. Rates and every other column are untouched.
--
${summary.join('\n')}
--
-- Idempotent: a second run updates nothing.
-- ============================================================================

-- specs was dropped by migration 563 and restored by 814a; a no-op when it exists.
ALTER TABLE mhr_records ADD COLUMN IF NOT EXISTS specs JSONB;

${sections.join('\n')}
NOTIFY pgrst, 'reload schema';

-- Verify (expect no row with specs NULL):
-- SELECT process_group, count(*) FILTER (WHERE specs IS NULL OR specs = '{}'::jsonb) AS without_specs, count(*)
--   FROM mhr_records
--   WHERE process_group IN ('Additive Manufacturing', 'Assembly', 'Part Assembly', 'Composites', 'PCB') OR machine_class = 'cmm'
--   GROUP BY 1 ORDER BY 1;
`;
fs.writeFileSync(OUT, sql, 'utf8');
console.log(`Wrote ${path.relative(ROOT, OUT)}`);
console.log(summary.join('\n').replace(/^-- {0,3}/gm, ''));

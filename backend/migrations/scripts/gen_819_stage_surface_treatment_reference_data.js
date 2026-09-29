#!/usr/bin/env node
// Generates migration 819: stage memory/SurfaceTreatment reference data into
// machining_reference_data (lossless landing, same conventions as 816/817).
//
//   variable      surface_treatment_variables.csv, one row per variable.
//                 key = Variable Name, value = String Value (verbatim text),
//                 unit_type = Unit Type Name, notes = Notes, raw = whole row.
//   lookup_table  one row per lookup/*.csv, key = file base name, value = row
//                 count, raw = {table_name, source_files, status, columns, rows}
//                 (migration 809 shape). Numeric-looking cells become JSON
//                 numbers; original column names are kept.
//   process       surface_treatment_processes.csv, key = Process Name, raw = row.
//   operation     surface_treatment_operations.csv, key = Process:Operation.
//   wage_grade    surface_treatment_wage_grades.csv, key = Process Name,
//                 value = Wage Grade Name, raw = row (816 shape).
//
// source_version is '2026-SurfaceTrt' (VARCHAR(20), migration 638).
// lookup/surface_treatment_processes.csv is byte-identical to the top-level
// process list and is staged once, as category process.
//
// Machines are migration 820 (gen_820_seed_surface_treatment_mhr_records.js).
// The licensed data vendor is never written to the database: any cell naming
// it is replaced by 'reference export baseline'.
//
// Run: node backend/migrations/scripts/gen_819_stage_surface_treatment_reference_data.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const SRC = path.join(ROOT, 'memory', 'SurfaceTreatment');
const OUT = path.join(__dirname, '..', '819_stage_surface_treatment_reference_data.sql');
const VERSION = '2026-SurfaceTrt';
const VENDOR_RE = /a\s*priori/i;
if (VERSION.length > 20) throw new Error(`source_version ${VERSION} exceeds VARCHAR(20)`);

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); if (row.some((f) => f !== '')) rows.push(row); }
  return rows;
}
const clean = (v) => (VENDOR_RE.test(v) ? 'reference export baseline' : v);
function text(v) {
  const t = clean(String(v ?? '').trim());
  return t === '' ? null : t;
}
function cell(v) {
  const t = text(v);
  if (t === null) return null;
  if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) return Number(t);
  return t;
}
function read(rel, conv = cell) {
  const t = parseCsv(fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/^﻿/, ''));
  const columns = t[0].map((h) => h.trim());
  const rows = t.slice(1).map((r) => {
    if (r.length > columns.length) throw new Error(`${rel}: row has ${r.length} cells for ${columns.length} columns`);
    return Object.fromEntries(columns.map((h, i) => [h, conv(r[i])]));
  });
  return { columns, rows };
}
const sqlStr = (v) => (v === null || v === undefined || v === '' ? 'NULL' : `$str$${String(v)}$str$`);
const sqlJsonb = (o) => `$jsonb$${JSON.stringify(o)}$jsonb$::jsonb`;
const row = (category, key, value, unit, notes, raw) =>
  `(${sqlStr(category)}, 'USA', ${sqlStr(VERSION)}, ${sqlStr(key)}, ${sqlStr(value)}, ${sqlStr(unit)}, ${sqlStr(notes)}, ${sqlJsonb(raw)})`;

const out = [];
const counts = {};
const add = (cat, r) => { out.push(r); counts[cat] = (counts[cat] || 0) + 1; };

// variables: value column keeps the source text verbatim; raw keeps the row
// with numeric cells as JSON numbers (816 convention).
const varsText = read('surface_treatment_variables.csv', text);
const varsRaw = read('surface_treatment_variables.csv');
for (const need of ['Variable Name', 'String Value', 'Unit Type Name', 'Notes']) {
  if (!varsText.columns.includes(need)) throw new Error(`surface_treatment_variables.csv: missing column ${need}`);
}
varsText.rows.forEach((v, i) => {
  add('variable', row('variable', v['Variable Name'], v['String Value'], v['Unit Type Name'], v['Notes'], varsRaw.rows[i]));
});

// lookup tables
const lookupFiles = fs.readdirSync(path.join(SRC, 'lookup')).filter((f) => f.toLowerCase().endsWith('.csv') && f !== 'surface_treatment_processes.csv').sort();
const lookupSummary = [];
for (const f of lookupFiles) {
  const rel = `lookup/${f}`;
  const key = path.basename(f, '.csv');
  const t = read(rel);
  const raw = { table_name: key, source_files: [rel], status: 'COMPLETE', columns: t.columns, rows: t.rows };
  add('lookup_table', row('lookup_table', key, String(t.rows.length), null, `Staged from memory/SurfaceTreatment/${rel}`, raw));
  lookupSummary.push(`${key} (${t.rows.length})`);
}

// processes
const procs = read('surface_treatment_processes.csv');
for (const p of procs.rows) {
  if (!p['Process Name']) continue;
  add('process', row('process', p['Process Name'], p['Default Machine'], null, p['Notes'], p));
}

// operations
const ops = read('surface_treatment_operations.csv');
for (const o of ops.rows) {
  if (!o['Process Name']) continue;
  add('operation', row('operation', o['Process Name'], null, null, o['Notes'], o));
}

// wage grades
const wage = read('surface_treatment_wage_grades.csv');
for (const w of wage.rows) {
  if (!w['Process Name']) continue;
  add('wage_grade', row('wage_grade', w['Process Name'], w['Wage Grade Name'], null, null, w));
}

const sql = `-- ============================================================================
-- Migration 819: stage memory/SurfaceTreatment reference data
-- ============================================================================
-- Generated by scripts/gen_819_stage_surface_treatment_reference_data.js --
-- do not hand-edit, re-run the generator and diff instead.
--
-- source_version ${VERSION} (source_region USA), in machining_reference_data
-- under its own version so it never mixes with the Machining variables.
--
--   variable      ${counts.variable} rows  (surface_treatment_variables.csv; value = String Value verbatim)
--   lookup_table  ${counts.lookup_table} rows  (${lookupSummary.join(', ')})
--   process       ${counts.process} rows  (surface_treatment_processes.csv; value = Default Machine)
--   operation     ${counts.operation} rows  (surface_treatment_operations.csv)
--   wage_grade    ${counts.wage_grade} rows  (surface_treatment_wage_grades.csv)
--
-- Lossless landing (same conventions as migrations 809, 816, 817). Machines
-- are migration 820.
-- Idempotent: ON CONFLICT on (category, source_region, source_version, key).
-- ============================================================================

INSERT INTO machining_reference_data (category, source_region, source_version, key, value, unit_type, notes, raw) VALUES
${out.map((r) => `  ${r}`).join(',\n')}
ON CONFLICT (category, source_region, source_version, key) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- Verify (expect variable ${counts.variable}, lookup_table ${counts.lookup_table}, process ${counts.process}, operation ${counts.operation}, wage_grade ${counts.wage_grade}):
-- SELECT category, count(*) FROM machining_reference_data
-- WHERE source_version = '${VERSION}' GROUP BY 1 ORDER BY 1;
`;

fs.writeFileSync(OUT, sql, 'utf8');
console.log(`Wrote ${path.relative(ROOT, OUT)}: ${JSON.stringify(counts)}`);
console.log(`lookups: ${lookupSummary.join(', ')}`);

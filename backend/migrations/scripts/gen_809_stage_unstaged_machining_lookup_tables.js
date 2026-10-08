#!/usr/bin/env node
// Generator: stages the memory/Machining/lookup tables that migrations
// 739-751 never staged, straight from the CSV files (the JSON files the
// original gen_739 read no longer exist — memory/ is CSV now).
//
// Same landing table and conventions as gen_739: one row per TABLE in
// machining_reference_data, category='lookup_table', source_region 'USA',
// source_version '2026-03', raw = the whole table (lossless), no judgment
// about which consumer reads it.
//
// raw shape (all tables):
//   { table_name, source_files, status: 'COMPLETE' | 'PARTIAL',
//     columns: [...header names verbatim...], rows: [ {header: value} ] }
// A *_partial.csv file, or a row-level _status column, is kept as PARTIAL —
// never presented as a complete table. Numeric cells become numbers, empty
// cells null, everything else stays the literal string.
// Multi-file tables (tblGrinding__materials + __notes) keep each part under
// its own property instead of rows.
//
// Aborts if a key already exists in an earlier staging migration.
// Run: node backend/migrations/scripts/gen_809_stage_unstaged_machining_lookup_tables.js
// A later table: --migration=<N> --table=<key>:<file.csv> (repeatable) stages
// only those tables as migration N (e.g. 882, operation_capability_process).

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const LOOKUP_DIR = path.join(ROOT, 'memory', 'Machining', 'lookup');
const OUT_DIR = path.join(__dirname, '..');
const arg = (name) => process.argv.filter((a) => a.startsWith(`--${name}=`)).map((a) => a.slice(name.length + 3));
const MIGRATION_BASE_NUM = Number(arg('migration')[0] ?? 809);
const PART_SIZE_LIMIT_BYTES = 200_000;
const SOURCE_REGION = 'USA';
const SOURCE_VERSION = '2026-03';

// key -> files (relative to LOOKUP_DIR). Keys match the table names the
// reference uses; the _partial suffix is recorded as status, not in the key.
const DEFAULT_TABLES = [
  ['tblMilling', ['tblMilling_partial.csv']],
  ['tblTapping', ['tblTapping.csv']],
  ['tblThreadMilling', ['tblThreadMilling.csv']],
  ['tblInternalGrinding', ['tblInternalGrinding.csv']],
  ['tblGrinding', ['tblGrinding__materials.csv', 'tblGrinding__notes.csv']],
  ['tblHobbing', ['tblHobbing.csv']],
  ['tblShaping', ['tblShaping.csv']],
  ['tblShaving', ['tblShaving.csv']],
  ['tblMultiPassOperations', ['tblMultiPassOperations.csv']],
  ['tblPullTypeKeywayBroach', ['tblPullTypeKeywayBroach_partial.csv']],
  ['tblShimTypeKeywayBroach', ['tblShimTypeKeywayBroach_partial.csv']],
  ['tblRadialGrooveMilling', ['tblRadialGrooveMilling_partial.csv']],
  ['tblSpiralBevelGearCutting', ['tblSpiralBevelGearCutting_partial.csv']],
  ['tblStraightBevelGearCutting', ['tblStraightBevelGearCutting_partial.csv']],
  ['tblDovetailFinishingPassCharacteristics', ['tblDovetailFinishingPassCharacteristics.csv']],
];
const TABLES = arg('table').length
  ? arg('table').map((t) => { const [key, file] = t.split(':'); return [key, [file]]; })
  : DEFAULT_TABLES;

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

// The licensed vendor's name is rebranded to eMithran inside the text (one
// tblMilling cut type carries it), the rule of migrations 639 / 650.
function cell(v) {
  const t = v.trim().replace(/a\s*priori/gi, 'eMithran');
  if (t === '') return null;
  if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) return Number(t);
  return t;
}

function readTable(file) {
  const table = parseCsv(fs.readFileSync(path.join(LOOKUP_DIR, file), 'utf8').replace(/^﻿/, ''));
  if (table.length === 0) throw new Error(`${file}: empty`);
  const columns = table[0].map((h) => h.trim());
  const rows = table.slice(1).map((r) => {
    const o = {};
    columns.forEach((h, i) => { o[h] = cell(r[i] ?? ''); });
    return o;
  });
  return { columns, rows };
}

// Keys already staged by earlier migrations — never silently re-staged.
const existingKeys = new Set();
for (const f of fs.readdirSync(OUT_DIR).filter((n) => /^\d+_.*\.sql$/.test(n) && Number(n.split('_')[0]) < MIGRATION_BASE_NUM)) {
  const sql = fs.readFileSync(path.join(OUT_DIR, f), 'utf8');
  for (const m of sql.matchAll(/'lookup_table', \$str\$[^$]*\$str\$, \$str\$[^$]*\$str\$, \$str\$([A-Za-z0-9_]+)\$str\$/g)) existingKeys.add(m[1]);
}

const sqlStr = (v) => (v === null || v === undefined || v === '' ? 'NULL' : `$str$${String(v)}$str$`);
const sqlJsonb = (obj) => `$jsonb$${JSON.stringify(obj)}$jsonb$::jsonb`;

const staged = [];
for (const [key, files] of TABLES) {
  if (existingKeys.has(key)) throw new Error(`Key ${key} is already staged by an earlier migration`);
  const partialFile = files.some((f) => /_partial\.csv$/i.test(f));
  let raw;
  let rowCount;
  if (files.length === 1) {
    const t = readTable(files[0]);
    const rowPartial = t.columns.includes('_status') && t.rows.some((r) => String(r._status ?? '').toUpperCase().startsWith('PARTIAL'));
    raw = { table_name: key, source_files: files, status: partialFile || rowPartial ? 'PARTIAL' : 'COMPLETE', columns: t.columns, rows: t.rows };
    rowCount = t.rows.length;
  } else {
    raw = { table_name: key, source_files: files, status: partialFile ? 'PARTIAL' : 'COMPLETE' };
    rowCount = 0;
    for (const f of files) {
      const part = f.replace(/\.csv$/i, '').split('__')[1] || f;
      const t = readTable(f);
      raw[part] = { columns: t.columns, rows: t.rows };
      rowCount += t.rows.length;
    }
  }
  const notes = `Staged from memory/Machining/lookup/${files.join(' + ')}${raw.status === 'PARTIAL' ? ' (PARTIAL in source)' : ''}`;
  const valueSql = `('lookup_table', ${sqlStr(SOURCE_REGION)}, ${sqlStr(SOURCE_VERSION)}, ${sqlStr(key)}, ${sqlStr(String(rowCount))}, NULL, ${sqlStr(notes)}, ${sqlJsonb(raw)})`;
  staged.push({ key, files, status: raw.status, rowCount, valueSql, size: Buffer.byteLength(valueSql, 'utf8') });
}

const parts = [];
let cur = [], curSize = 0;
for (const r of staged) {
  if (cur.length && curSize + r.size > PART_SIZE_LIMIT_BYTES) { parts.push(cur); cur = []; curSize = 0; }
  cur.push(r); curSize += r.size;
}
if (cur.length) parts.push(cur);

parts.forEach((partRows, i) => {
  const num = MIGRATION_BASE_NUM + i;
  const fileName = MIGRATION_BASE_NUM === 809
    ? `${num}_stage_unstaged_machining_lookup_tables_part${i + 1}of${parts.length}.sql`
    : `${num}_stage_machining_lookup_${TABLES.map(([k]) => k).join('_')}.sql`;
  const list = partRows.map((r) => `--   ${r.key.padEnd(40)} ${String(r.rowCount).padStart(4)} rows  ${r.status.padEnd(8)} <- ${r.files.join(' + ')}`).join('\n');
  const sql = `-- ============================================================================
-- Migration ${num}: stage memory/Machining lookup tables never staged before
-- (part ${i + 1} of ${parts.length}; ${partRows.length} of ${staged.length} tables)
--
-- Generated by scripts/gen_809_stage_unstaged_machining_lookup_tables.js from
-- the CSV files in memory/Machining/lookup -- do not hand-edit, re-run it.
-- Same landing table and conventions as migrations 739-751 (one row per
-- table, raw = whole table, lossless). PARTIAL tables are stored and labelled
-- PARTIAL exactly as the source marks them, never presented as complete.
--
-- Tables in this part:
${list}
-- ============================================================================

INSERT INTO machining_reference_data (category, source_region, source_version, key, value, unit_type, notes, raw) VALUES
${partRows.map((r) => `  ${r.valueSql}`).join(',\n')}
ON CONFLICT (category, source_region, source_version, key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
`;
  fs.writeFileSync(path.join(OUT_DIR, fileName), sql, 'utf8');
  console.log(`Wrote ${fileName} (${partRows.length} tables, ${Buffer.byteLength(sql, 'utf8')} bytes)`);
});
for (const r of staged) console.log(`  ${r.key.padEnd(40)} ${String(r.rowCount).padStart(4)} rows  ${r.status}`);

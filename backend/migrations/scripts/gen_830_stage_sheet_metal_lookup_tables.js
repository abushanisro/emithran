#!/usr/bin/env node
// Generates migration 830: stage every memory/Sheetmetal/lookuptable/*.csv as
// one whole-table row (category 'lookup_table') in sm_reference_data, under
// source_version '2026-SM-Lookup', so the Process page Variables list and its
// lookup viewer can open every Sheet Metal lookup table.
//
// Why a new row shape here: sm_reference_data's existing lookup rows (2026-03,
// 2026-03-batch1, 2026-03-combined) are one row PER ENTRY (keys like
// 'nestingCutRate:1:FiberLaserCut:...', 'tblPartSpacing:...') and cover only
// part of the folder; the costing services read those by key prefix and they
// stay untouched. Every key staged here is a file name, which never contains
// ':', so no LIKE 'prefix:%' read can match it.
//
// Per file:
//   X__columns / X__column_names / X__fields is the schema of a data file: of
//     X__records / X__rows, else of the one other X__* file (X__operations).
//     The pair is ONE table (rows from the data file, the schema kept as raw.schema).
//   every other csv is its own table, keyed by its file name
// Files with byte-identical content are staged once, every source file listed
// in raw.source_files and notes (nothing is dropped, nothing is shown twice).
//
// Run: node backend/migrations/scripts/gen_830_stage_sheet_metal_lookup_tables.js

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const DIR = path.join(ROOT, 'memory', 'Sheetmetal', 'lookuptable');
const OUT_DIR = path.join(__dirname, '..');
const OUT_NAME = '830_stage_sheet_metal_lookup_tables';
const SOURCE_VERSION = '2026-SM-Lookup';
const VENDOR_RE = /a\s*priori/i;
// The SQL editor refuses a query past its size limit (a 1.1 MB file was
// rejected for 823), so no part may exceed this.
const PART_BUDGET = 200000;

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
const cell = (v) => {
  const t = clean(String(v ?? '').trim());
  if (t === '') return null;
  if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) return Number(t);
  if (t === 'true' || t === 'True') return true;
  if (t === 'false' || t === 'False') return false;
  return t;
};
function read(file) {
  const t = parseCsv(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  if (!t.length) return { columns: [], rows: [] };
  const columns = t[0].map((h, i) => clean(h.trim()) || `column_${i + 1}`);
  // A row longer than the header is a source-file defect: its extra cells are
  // kept under their position so nothing is dropped.
  const rows = t.slice(1).map((r) => Object.fromEntries(r.map((v, i) => [columns[i] || `column_${i + 1}`, cell(v)])));
  return { columns, rows };
}
const sqlStr = (v) => (v === null || v === undefined || String(v).trim() === '' ? 'NULL' : `$str$${String(v).trim()}$str$`);
const sqlJsonb = (o) => `$jsonb$${JSON.stringify(o)}$jsonb$::jsonb`;

const SCHEMA_RE = /^(.*)__(columns|column_names|fields)$/;
const DATA_RE = /^(.*)__(records|rows)$/;
const base = (n) => path.basename(n, path.extname(n));
const files = fs.readdirSync(DIR).filter((n) => n.toLowerCase().endsWith('.csv')).sort();

// ── Tables: a data file plus its schema file when it has one ────────────────
const schemaOf = new Map(); // data file -> schema file
for (const n of files) {
  const s = base(n).match(SCHEMA_RE);
  if (!s) continue;
  const sib = files.filter((m) => m !== n && base(m).startsWith(`${s[1]}__`) && !SCHEMA_RE.test(base(m)));
  const data = sib.find((m) => base(m) === `${s[1]}__records` || base(m) === `${s[1]}__rows`) ?? (sib.length === 1 ? sib[0] : null);
  if (data) schemaOf.set(data, n);
}
const pairedSchemas = new Set(schemaOf.values());
const tables = [];
for (const n of files) {
  if (pairedSchemas.has(n)) continue;
  const b = base(n);
  const schema = schemaOf.get(n) ?? null;
  const d = b.match(DATA_RE);
  // X__rows / X__records is table X; any other data file keeps its own name.
  tables.push({ key: d ? d[1] : b, dataFile: n, schemaFile: schema });
}
const dupKey = tables.map((t) => t.key).find((k, i, all) => all.indexOf(k) !== i);
if (dupKey) throw new Error(`two files map to table key ${dupKey}`);

// ── One staged row per distinct table content ───────────────────────────────
const rel = (n) => `memory/Sheetmetal/lookuptable/${n}`;
const byHash = new Map();
const coverage = [];
for (const t of tables) {
  if (t.key.includes(':')) throw new Error(`${t.key}: a key with ':' could match a costing LIKE 'prefix:%' read`);
  const hash = crypto.createHash('sha256')
    .update(fs.readFileSync(path.join(DIR, t.dataFile)))
    .update(t.schemaFile ? fs.readFileSync(path.join(DIR, t.schemaFile)) : '')
    .digest('hex');
  const src = [t.dataFile, t.schemaFile].filter(Boolean).map(rel);
  if (byHash.has(hash)) {
    const first = byHash.get(hash);
    first.aliases.push(t.key);
    first.raw.source_files.push(...src);
    coverage.push([t.dataFile, `same content as ${first.key}`]);
    continue;
  }
  const data = read(path.join(DIR, t.dataFile));
  const raw = { table_name: t.key, source_files: src, status: 'COMPLETE', columns: data.columns, rows: data.rows };
  if (t.schemaFile) raw.schema = read(path.join(DIR, t.schemaFile)).rows;
  byHash.set(hash, { key: t.key, raw, aliases: [] });
  coverage.push([t.dataFile, `${t.key} (${data.rows.length} rows${t.schemaFile ? `, schema ${t.schemaFile}` : ''})`]);
}
const staged = [...byHash.values()];

// Every csv is accounted for: a table's data file, its paired schema, or a copy.
const accounted = new Set([...tables.map((t) => t.dataFile), ...pairedSchemas]);
const unaccounted = files.filter((n) => !accounted.has(n));
if (unaccounted.length) throw new Error(`unaccounted files: ${unaccounted.join(', ')}`);

// ── Statements ──────────────────────────────────────────────────────────────
// A table too large for one part is inserted with its first chunk of rows and
// the rest appended by guarded UPDATEs (applied only while the stored row
// count equals the chunk's offset, so re-running any part is a no-op).
const inserts = []; // VALUES tuples
const appends = []; // { key, offset, rows, total }
for (const e of staged) {
  const notes = `Staged from ${e.raw.source_files.join(', ')}${e.aliases.length ? ` (identical tables: ${e.aliases.join(', ')})` : ''}`;
  const chunks = [];
  let chunk = [], bytes = 0;
  for (const r of e.raw.rows) {
    const n = Buffer.byteLength(JSON.stringify(r)) + 1;
    if (chunk.length && bytes + n > PART_BUDGET - 20000) { chunks.push(chunk); chunk = []; bytes = 0; }
    chunk.push(r); bytes += n;
  }
  chunks.push(chunk);
  inserts.push({ key: e.key, sql: `(${sqlStr('lookup_table')}, 'USA', ${sqlStr(SOURCE_VERSION)}, ${sqlStr(e.key)}, ${sqlStr(String(e.raw.rows.length))}, NULL, ${sqlStr(notes)}, ${sqlJsonb({ ...e.raw, rows: chunks[0] })})` });
  let offset = chunks[0].length;
  for (const c of chunks.slice(1)) { appends.push({ key: e.key, offset, rows: c, total: e.raw.rows.length }); offset += c.length; }
}

const parts = [];
let cur = [], curBytes = 0;
for (const r of inserts) {
  const n = Buffer.byteLength(r.sql) + 4;
  if (cur.length && curBytes + n > PART_BUDGET) { parts.push({ inserts: cur }); cur = []; curBytes = 0; }
  cur.push(r); curBytes += n;
}
if (cur.length) parts.push({ inserts: cur });
const insertParts = parts.length;
for (const a of appends) parts.push({ append: a });

for (const old of fs.readdirSync(OUT_DIR).filter((n) => n.startsWith(OUT_NAME) && n.endsWith('.sql'))) {
  fs.unlinkSync(path.join(OUT_DIR, old));
}
const split = [...new Set(appends.map((a) => a.key))];
parts.forEach((p, i) => {
  const body = p.append
    ? `UPDATE sm_reference_data
SET raw = jsonb_set(raw, '{rows}', (raw->'rows') || ${sqlJsonb(p.append.rows)})
WHERE category = 'lookup_table' AND source_region = 'USA' AND source_version = ${sqlStr(SOURCE_VERSION)}
  AND key = ${sqlStr(p.append.key)} AND jsonb_array_length(raw->'rows') = ${p.append.offset};`
    : `INSERT INTO sm_reference_data (category, source_region, source_version, key, value, unit_type, notes, raw) VALUES
${p.inserts.map((r) => `  ${r.sql}`).join(',\n')}
ON CONFLICT (category, source_region, source_version, key) DO NOTHING;`;
  const sql = `-- ============================================================================
-- Migration 830 (part ${i + 1} of ${parts.length}): stage every Sheet Metal lookup table as a whole table
-- ============================================================================
-- Generated by scripts/gen_830_stage_sheet_metal_lookup_tables.js from
-- memory/Sheetmetal/lookuptable -- do not hand-edit, re-run the generator.
--
-- sm_reference_data, category lookup_table, source_version ${SOURCE_VERSION}, one row
-- per table (raw = { table_name, source_files, columns, rows[, schema] }):
-- ${files.length} csv files -> ${tables.length} tables (schema/data pairs merged) -> ${staged.length} rows
-- (byte-identical tables staged once, every source file listed in notes).
-- The existing per-entry lookup rows (2026-03, 2026-03-batch1,
-- 2026-03-combined) are not touched; the costing services read those by
-- key prefix ('nestingCutRate:%', 'tblPartSpacing:%'), and no key staged here
-- contains ':'.
--
-- Run parts 1-${insertParts} first (any order: one INSERT per table, ON CONFLICT DO
-- NOTHING). ${split.length ? `${split.join(', ')} is too large for one part: its first rows are
-- inserted there and parts ${insertParts + 1}-${parts.length} append the rest, IN ORDER. Each append
-- applies only while the stored row count equals its offset, so re-running
-- any part is a no-op.` : 'No table is split.'}
-- This part: ${p.append ? `${p.append.key} rows ${p.append.offset + 1}-${p.append.offset + p.append.rows.length} of ${p.append.total}` : p.inserts.map((r) => r.key).join(', ')}
-- ============================================================================

${body}

NOTIFY pgrst, 'reload schema';
${i === parts.length - 1 ? `
-- Verify: ${staged.length} tables, each holding all its rows (the second query returns no rows).
-- SELECT count(*) FROM sm_reference_data WHERE category = 'lookup_table' AND source_version = '${SOURCE_VERSION}';
-- SELECT key, value, jsonb_array_length(raw->'rows') FROM sm_reference_data
--  WHERE category = 'lookup_table' AND source_version = '${SOURCE_VERSION}'
--    AND value::int <> jsonb_array_length(raw->'rows');
` : ''}`;
  if (Buffer.byteLength(sql) > PART_BUDGET + 10000) throw new Error(`part ${i + 1} is ${Buffer.byteLength(sql)} bytes`);
  fs.writeFileSync(path.join(OUT_DIR, `${OUT_NAME}_part${i + 1}of${parts.length}.sql`), sql);
});

console.log(`${files.length} csv files -> ${tables.length} tables -> ${staged.length} rows in ${parts.length} parts (${insertParts} insert, ${appends.length} append)`);
for (const [file, what] of coverage) console.log(`  ${file.padEnd(78)} ${what}`);

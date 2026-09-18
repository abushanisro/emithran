// Generator: stages all 61 real Machining lookup tables
// (memory/machining/lookup/*.json) into machining_reference_data
// category='lookup_table' -- one row per FILE, raw = the complete,
// untouched, unflattened original JSON content of that file.
//
// Why whole-file granularity, not per-row explosion: the 61 source files
// use genuinely different internal shapes for their data payload --
// 'rows', 'series', 'materials', 'entries', 'sizes', 'qualities', 'tools',
// 'diameters_mm', or (for ~30 files) no wrapper at all, just a bare
// top-level array. Several files also carry real per-table metadata
// alongside the data (column_names, data_quality_note, group_summary,
// data_gaps, schema_correction_notice) that a per-row explosion keyed to
// only one array field would silently drop. Matching this table's own
// documented philosophy (migration 638: "lossless landing table... no
// judgment yet about which ones a calculator actually consumes"),
// whole-file staging captures every one of these 61 tables with zero risk
// of mis-picking the "real" data array or dropping metadata. Row-level
// normalization into a real operational sm_lookup_*-style table remains a
// deliberate, reviewed, per-table promotion step for later -- exactly as
// migration 638's header already scopes that decision out of the staging
// layer.
//
// key = table_name (the file's own "table_name" field when present,
// else the filename with the .json extension stripped -- verified below
// that no two of the 61 files produce the same key).
// value = the file's own row_count / total_row_count field as a string
// when present, else the length of the top-level array when the file IS
// a bare array, else NULL (never guessed).
// notes = the file's own "description" or "data_quality_note" field when
// present, else NULL.
//
// Split into multiple migration files, one INSERT per part, because a
// single 2.6MB combined migration failed Supabase's SQL Editor paste-size
// limit ("Query is too large to be run via the SQL Editor"). Batched
// greedily in original file order under a conservative per-part size cap
// (see PART_SIZE_LIMIT_BYTES) -- same "combined_partXofY" convention this
// codebase already used for Sheet Metal's oversized nesting_cut_rate
// lookup migrations (493-498). Two files (tblBoring/tblBoringV2, 556KB/
// 741KB) are each individually larger than the cap; each gets its own
// dedicated part rather than being force-split (a single row's raw JSONB
// is never split -- that would require altering the row's own content).
//
// Offline, file-in/file-out -- matches every other gen_*.js in this codebase.

const fs = require('fs');
const path = require('path');

const LOOKUP_DIR = path.join(__dirname, '../../../memory/machining/lookup');
const OUT_DIR = path.join(__dirname, '..');
const MIGRATION_BASE_NUM = 739;
const PART_SIZE_LIMIT_BYTES = 200_000; // conservative; well under the SQL Editor's failure point on the 2.6MB combined file

const SOURCE_REGION = 'USA';
const SOURCE_VERSION = '2026-03';

function sqlStr(v) {
  if (v === null || v === undefined || v === '') return 'NULL';
  return `$str$${String(v)}$str$`;
}
function sqlJsonb(obj) {
  return `$jsonb$${JSON.stringify(obj)}$jsonb$::jsonb`;
}

function deriveKey(fname, data) {
  if (!Array.isArray(data) && data && typeof data.table_name === 'string' && data.table_name.trim()) {
    return data.table_name.trim();
  }
  return fname.replace(/\.json$/i, '');
}

function deriveValue(data) {
  if (Array.isArray(data)) return String(data.length);
  if (data && data.total_row_count != null) return String(data.total_row_count);
  if (data && data.row_count != null) return String(data.row_count);
  return null;
}

function deriveNotes(data) {
  if (Array.isArray(data)) return null;
  if (data && typeof data.description === 'string' && data.description.trim()) return data.description.trim();
  if (data && typeof data.data_quality_note === 'string' && data.data_quality_note.trim()) return data.data_quality_note.trim();
  return null;
}

const files = fs.readdirSync(LOOKUP_DIR).filter((f) => f.endsWith('.json')).sort();

const rows = [];
const seenKeys = new Map();
for (const fname of files) {
  const fullPath = path.join(LOOKUP_DIR, fname);
  const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  const key = deriveKey(fname, data);
  if (seenKeys.has(key)) {
    throw new Error(`Duplicate key "${key}" from ${fname} and ${seenKeys.get(key)} -- would silently collide under the unique index`);
  }
  seenKeys.set(key, fname);
  const valueSql = `('lookup_table', ${sqlStr(SOURCE_REGION)}, ${sqlStr(SOURCE_VERSION)}, ${sqlStr(key)}, ${sqlStr(deriveValue(data))}, NULL, ${sqlStr(deriveNotes(data))}, ${sqlJsonb(data)})`;
  rows.push({ key, sourceFile: fname, valueSql, size: Buffer.byteLength(valueSql, 'utf8') });
}

// Greedy batching in original file order, respecting PART_SIZE_LIMIT_BYTES.
// An oversized single row still gets its own part (never split mid-row).
const parts = [];
let current = [];
let currentSize = 0;
for (const r of rows) {
  if (current.length > 0 && currentSize + r.size > PART_SIZE_LIMIT_BYTES) {
    parts.push(current);
    current = [];
    currentSize = 0;
  }
  current.push(r);
  currentSize += r.size;
}
if (current.length > 0) parts.push(current);

const totalParts = parts.length;
const writtenFiles = [];

parts.forEach((partRows, i) => {
  const partNum = i + 1;
  const migrationNum = MIGRATION_BASE_NUM + i;
  const fileName = `${migrationNum}_stage_machining_lookup_tables_part${partNum}of${totalParts}.sql`;
  const outPath = path.join(OUT_DIR, fileName);

  const valuesSql = partRows.map((r) => `  ${r.valueSql}`).join(',\n');
  const fileList = partRows.map((r) => `--   ${r.sourceFile} (key: ${r.key})`).join('\n');

  const sql = `-- ============================================================================
-- Migration ${migrationNum}: Stage Machining lookup tables into
-- machining_reference_data category='lookup_table' -- part ${partNum} of ${totalParts}
-- (${partRows.length} of ${rows.length} total files)
--
-- Generated by gen_739_stage_machining_lookup_tables.js.
--
-- One row per FILE (not per data row) -- see that script's header comment
-- for why: the 61 source files use genuinely different internal shapes
-- for their data payload, and whole-file JSONB staging in \`raw\` is fully
-- lossless regardless of shape. Split into ${totalParts} parts because the
-- combined 2.6MB single migration failed Supabase's SQL Editor paste-size
-- limit; batched greedily in original file order under a ${PART_SIZE_LIMIT_BYTES}-byte
-- per-part cap (oversized single rows get their own dedicated part).
--
-- Files staged in this part:
${fileList}
-- ============================================================================

INSERT INTO machining_reference_data (category, source_region, source_version, key, value, unit_type, notes, raw) VALUES
${valuesSql}
ON CONFLICT (category, source_region, source_version, key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
`;

  fs.writeFileSync(outPath, sql, 'utf8');
  writtenFiles.push({ fileName, rows: partRows.length, bytes: Buffer.byteLength(sql, 'utf8') });
});

console.log(`Wrote ${rows.length} rows across ${totalParts} parts:`);
for (const f of writtenFiles) {
  console.log(`  ${f.fileName} -- ${f.rows} rows, ${(f.bytes / 1024).toFixed(1)} KB`);
}

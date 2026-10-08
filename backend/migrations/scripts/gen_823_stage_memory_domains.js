#!/usr/bin/env node
// Generates migration 823: stage the reference data of every memory/ domain
// folder that memory-reference-domains.json marks stagedBy "823" into
// machining_reference_data, each under its own source_version (the pattern of
// migrations 816, 817 and 819, applied to every remaining folder at once).
//
// Per folder, every data file is classified by its role, never hand-listed:
//   variable      a top-level *variables*.csv   one row per variable
//   process       a top-level *processes*.csv   key = Process Name, value = Default Machine
//   operation     a top-level *operations*.csv  key = Process Name (the Process:Operation//Feature string)
//   wage_grade    a top-level *wage_grade*.csv  key = Process Name, value = Wage Grade Name
//   material      a top-level *material*.csv    key = Name, raw = the whole row
//   lookup_table  every csv in a lookup/ folder, one row per file (809 shape)
// Machine files are NOT staged here (their machines are in mhr_records via
// migrations 792-797, 815 and 824). India folders are handled by 829.
// A "name (1).csv" copy byte-identical to another file is staged once; a copy
// that differs is staged under its own key and named in the header.
//
// Run: node backend/migrations/scripts/gen_823_stage_memory_domains.js

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const MEM = path.join(ROOT, 'memory');
// The manifest tag this run stages (default 823). Other folders use their own
// tag, e.g. `node gen_823_stage_memory_domains.js --stagedBy=846`.
const STAGED_BY = (process.argv.find((a) => a.startsWith('--stagedBy=')) ?? '--stagedBy=823').split('=')[1];
const OUT_PREFIX = path.join(__dirname, '..', `${STAGED_BY}_stage_memory_domains`);
const MANIFEST = require(path.join(ROOT, 'backend', 'src', 'modules', 'processes', 'memory-reference-domains.json'));
const VENDOR_RE = /a\s*priori/i;

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
const text = (v) => { const t = clean(String(v ?? '').trim()); return t === '' ? null : t; };
const cell = (v) => {
  const t = text(v);
  if (t === null) return null;
  if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) return Number(t);
  if (t === 'true') return true;
  if (t === 'false') return false;
  return t;
};
function read(file) {
  const t = parseCsv(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  const columns = t[0].map((h) => h.trim());
  // A row longer than the header is a source-file defect: its extra cells are
  // kept under their position so nothing is dropped.
  const rows = t.slice(1).map((r) => Object.fromEntries(r.map((v, i) => [columns[i] || `column_${i + 1}`, cell(v)])));
  return { columns, rows };
}
const sqlStr = (v) => (v === null || v === undefined || String(v).trim() === '' ? 'NULL' : `$str$${String(v).trim()}$str$`);
const sqlJsonb = (o) => `$jsonb$${JSON.stringify(o)}$jsonb$::jsonb`;
const baseKey = (f) => path.basename(f, path.extname(f)).replace(/\s*\(\d+\)$/, '').trim();

const statements = [];
const summary = [];
const notes = [];

for (const d of MANIFEST.domains.filter((x) => x.stagedBy === STAGED_BY)) {
  if (d.sourceVersion.length > 20) throw new Error(`${d.key}: source_version exceeds VARCHAR(20)`);
  const dir = path.join(MEM, d.folder);
  const files = [];
  (function walk(p) {
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const q = path.join(p, e.name);
      if (e.isDirectory()) { if (!/^(india|machines?)$/i.test(e.name)) walk(q); }
      else if (e.name.toLowerCase().endsWith('.csv')) files.push(q);
    }
  })(dir);

  const seen = new Map(); // content hash -> file
  const out = [];
  const counts = {};
  const keysUsed = new Map();
  const valuesUsed = new Map();
  const dupNotes = [];
  // `file` (variable / wage_grade / operation / process rows): two files of one
  // folder may carry the same key (Sheet metal transfer die has both
  // all_plant_variables.csv and transfer_die_variables.csv). The same value
  // again is staged once; a different value is staged under "key@file" so
  // neither is lost. Both are named in the header. Without `file` a repeat is
  // a generator bug and stops the run.
  const add = (category, key, value, unit, note, raw, file) => {
    let k = `${category}::${key}`;
    if (keysUsed.has(k)) {
      if (!file) throw new Error(`${d.key}: duplicate ${category} key "${key}" (${keysUsed.get(k)} and ${note})`);
      if (String(valuesUsed.get(k)) === String(value)) { dupNotes.push(`${category} ${key} (${file}, same value)`); return; }
      key = `${key}@${path.basename(file, '.csv')}`;
      k = `${category}::${key}`;
      if (keysUsed.has(k)) throw new Error(`${d.key}: duplicate ${category} key "${key}"`);
      dupNotes.push(`${category} ${key} (${file}, differing value: staged under this key)`);
    }
    keysUsed.set(k, note);
    valuesUsed.set(k, value);
    out.push(`(${sqlStr(category)}, 'USA', ${sqlStr(d.sourceVersion)}, ${sqlStr(key)}, ${sqlStr(value)}, ${sqlStr(unit)}, ${sqlStr(note)}, ${sqlJsonb(raw)})`);
    counts[category] = (counts[category] ?? 0) + 1;
  };

  // A table exported in parts: X__records.csv / X__rows.csv hold the rows,
  // X__columns.csv / X__fields.csv the column labels. Staged as ONE lookup
  // table X (rows + labels), never as separate tables.
  const SPLIT = /^(.*)__(records|rows|columns|fields)\.csv$/i;
  const splitGroups = new Map();
  for (const f of files) {
    const m = SPLIT.exec(path.basename(f));
    if (!m) continue;
    if (!splitGroups.has(m[1])) splitGroups.set(m[1], {});
    splitGroups.get(m[1])[m[2].toLowerCase()] = f;
  }
  const relOf = (x) => path.relative(MEM, x).replace(/\\/g, '/');
  for (const [base, g] of [...splitGroups].sort(([a], [b]) => a.localeCompare(b))) {
    const rowsFile = g.records ?? g.rows;
    const labelsFile = g.columns ?? g.fields;
    if (!rowsFile) { notes.push(`memory/${relOf(labelsFile)}: column labels with no rows file (not staged)`); continue; }
    const t = read(rowsFile);
    const labels = labelsFile ? read(labelsFile).rows.map((r) => r['value']).filter((v) => v != null) : null;
    const rels = [rowsFile, labelsFile].filter(Boolean).map(relOf);
    add('lookup_table', base, String(t.rows.length), null, `Staged from memory/${rels.join(' + ')}`,
      { table_name: base, source_files: rels, status: 'COMPLETE', columns: t.columns, column_labels: labels, rows: t.rows });
  }
  const splitFiles = new Set([...splitGroups.values()].flatMap((g) => Object.values(g)));
  // Header spellings differ per export (Title Case vs camelCase); both are the same column.
  const col = (row, ...names) => { for (const n of names) if (row[n] != null && row[n] !== '') return row[n]; return null; };
  // A material table carries a name AND a material type or cut code; a file
  // that merely has "material" in its name (tool materials) is a lookup.
  const isMaterialTable = (cols) => cols.some((c) => /^name$/i.test(c)) && cols.some((c) => /^(material ?type|cut ?code)$/i.test(c));

  for (const f of files.sort()) {
    if (splitFiles.has(f)) continue;
    const rel = path.relative(MEM, f).replace(/\\/g, '/');
    // Only a "name (1).csv" copy of the SAME file collapses; two differently
    // named tables with equal content are still two tables a consumer asks for.
    const hash = `${baseKey(f)}|${crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')}`;
    if (seen.has(hash)) { notes.push(`${rel} is byte-identical to ${seen.get(hash)}: staged once`); continue; }
    seen.set(hash, rel);
    const inLookup = /(^|\/)lookup\//i.test(path.relative(dir, f).replace(/\\/g, '/'));
    const name = path.basename(f).toLowerCase();
    const t = read(f);
    const src = `memory/${rel}`;
    const materialTable = !inLookup && /material/.test(name) && isMaterialTable(t.columns);
    if (inLookup || (!/variables|process|operation|wage_grade/.test(name) && !materialTable)) {
      let key = baseKey(f);
      if (keysUsed.has(`lookup_table::${key}`)) { key = path.basename(f, '.csv').trim(); notes.push(`${rel} differs from its same-named copy: staged as ${key}`); }
      add('lookup_table', key, String(t.rows.length), null, `Staged from ${src}`,
        { table_name: key, source_files: [rel], status: 'COMPLETE', columns: t.columns, rows: t.rows });
    } else if (/variables/.test(name)) {
      const txt = parseCsv(fs.readFileSync(f, 'utf8').replace(/^﻿/, ''));
      const h = txt[0].map((x) => x.trim());
      const idx = (...n) => h.findIndex((x) => n.includes(x));
      const iN = idx('Variable Name', 'variableName'), iV = idx('String Value', 'stringValue');
      const iU = idx('Unit Type Name', 'unitTypeName'), iNo = idx('Notes', 'notes');
      if (iN < 0 || iV < 0) throw new Error(`${rel}: not a variables file`);
      txt.slice(1).forEach((r, i) => {
        if (!text(r[iN])) return;
        add('variable', text(r[iN]), text(r[iV]), iU >= 0 ? text(r[iU]) : null, iNo >= 0 ? text(r[iNo]) : null, t.rows[i], rel);
      });
    } else if (/wage_grade/.test(name)) {
      for (const r of t.rows) {
        const k = col(r, 'Process Name', 'processName');
        if (k) add('wage_grade', String(k), col(r, 'Wage Grade Name', 'wageGradeName'), null, null, r, rel);
      }
    } else if (/operation/.test(name)) {
      for (const r of t.rows) {
        const k = col(r, 'Process Name', 'Process Name (raw)', 'Process Name (Full Path)', 'processName');
        if (k) add('operation', String(k), null, null, null, r, rel);
      }
    } else if (/process/.test(name)) {
      for (const r of t.rows) {
        const k = col(r, 'Process Name', 'processName');
        if (k) add('process', String(k), col(r, 'Default Machine', 'defaultMachine'), null, col(r, 'Notes', 'notes'), r, rel);
      }
    } else if (materialTable && !d.materialsTable) {
      for (const r of t.rows) {
        const k = col(r, 'Name', 'name');
        if (k) add('material', String(k), col(r, 'Material Type', 'materialType'), null, `Staged from ${src}`, r);
      }
    }
    // A domain whose manifest entry names materialsTable keeps its materials in
    // that real table (its own promotion migration), never as JSON rows here.
    if (materialTable && d.materialsTable) notes.push(`${rel}: materials go to ${d.materialsTable} (not staged here)`);
  }

  if (dupNotes.length) {
    const same = dupNotes.filter((n) => n.endsWith("same value)"));
    const differing = dupNotes.filter((n) => !n.endsWith("same value)"));
    notes.push(`${d.label}: ${same.length} key(s) repeated with the same value in a second file, staged once${differing.length ? `; differing, staged under key@file: ${differing.join("; ")}` : ""}`);
  }

  summary.push(`--   ${d.label.padEnd(28)} ${d.sourceVersion.padEnd(19)} ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  statements.push({ label: `${d.label} (memory/${d.folder})`, rows: out });
}

// The SQL editor refuses a query past its size limit (the single 1.1 MB file
// was rejected), so the rows are packed into parts of at most PART_BUDGET
// bytes, one INSERT per folder slice, same split as 809-814. A part is one
// query; every INSERT is idempotent, so a part can be re-run safely.
const PART_BUDGET = 200000;
const insertOf = (label, rows) => `-- ── ${label} ${'─'.repeat(Math.max(0, 60 - label.length))}
INSERT INTO machining_reference_data (category, source_region, source_version, key, value, unit_type, notes, raw) VALUES
${rows.map((r) => `  ${r}`).join(',\n')}
ON CONFLICT (category, source_region, source_version, key) DO NOTHING;`;
const parts = [];
let cur = [], curBytes = 0;
for (const st of statements) {
  let slice = [], sliceBytes = 0;
  const flush = () => { if (slice.length) { cur.push({ label: st.label, rows: slice }); curBytes += sliceBytes + 400; slice = []; sliceBytes = 0; } };
  for (const r of st.rows) {
    const n = Buffer.byteLength(r) + 4;
    if (curBytes + sliceBytes + n > PART_BUDGET && (cur.length || slice.length)) { flush(); parts.push(cur); cur = []; curBytes = 0; }
    slice.push(r); sliceBytes += n;
  }
  flush();
}
if (cur.length) parts.push(cur);

for (const old of fs.readdirSync(path.dirname(OUT_PREFIX)).filter((n) => new RegExp(`^${STAGED_BY}_stage_memory_domains.*\\.sql$`).test(n))) {
  fs.unlinkSync(path.join(path.dirname(OUT_PREFIX), old));
}
parts.forEach((p, i) => {
  const name = `${path.basename(OUT_PREFIX)}_part${i + 1}of${parts.length}.sql`;
  const sql = `-- ============================================================================
-- Migration ${STAGED_BY} (part ${i + 1} of ${parts.length}): stage the reference data of every remaining memory/ folder
-- ============================================================================
-- Generated by scripts/gen_823_stage_memory_domains.js from
-- backend/src/modules/processes/memory-reference-domains.json -- do not
-- hand-edit, re-run the generator and diff instead.
--
-- machining_reference_data, one source_version per folder (source_region USA):
${summary.join('\n')}
--
-- Roles are classified from the files themselves (variables / processes /
-- operations / wage grades / materials at the top level, every csv in a lookup
-- folder as one lookup table). Machine files are in mhr_records (792-797, 815,
-- 824); India folders are 829. Lossless landing, same shape as 809/816/817/819.
${notes.length ? notes.map((n) => `--   ${n}`).join('\n') : '--   (no duplicate copies)'}
--
-- Split into ${parts.length} parts so each fits the SQL editor. Run every part;
-- order does not matter and each INSERT is idempotent (ON CONFLICT DO NOTHING).
-- This part: ${p.map((x) => `${x.label} (${x.rows.length} rows)`).join('; ')}
-- ============================================================================

${p.map((x) => insertOf(x.label, x.rows)).join('\n\n')}

NOTIFY pgrst, 'reload schema';
${i === parts.length - 1 ? `
-- Verify: SELECT source_version, category, count(*) FROM machining_reference_data
-- WHERE source_version IN (${MANIFEST.domains.filter((x) => x.stagedBy === STAGED_BY).map((x) => `'${x.sourceVersion}'`).join(', ')})
-- GROUP BY 1, 2 ORDER BY 1, 2;
` : ''}`;
  fs.writeFileSync(path.join(path.dirname(OUT_PREFIX), name), sql, 'utf8');
  console.log(`Wrote ${name} (${Buffer.byteLength(sql)} bytes)`);
});
console.log(summary.join('\n'));
console.log(notes.join('\n'));

// Shared by the per-domain reference staging generators (846 Die Casting, 849
// Casting): stages every reference csv of one memory/ folder into
// machining_reference_data under the folder's own source_version (manifest:
// backend/src/modules/processes/memory-reference-domains.json), with the role
// classification gen_823 applies to every other folder:
//   variable      *variables*.csv                 one row per variable
//   process       *process*.csv                   key = Process Name
//   operation     *operation*.csv                 key = Process:Operation//Feature
//   wage_grade    *wage_grade*.csv                key = Process Name
//   material      the domain's material table     key = Name, raw = whole row
//   lookup_table  every Lookup/*.csv and Indian data/*.csv, and any other
//                 material file, one row per file holding all its rows
// Machine/*.csv are in mhr_records (every column kept). A csv no role covers
// stops the generator instead of being dropped.

const fs = require('fs');
const path = require('path');
const { parseCsv } = require('./memory-machine-seed');

const VENDOR_RE = /a\s*priori/i;
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
  // A row longer than the header keeps its extra cells under their position.
  const rows = t.slice(1).map((r) => Object.fromEntries(r.map((v, i) => [columns[i] || `column_${i + 1}`, cell(v)])));
  return { columns, rows };
}
const sqlStr = (v) => (v === null || v === undefined || String(v).trim() === '' ? 'NULL' : `$str$${String(v).trim()}$str$`);
const sqlJsonb = (o) => `$jsonb$${JSON.stringify(o)}$jsonb$::jsonb`;
// Table key: file name without extension, vendor prefix dropped.
const tableKey = (f) => path.basename(f, path.extname(f)).replace(/^a\s*priori_?/i, '').trim();
const isMaterialTable = (cols) => cols.some((c) => /^name$/i.test(c)) && cols.some((c) => /^(material ?type|cut ?code)$/i.test(c));

/**
 * @param {object} o
 * @param {string} o.mem        absolute memory/ dir
 * @param {object} o.domain     manifest entry
 * @param {string} o.migration  migration number, e.g. "846"
 * @param {string} o.label      e.g. "Die Casting"
 * @param {string} o.outPrefix  absolute path prefix of the part files
 * @param {string} o.generator  generator file name for the header
 * @param {string} [o.materialFile] folder-relative path of THE material table
 *   (when the folder has several material-shaped files; the others are staged
 *   whole as lookup tables). Default: every material-shaped file is one.
 */
function stageDomain({ mem, domain: d, migration, label, outPrefix, generator, materialFile }) {
  if (d.sourceVersion.length > 20) throw new Error(`${d.key}: source_version exceeds VARCHAR(20)`);
  const dir = path.join(mem, d.folder);
  const files = [];
  (function walk(p) {
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const q = path.join(p, e.name);
      if (e.isDirectory()) { if (!/^machines?$/i.test(e.name)) walk(q); }
      else if (e.name.toLowerCase().endsWith('.csv')) files.push(q);
    }
  })(dir);

  const out = [];
  const counts = {};
  const keysUsed = new Map();
  const add = (category, key, value, unit, note, raw) => {
    const k = `${category}::${key}`;
    if (keysUsed.has(k)) throw new Error(`duplicate ${category} key "${key}" (${keysUsed.get(k)} and ${note})`);
    keysUsed.set(k, note);
    out.push(`(${sqlStr(category)}, 'USA', ${sqlStr(d.sourceVersion)}, ${sqlStr(key)}, ${sqlStr(value)}, ${sqlStr(unit)}, ${sqlStr(note)}, ${sqlJsonb(raw)})`);
    counts[category] = (counts[category] ?? 0) + 1;
  };
  const col = (row, ...names) => { for (const n of names) if (row[n] != null && row[n] !== '') return row[n]; return null; };
  const fileLines = [];

  for (const f of files.sort()) {
    const rel = path.relative(mem, f).replace(/\\/g, '/');
    const relInDir = path.relative(dir, f).replace(/\\/g, '/');
    const src = `memory/${rel}`;
    const name = path.basename(f).toLowerCase();
    const t = read(f);
    const before = out.length;
    const materialShaped = /material/.test(name) && isMaterialTable(t.columns);
    const lookup = /(^|\/)(lookup|indian data)\//i.test(relInDir) || (materialShaped && materialFile && relInDir !== materialFile);
    const materialTable = !lookup && materialShaped;
    if (lookup) {
      const key = tableKey(f);
      add('lookup_table', key, String(t.rows.length), null, `Staged from ${src}`,
        { table_name: key, source_files: [rel], status: 'COMPLETE', columns: t.columns, rows: t.rows });
    } else if (/variables/.test(name)) {
      const txt = parseCsv(fs.readFileSync(f, 'utf8').replace(/^﻿/, ''));
      const h = txt[0].map((x) => x.trim());
      const idx = (...n) => h.findIndex((x) => n.includes(x));
      const iN = idx('Variable Name'), iV = idx('String Value'), iU = idx('Unit Type Name'), iNo = idx('Notes');
      if (iN < 0 || iV < 0) throw new Error(`${rel}: not a variables file`);
      txt.slice(1).forEach((r, i) => {
        if (!text(r[iN])) return;
        add('variable', text(r[iN]), text(r[iV]), iU >= 0 ? text(r[iU]) : null, iNo >= 0 ? text(r[iNo]) : null, t.rows[i]);
      });
    } else if (/wage_grade/.test(name)) {
      for (const r of t.rows) { const k = col(r, 'Process Name'); if (k) add('wage_grade', String(k), col(r, 'Wage Grade Name'), null, null, r); }
    } else if (/operation/.test(name)) {
      for (const r of t.rows) { const k = col(r, 'Process Name'); if (k) add('operation', String(k), null, null, col(r, 'Notes'), r); }
    } else if (/process/.test(name)) {
      for (const r of t.rows) { const k = col(r, 'Process Name'); if (k) add('process', String(k), col(r, 'Default Machine'), null, col(r, 'Notes'), r); }
    } else if (materialTable) {
      for (const r of t.rows) { const k = col(r, 'Name'); if (k) add('material', String(k), col(r, 'Material Type'), null, `Staged from ${src}`, r); }
    } else {
      throw new Error(`${rel}: no staging role (add one rather than drop the file)`);
    }
    const n = out.length - before;
    // Every data row of a non-lookup file must have become a staged row.
    if (!lookup && n !== t.rows.filter((r) => Object.values(r).some((v) => v != null)).length) {
      throw new Error(`${rel}: ${t.rows.length} rows read, ${n} staged`);
    }
    fileLines.push(`--   ${relInDir.padEnd(52)} ${lookup ? `lookup_table (${t.rows.length} rows)` : `${n} row(s)`}`);
  }

  const PART_BUDGET = 200000;
  const parts = [];
  let cur = [], bytes = 0;
  for (const r of out) {
    const n = Buffer.byteLength(r) + 4;
    if (bytes + n > PART_BUDGET && cur.length) { parts.push(cur); cur = []; bytes = 0; }
    cur.push(r); bytes += n;
  }
  if (cur.length) parts.push(cur);

  const base = path.basename(outPrefix);
  for (const old of fs.readdirSync(path.dirname(outPrefix)).filter((n) => n.startsWith(base) && n.endsWith('.sql'))) {
    fs.unlinkSync(path.join(path.dirname(outPrefix), old));
  }
  const summary = Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ');
  parts.forEach((p, i) => {
    const name = `${base}_part${i + 1}of${parts.length}.sql`;
    const sql = `-- ============================================================================
-- Migration ${migration} (part ${i + 1} of ${parts.length}): stage the ${label} reference data
-- ============================================================================
-- Generated by scripts/${generator} from
-- backend/src/modules/processes/memory-reference-domains.json -- do not
-- hand-edit, re-run the generator and diff instead.
--
-- machining_reference_data, source_version ${d.sourceVersion} (source_region USA):
--   ${summary}
-- Files (memory/${d.folder}/):
${fileLines.join('\n')}
-- Machine/*.csv are in mhr_records (migration ${Number(migration) - 1}). Lossless landing, same
-- shape as 823: every row kept whole in raw.
--
-- Run every part; order does not matter and each INSERT is idempotent
-- (ON CONFLICT DO NOTHING). This part: ${p.length} rows.
-- ============================================================================

INSERT INTO machining_reference_data (category, source_region, source_version, key, value, unit_type, notes, raw) VALUES
${p.map((r) => `  ${r}`).join(',\n')}
ON CONFLICT (category, source_region, source_version, key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
${i === parts.length - 1 ? `
-- Verify (expect ${summary}):
-- SELECT category, count(*) FROM machining_reference_data
-- WHERE source_version = '${d.sourceVersion}' GROUP BY 1 ORDER BY 1;
` : ''}`;
    fs.writeFileSync(path.join(path.dirname(outPrefix), name), sql, 'utf8');
    console.log(`Wrote ${name} (${Buffer.byteLength(sql)} bytes, ${p.length} rows)`);
  });
  console.log(summary);
}

module.exports = { stageDomain };

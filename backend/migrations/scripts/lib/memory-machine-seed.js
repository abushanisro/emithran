// Shared by the machine-seeding generators: turns memory/ machine CSVs into
// mhr_records rows with the row shape of migrations 806/818/820.
//
//   - common rate/economics columns -> their mhr_records columns
//   - the work envelope named per file -> max_x/max_y/max_z_mm, max_workpiece_weight_kg
//   - every other column -> specs (snake_case key from the column name), verbatim
//   - MHR = Direct OH + Indirect OH (migration 581), LHR = the labour rate
//   - wage grade from the machine row, else the process wage-grade file
//   - benchmark_source_key = "<Category>:<Machine>" (HR Rates groups by it)
// A cell naming the licensed data vendor is written as 'reference export baseline'.

const fs = require('fs');

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
function cell(v) {
  const t = clean(String(v ?? '').trim());
  if (t === '') return null;
  if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) return Number(t);
  // Thousands separators ("5,857.55", "1,270,000.00") are still numbers.
  if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) return Number(t.replace(/,/g, ''));
  if (t === 'true') return true;
  if (t === 'false') return false;
  return t;
}
function readCsv(file) {
  const t = parseCsv(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  const columns = t[0].map((h) => h.trim());
  const rows = t.slice(1).map((r) => {
    if (r.length !== columns.length) throw new Error(`${file}: row has ${r.length} cells for ${columns.length} columns`);
    return Object.fromEntries(columns.map((h, i) => [h, cell(r[i])]));
  });
  return { columns, rows };
}
const sqlStr = (v) => (v === null || v === undefined || String(v).trim() === '' ? 'NULL' : `$str$${String(v).trim()}$str$`);
const sqlNum = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean' || !Number.isFinite(Number(v)) ? 'NULL' : String(Number(v)));
const sqlJsonb = (o) => `$jsonb$${JSON.stringify(o)}$jsonb$::jsonb`;
const specKey = (col) => col
  .replace(/\(([^)]*)\)/g, (_, u) => ' ' + u.replace(/\^2/g, '2').replace(/\^3/g, '3').replace(/\s*\/\s*/g, ' per ').replace(/%/g, 'pct').replace(/µ/g, 'u'))
  .replace(/\+/g, ' plus ')
  .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

const BASE = {
  'Labor Rate (USD / hr)': 'labour', 'Labor Rate (USD/hr)': 'labour',
  'Direct Overhead Rate (USD / hr)': 'direct', 'Direct Overhead Rate (USD/hr)': 'direct',
  'Indirect Overhead Rate (USD / hr)': 'indirect', 'Indirect Overhead Rate (USD/hr)': 'indirect',
  'Number of Operators': 'operators', 'Labor Time Standard': 'lts', 'Wage Grade Name': 'grade',
  'Work Center Labor Rate Factor': 'wclrf', 'Setup Time (hr)': 'setup', 'Avg Utilization': 'util',
  'Good Part Yield': 'yield', 'Machine Price (USD)': 'price', 'Machine Length (mm)': 'mlen',
  'Machine Width (mm)': 'mwid', 'Footprint Allowance Factor': 'faf', 'Machine Power (kW)': 'kw',
  'Installation Factor (%)': 'inst', 'Machine Uptime (%)': 'uptime', 'Annual Maintenance Factor (%)': 'maint',
  'Machine Life (yr)': 'life', 'Salvage Value Factor (%)': 'salv', 'Supplies Cost (USD / yr)': 'supplies',
  'Supplies Cost (USD/yr)': 'supplies', 'Machine Manufacturer Location': 'mfr',
  'Name': 'name', 'Machine Name': 'name', 'Description': 'description',
};

const COLUMNS = [
  'machine_class', 'location', 'machine_name', 'machine_description', 'currency_code', 'country_code',
  'source_type', 'process_group', 'operators', 'setup_time_hr', 'landed_machine_cost',
  'direct_overhead_rate', 'indirect_overhead_rate',
  'benchmark_direct_overhead_rate_usd_hr', 'benchmark_indirect_overhead_rate_usd_hr',
  'total_machine_hour_rate', 'mhr_usd_per_hour',
  'usd_labor_rate_per_hr', 'benchmark_labor_rate_usd_hr', 'usd_lhr_total',
  'work_center_labor_rate_factor', 'labor_time_standard', 'wage_grade',
  'machine_price_usd', 'machine_length_mm', 'machine_width_mm',
  'footprint_allowance_factor', 'machine_power_kw', 'machine_life_yr',
  'installation_factor_pct', 'machine_uptime_pct', 'annual_maintenance_factor_pct',
  'salvage_value_factor_pct', 'supplies_cost_per_year', 'avg_utilization',
  'good_part_yield', 'manufacturer_country',
  'max_x_mm', 'max_y_mm', 'max_z_mm', 'max_workpiece_weight_kg',
  'capability_source', 'specs', 'benchmark_source_key',
];

/**
 * @param {Array<{file:string, rel:string, category:string, machineClass:string, grade:string|null,
 *                envelope:[string|null,string|null,string|null,string|null],
 *                categoryColumn?:string, classOf?:(c:string)=>string, gradeOf?:(c:string)=>string|null}>} files
 *   categoryColumn: a column naming each row's own category/process (e.g. the
 *   Heat Treatment files' "Process Name"); classOf/gradeOf then derive the
 *   machine class and wage grade per row.
 * @param {string} processGroup
 */
function buildMachineRows(files, processGroup) {
  const rows = [];
  const report = [];
  for (const f of files) {
    const t = readCsv(f.file);
    for (const c of f.envelope) if (c && !t.columns.includes(c)) throw new Error(`${f.rel}: envelope column "${c}" missing`);
    const specCols = t.columns.filter((c) => !(c in BASE) && c !== f.categoryColumn);
    const seen = new Set();
    for (const m of t.rows) {
      const rawName = m['Name'] ?? m['Machine Name'];
      const name = rawName == null ? null : String(rawName);
      if (!name) throw new Error(`${f.rel}: row without a Name`);
      const category = f.categoryColumn ? String(m[f.categoryColumn] ?? '') : f.category;
      if (!category) throw new Error(`${f.rel} ${name}: no ${f.categoryColumn}`);
      const machineClass = f.classOf ? f.classOf(category) : f.machineClass;
      const grade = f.gradeOf ? f.gradeOf(category) : f.grade;
      if (seen.has(name)) throw new Error(`${f.rel}: duplicate machine name ${name}`);
      seen.add(name);
      const get = (k) => { const col = Object.keys(BASE).find((c) => BASE[c] === k && c in m); return col ? m[col] : null; };
      const direct = get('direct'), indirect = get('indirect');
      const hasRates = typeof direct === 'number' && typeof indirect === 'number';
      // A file that carries no rate columns at all (e.g. the hydroform presses)
      // is seeded with its rates NULL when the caller says so, never with a
      // rate derived here; a missing rate in a rated file is an error.
      if (!hasRates && !f.ratesAbsentInSource) throw new Error(`${f.rel} ${name}: missing overhead rate`);
      const mhr = hasRates ? Math.round((direct + indirect) * 100) / 100 : null;
      const labour = get('labour'), price = get('price'), loc = get('mfr');
      const specs = { source: `memory/${f.rel}` };
      for (const c of specCols) specs[specKey(c)] = m[c];
      const cap = f.envelope.map((c) => (c ? m[c] : null));
      const hasCap = cap.some((v) => typeof v === 'number' && v > 0);
      rows.push([
        sqlStr(machineClass), sqlStr('USA'), sqlStr(name), sqlStr(get('description')), sqlStr('USD'), sqlStr('US'),
        sqlStr('BENCHMARK'), sqlStr(processGroup),
        sqlNum(get('operators')), sqlNum(get('setup')),
        sqlNum(typeof price === 'number' && price > 0 ? price : null),
        sqlNum(direct), sqlNum(indirect), sqlNum(direct), sqlNum(indirect),
        sqlNum(mhr), sqlNum(mhr),
        sqlNum(labour), sqlNum(labour), sqlNum(labour),
        sqlNum(get('wclrf')), sqlNum(get('lts')), sqlStr(get('grade') || grade),
        sqlNum(price), sqlNum(get('mlen')), sqlNum(get('mwid')),
        sqlNum(get('faf')), sqlNum(get('kw')), sqlNum(get('life')),
        sqlNum(get('inst')), sqlNum(get('uptime')), sqlNum(get('maint')),
        sqlNum(get('salv')), sqlNum(get('supplies')), sqlNum(get('util')), sqlNum(get('yield')),
        sqlStr(loc === 'Virtual' ? null : loc),
        ...cap.map((v) => sqlNum(typeof v === 'number' && v > 0 ? v : null)), sqlStr(hasCap ? 'imported' : null),
        sqlJsonb(specs), sqlStr(`${category}:${name}`),
      ]);
    }
    report.push({ ...f, n: t.rows.length, specs: specCols.map(specKey) });
  }
  return { columns: COLUMNS, rows, report };
}

// A VALUES column that is NULL on every row is typed text, which then cannot
// be inserted into a numeric column (824: no forging file has a workpiece
// weight). Every non-text column is therefore cast to its target type.
const TEXT_COLUMNS = new Set([
  'machine_class', 'location', 'machine_name', 'machine_description', 'currency_code', 'country_code',
  'source_type', 'process_group', 'wage_grade', 'manufacturer_country', 'capability_source', 'benchmark_source_key',
]);
const typedCol = (c) => (TEXT_COLUMNS.has(c) ? `v.${c}` : c === 'specs' ? 'v.specs::jsonb' : `v.${c}::numeric`);

function insertSql(columns, rows) {
  const specsDdl = columns.includes('specs')
    ? `-- specs was dropped by migration 563 and is restored by 814a; added here as
-- well so this file runs on its own. No-op when the column exists.
ALTER TABLE mhr_records ADD COLUMN IF NOT EXISTS specs JSONB;

`
    : '';
  return `${specsDdl}INSERT INTO mhr_records (
  ${columns.join(', ')}
)
SELECT ${columns.map(typedCol).join(', ')} FROM (VALUES
${rows.map((r) => `  (${r.join(', ')})`).join(',\n')}
) AS v(${columns.join(', ')})
WHERE NOT EXISTS (
  SELECT 1 FROM mhr_records m
  WHERE m.machine_class = v.machine_class
    AND m.location = v.location
    AND lower(trim(m.machine_name)) = lower(trim(v.machine_name))
);`;
}

module.exports = { parseCsv, readCsv, sqlStr, sqlNum, sqlJsonb, specKey, buildMachineRows, insertSql };

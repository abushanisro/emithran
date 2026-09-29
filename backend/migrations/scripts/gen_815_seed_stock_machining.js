#!/usr/bin/env node
// Generator: memory/Stock Maching -> HR Rates machines + staged reference data.
//
//   815  mhr_records: the 13 real band saws (Machine/machines_band_saw.csv),
//        machine_class 'band_saw', process_group 'Stock Machining',
//        benchmark_source_key 'Band Saw:<name>', wage grade from
//        wage_grade_associations (3).csv. MHR = Direct OH + Indirect OH
//        (migration 581); LHR = the source labour rate. Real capability
//        (max stock Ø/height/width, max cut angle, axial feed, load/unload
//        seconds) goes into specs. "Default Material Stock" is NOT seeded: every
//        rate on it is 0 — it is the as-supplied stock marker, not a machine.
//   816  machining_reference_data, source_version '2026-Stock-Machining':
//        variables.csv (category 'variable'), wage grades ('wage_grade'),
//        lookup tables bandSawCutting / bandSawHandling ('lookup_table'), and
//        metirials/materials_band_saw.csv as one lookup_table row
//        'materialsBandSaw'. Lossless landing, same conventions as 786/787.
//
// Not staged here: lookup/tblPartingRingWidth.csv and tblPreferredSizes_PARTIAL
// (copies of tables already staged from memory/Machining and memory/Multi-
// Spindle Maching; the parting-ring copies disagree at 110 mm and await a user
// decision), tblPartSpacing (sheet-metal cutter spacing, already staged by
// migration 528), validationDisplayControls (UI-only).
//
// The licensed data vendor is never written to the database: any cell naming
// it is replaced by 'reference export baseline'.
//
// Run: node backend/migrations/scripts/gen_815_seed_stock_machining.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const SRC = path.join(ROOT, 'memory', 'Stock Maching');
const OUT = path.join(__dirname, '..');
const VERSION = '2026-Stock-Machining';
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
  return t;
}
function read(rel) {
  const t = parseCsv(fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/^﻿/, ''));
  const columns = t[0].map((h) => h.trim());
  const rows = t.slice(1).map((r) => Object.fromEntries(columns.map((h, i) => [h, cell(r[i])])));
  return { columns, rows };
}
const sqlStr = (v) => (v === null || v === undefined || v === '' ? 'NULL' : `$str$${String(v)}$str$`);
const sqlNum = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? 'NULL' : String(Number(v)));
const sqlJsonb = (o) => `$jsonb$${JSON.stringify(o)}$jsonb$::jsonb`;

// ── 815: band saws ───────────────────────────────────────────────────────────
const saws = read('Machine/machines_band_saw.csv');
const wage = read('wage_grade_associations (3).csv');
const bandSawGrade = wage.rows.find((r) => r['Process Name'] === 'Band Saw')?.['Wage Grade Name'];
if (!bandSawGrade) throw new Error('No Band Saw wage grade in wage_grade_associations (3).csv');

const COLS = [
  'machine_class', 'location', 'machine_name', 'currency_code', 'country_code', 'source_type', 'process_group',
  'operators', 'setup_time_hr', 'landed_machine_cost',
  'direct_overhead_rate', 'indirect_overhead_rate', 'benchmark_direct_overhead_rate_usd_hr', 'benchmark_indirect_overhead_rate_usd_hr',
  'total_machine_hour_rate', 'mhr_usd_per_hour', 'usd_labor_rate_per_hr', 'benchmark_labor_rate_usd_hr', 'usd_lhr_total',
  'work_center_labor_rate_factor', 'labor_time_standard', 'wage_grade', 'machine_price_usd', 'machine_length_mm', 'machine_width_mm',
  'footprint_allowance_factor', 'machine_power_kw', 'machine_life_yr', 'installation_factor_pct', 'machine_uptime_pct',
  'annual_maintenance_factor_pct', 'salvage_value_factor_pct', 'supplies_cost_per_year', 'avg_utilization', 'good_part_yield',
  'manufacturer_country', 'specs', 'benchmark_source_key',
];
const sawRows = saws.rows.map((m) => {
  const name = m['Name'];
  const direct = m['Direct Overhead Rate (USD / hr)'];
  const indirect = m['Indirect Overhead Rate (USD / hr)'];
  if (typeof direct !== 'number' || typeof indirect !== 'number') throw new Error(`${name}: missing overhead`);
  const mhr = Math.round((direct + indirect) * 100) / 100;
  const lab = m['Labor Rate (USD / hr)'];
  const price = m['Machine Price (USD)'];
  const specs = {
    source: 'memory/Stock Maching/Machine/machines_band_saw.csv',
    load_unload_time_s: m['Load+Unload Time (s)'],
    unload_time_s: m['Unload Time (s)'],
    axial_feed_rate_mm_per_s: m['Axial Feed Rate (mm / s)'],
    max_cut_angle_deg: m['Max Cut Angle (deg)'],
    max_stock_diameter_mm: m['Max Stock Diameter (mm)'],
    max_stock_height_mm: m['Max Stock Height (mm)'],
    max_stock_width_mm: m['Max Stock Width (mm)'],
    is_preferred: m['Is Preferred'],
  };
  return [
    sqlStr('band_saw'), sqlStr('USA'), sqlStr(name), sqlStr('USD'), sqlStr('US'), sqlStr('BENCHMARK'), sqlStr('Stock Machining'),
    sqlNum(m['Number of Operators']), sqlNum(m['Setup Time (hr)']), sqlNum(price),
    sqlNum(direct), sqlNum(indirect), sqlNum(direct), sqlNum(indirect),
    sqlNum(mhr), sqlNum(mhr), sqlNum(lab), sqlNum(lab), sqlNum(lab),
    sqlNum(m['Work Center Labor Rate Factor']), sqlNum(m['Labor Time Standard']), sqlStr(m['Wage Grade Name'] || bandSawGrade),
    sqlNum(price), sqlNum(m['Machine Length (mm)']), sqlNum(m['Machine Width (mm)']),
    sqlNum(m['Footprint Allowance Factor']), sqlNum(m['Machine Power (kW)']), sqlNum(m['Machine Life (yr)']),
    sqlNum(m['Installation Factor (%)']), sqlNum(m['Machine Uptime (%)']), sqlNum(m['Annual Maintenance Factor (%)']),
    sqlNum(m['Salvage Value Factor (%)']), sqlNum(m['Supplies Cost (USD / yr)']), sqlNum(m['Avg Utilization']), sqlNum(m['Good Part Yield']),
    sqlStr(m['Machine Manufacturer Location']), sqlJsonb(specs), sqlStr(`Band Saw:${name}`),
  ];
});

fs.writeFileSync(path.join(OUT, '815_seed_band_saw_mhr_records.sql'), `-- ============================================================================
-- Migration 815: seed mhr_records with the ${sawRows.length} real band saws
-- ============================================================================
-- Generated by scripts/gen_815_seed_stock_machining.js -- do not hand-edit.
-- Source: memory/Stock Maching/Machine/machines_band_saw.csv (USA reference
-- export). machine_class band_saw, process_group Stock Machining, wage grade
-- ${bandSawGrade} (wage_grade_associations (3).csv). MHR = Direct OH + Indirect OH
-- (migration 581). Real saw capability is in specs. No cost engine reads
-- band_saw yet -- these rows make the machines and their rates real in HR Rates.
-- Idempotent: skips a (machine_class, location, machine_name) already present.
-- ============================================================================

-- specs was dropped by migration 563 and is restored by 814a; added here as
-- well so this file runs on its own. No-op when the column exists.
ALTER TABLE mhr_records ADD COLUMN IF NOT EXISTS specs JSONB;

INSERT INTO mhr_records (
  ${COLS.join(', ')}
)
SELECT v.* FROM (VALUES
${sawRows.map((r) => `  (${r.join(', ')})`).join(',\n')}
) AS v(${COLS.join(', ')})
WHERE NOT EXISTS (
  SELECT 1 FROM mhr_records m
  WHERE m.machine_class = v.machine_class AND m.location = v.location
    AND lower(trim(m.machine_name)) = lower(trim(v.machine_name))
);

-- Verify (expect ${sawRows.length}):
-- SELECT count(*) FROM mhr_records WHERE machine_class = 'band_saw' AND location = 'USA';
`, 'utf8');

// ── 816: staged reference data ───────────────────────────────────────────────
const vars = read('variables.csv');
const varRows = vars.rows.map((v) => {
  const name = v[vars.columns.find((c) => /variable\s*name|^name$/i.test(c)) ?? vars.columns[0]];
  return v;
});
const nameCol = vars.columns.find((c) => /name/i.test(c));
const valueCol = vars.columns.find((c) => /^value$|string\s*value/i.test(c)) ?? vars.columns[1];
const unitCol = vars.columns.find((c) => /unit/i.test(c));
const descCol = vars.columns.find((c) => /desc/i.test(c));
if (!nameCol || !valueCol) throw new Error(`variables.csv: unexpected header ${vars.columns.join('|')}`);

const refRows = [];
for (const v of varRows) {
  refRows.push(`('variable', 'USA', ${sqlStr(VERSION)}, ${sqlStr(v[nameCol])}, ${sqlStr(v[valueCol] == null ? null : String(v[valueCol]))}, ${sqlStr(unitCol ? v[unitCol] : null)}, ${sqlStr(descCol ? v[descCol] : null)}, ${sqlJsonb(v)})`);
}
for (const w of wage.rows) {
  if (!w['Process Name']) continue;
  refRows.push(`('wage_grade', 'USA', ${sqlStr(VERSION)}, ${sqlStr(w['Process Name'])}, ${sqlStr(w['Wage Grade Name'])}, NULL, NULL, ${sqlJsonb(w)})`);
}
for (const [key, rel] of [['bandSawCutting', 'lookup/bandSawCutting.csv'], ['bandSawHandling', 'lookup/bandSawHandling.csv'], ['materialsBandSaw', 'metirials/materials_band_saw.csv']]) {
  const t = read(rel);
  const raw = { table_name: key, source_files: [rel], status: 'COMPLETE', columns: t.columns, rows: t.rows };
  refRows.push(`('lookup_table', 'USA', ${sqlStr(VERSION)}, ${sqlStr(key)}, ${sqlStr(String(t.rows.length))}, NULL, ${sqlStr(`Staged from memory/Stock Maching/${rel}`)}, ${sqlJsonb(raw)})`);
}

fs.writeFileSync(path.join(OUT, '816_stage_stock_machining_reference_data.sql'), `-- ============================================================================
-- Migration 816: stage memory/Stock Maching reference data
-- ============================================================================
-- Generated by scripts/gen_815_seed_stock_machining.js -- do not hand-edit.
-- source_version ${VERSION}: ${varRows.length} variables, ${wage.rows.filter((w) => w['Process Name']).length} wage grades,
-- lookup tables bandSawCutting, bandSawHandling and materialsBandSaw.
-- Lossless landing (same conventions as migrations 786/787); no consumer yet.
-- ============================================================================

INSERT INTO machining_reference_data (category, source_region, source_version, key, value, unit_type, notes, raw) VALUES
${refRows.map((r) => `  ${r}`).join(',\n')}
ON CONFLICT (category, source_region, source_version, key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
`, 'utf8');

console.log(`815: ${sawRows.length} band saws (wage grade ${bandSawGrade}); 816: ${refRows.length} reference rows`);
console.log('variables header:', vars.columns.join(' | '));
